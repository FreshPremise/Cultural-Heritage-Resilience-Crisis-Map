const test = require("node:test");
const assert = require("node:assert/strict");

global.window = {};
require("../js/feeds.js");
const Feeds = global.window.Feeds;
const realFetch = global.fetch;

function source(id) {
  return Feeds.sources.find((item) => item.id === id).fetcher;
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function square(lon = -100, lat = 50) {
  return { type: "Polygon", coordinates: [[[lon, lat], [lon + 0.1, lat], [lon + 0.1, lat + 0.1], [lon, lat + 0.1], [lon, lat]]] };
}

async function withFetch(mock, action) {
  global.fetch = mock;
  try { return await action(); } finally { global.fetch = realFetch; }
}

test("HTTP-200 provider errors are treated as feed failures", { concurrency: false }, async () => {
  await withFetch(async () => jsonResponse({ error: { message: "Invalid field", details: ["DailyAcres"] } }), async () => {
    await assert.rejects(Feeds.test.fetchJSON("https://example.test/feed"), /Provider error.*DailyAcres/);
  });
});

test("oversized feed responses are stopped before JSON parsing", { concurrency: false }, async () => {
  await withFetch(async () => new Response("12345678901"), async () => {
    await assert.rejects(Feeds.test.fetchJSON("https://example.test/feed", 1000, 10), /exceeds 10 bytes/);
  });
});

test("NWS provider fields normalize response class, priority, method, and timestamps", { concurrency: false }, async () => {
  const baseProperties = {
    severity: "Moderate",
    onset: "2026-09-07T12:00:00Z",
    sent: "2026-09-07T11:45:00Z",
    ends: "2026-09-07T18:00:00Z",
    geocode: { SAME: ["041047"] },
  };
  const cases = [
    { id: "watch", event: "Fire Weather Watch", expected: "watch", geometry: null },
    { id: "warning", event: "Watch Hill Flood Warning", expected: "warning", geometry: square(-90, 40) },
    { id: "advisory", event: "Heat Advisory", expected: "advisory", geometry: null },
    { id: "statement", event: "Hurricane Local Statement", expected: "observed-event", geometry: null },
    { id: "unknown", event: "Hydrologic Outlook", expected: "unknown", geometry: null },
  ];
  await withFetch(async () => jsonResponse({
    features: cases.map((item) => ({
      id: item.id,
      properties: { ...baseProperties, id: item.id, event: item.event },
      geometry: item.geometry,
    })),
  }), async () => {
    const events = await source("nws")();
    assert.equal(events.length, cases.length);
    for (const item of cases) {
      const event = events.find((candidate) => candidate.id === `nws:${item.id}`);
      assert.ok(event, item.id);
      assert.equal(event.responseClass, item.expected);
      assert.equal(event.screeningPriority, 2);
      assert.equal(event.screeningPriorityLabel, "Moderate");
      assert.equal(event.providerSeverity, "Moderate");
      assert.equal(event.matchMethod, item.geometry ? "published-polygon" : "county-approximate");
      assert.equal(event.startedAt, "2026-09-07T12:00:00.000Z");
      assert.equal(event.updatedAt, "2026-09-07T11:45:00.000Z");
      assert.equal(event.expiresAt, "2026-09-07T18:00:00.000Z");
      assert.equal(event.time, event.startedAt);
      assert.equal(event.expires, event.expiresAt);
    }
  });
});

test("NWS zone refinement fails closed when the provider list exceeds the bounded fetch set", { concurrency: false }, async () => {
  const affectedZones = Array.from({ length: 81 }, (_, i) => `https://api.weather.gov/zones/county/T${String(i).padStart(3, "0")}`);
  await withFetch(async () => jsonResponse({
    features: [{
      id: "many-zones",
      properties: {
        id: "many-zones", event: "Flood Warning", severity: "Moderate",
        geocode: { SAME: ["041047"] }, affectedZones,
      },
      geometry: null,
    }],
  }), async () => {
    const [event] = await source("nws")();
    assert.equal(event.zones.length, 80);
    assert.equal(event.zonesTruncated, true);
    assert.equal(event.matchMethod, "county-approximate");
  });
});

test("WFIGS uses the current IncidentSize field", { concurrency: false }, async () => {
  await withFetch(async (url) => {
    assert.match(String(url), /IncidentSize/);
    assert.match(String(url), /ModifiedOnDateTime_dt/);
    assert.doesNotMatch(String(url), /DailyAcres/);
    assert.match(String(url), /resultOffset=0/);
    return jsonResponse({ features: [{
      properties: {
        IncidentName: "Test", POOState: "US-OR", IncidentSize: 1200, PercentContained: 25,
        FireDiscoveryDateTime: 1700000000000, ModifiedOnDateTime_dt: 1700003600000,
      },
      geometry: { type: "Point", coordinates: [-122, 44] },
    }] });
  }, async () => {
    const events = await source("fires")();
    assert.equal(events.length, 1);
    assert.match(events[0].description, /1,200 acres/);
    assert.equal(events[0].screeningPriority, 2);
    assert.equal(events[0].screeningPriorityLabel, "Moderate");
    assert.equal(events[0].severity, events[0].screeningPriority);
    assert.equal(events[0].sevLabel, events[0].screeningPriorityLabel);
    assert.equal(events[0].providerSeverity, null);
    assert.equal(events[0].responseClass, "observed-event");
    assert.equal(events[0].matchMethod, "estimated-radius");
    assert.equal(events[0].startedAt, new Date(1700000000000).toISOString());
    assert.equal(events[0].updatedAt, new Date(1700003600000).toISOString());
    assert.equal(events[0].time, events[0].startedAt);
    assert.equal(events[0].expiresAt, null);
    assert.equal(events[0].expires, null);
  });
});

test("WFIGS rejects implausibly large finite acreage before deriving a radius", { concurrency: false }, async () => {
  await withFetch(async () => jsonResponse({ features: [{
    properties: { IncidentName: "Malformed", POOState: "US-OR", IncidentSize: 1e308 },
    geometry: { type: "Point", coordinates: [-122, 44] },
  }] }), async () => {
    assert.deepEqual(await source("fires")(), []);
  });
});

test("WFIGS pagination does not discard incidents after the first page", { concurrency: false }, async () => {
  await withFetch(async (url) => {
    const offset = Number(new URL(String(url)).searchParams.get("resultOffset"));
    const count = offset === 0 ? 1000 : 200;
    return jsonResponse({ features: Array.from({ length: count }, (_, i) => ({
      properties: { IncidentName: `Fire ${offset + i}`, POOState: "US-AK", IncidentSize: 101 },
      geometry: { type: "Point", coordinates: [-150 + (offset + i) / 100000, 60] },
    })) });
  }, async () => {
    assert.equal((await source("fires")()).length, 1200);
  });
});

test("Environment Canada results are not truncated before impact matching", { concurrency: false }, async () => {
  const features = Array.from({ length: 130 }, (_, i) => ({
    properties: {
      status_en: "active", alert_type: "warning", alert_code: `code-${i}`,
      alert_name_en: "Storm warning", feature_name_en: `Area ${i}`, province: "ON", risk_colour_en: "orange",
      validity_datetime: "2026-07-20T10:00:00Z", publication_datetime: "2026-07-20T09:30:00Z",
      event_end_datetime: "2026-07-21T10:00:00Z",
    },
    geometry: square(-90 + i / 1000, 50),
  }));
  await withFetch(async (url) => {
    assert.match(String(url), /limit=500&offset=0/);
    return jsonResponse({ numberMatched: 130, features });
  }, async () => {
    const events = await source("eccc")();
    assert.equal(events.length, 130);
    assert.equal(events[0].link.href, "https://weather.gc.ca/index_e.html?layers=alert");
    assert.equal(events[0].providerSeverity, "orange");
    assert.equal(events[0].responseClass, "warning");
    assert.equal(events[0].matchMethod, "published-polygon");
    assert.equal(events[0].startedAt, "2026-07-20T10:00:00.000Z");
    assert.equal(events[0].updatedAt, "2026-07-20T09:30:00.000Z");
    assert.equal(events[0].expiresAt, "2026-07-21T10:00:00.000Z");
  });
});

test("Environment Canada pagination continues when the provider omits a total", { concurrency: false }, async () => {
  await withFetch(async (url) => {
    const offset = Number(new URL(String(url)).searchParams.get("offset"));
    const count = offset === 0 ? 500 : 1;
    return jsonResponse({ features: Array.from({ length: count }, (_, i) => ({
      properties: {
        status_en: "active", alert_type: "warning", alert_code: `page-${offset}-${i}`,
        alert_name_en: "Storm warning", feature_name_en: `Area ${offset + i}`, province: "ON",
      },
      geometry: square(-90 + (offset + i) / 10000, 50),
    })) });
  }, async () => {
    assert.equal((await source("eccc")()).length, 501);
  });
});

test("CWFIS results are not truncated at the old 200-feature cap", { concurrency: false }, async () => {
  const features = Array.from({ length: 225 }, (_, i) => ({
    id: `m3_polygons_current.${i + 1}`,
    properties: { area: 600, firstdate: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, lastdate: "2026-07-20" },
    geometry: square(-120 + i / 1000, 55),
  }));
  await withFetch(async (url) => {
    assert.match(String(url), /count=500/);
    return jsonResponse({ numberMatched: 225, features });
  }, async () => {
    const events = await source("cwfis")();
    assert.equal(events.length, 225);
    assert.notEqual(events[0].title, events[1].title);
    assert.match(events[0].title, /Satellite-estimated wildfire perimeter m3_polygons_current\.1 near \d+\.\d{2}° [NS], \d+\.\d{2}° [EW]/);
    assert.match(events[0].description, /Satellite-derived FireM3 perimeter estimate/);
    assert.match(events[0].description, /not an operational incident perimeter/);
    assert.equal(events[0].matchMethod, "published-polygon");
    assert.equal(events[0].responseClass, "observed-event");
    assert.equal(events[0].providerSeverity, null);
    assert.equal(events[0].startedAt, "2026-07-01T00:00:00.000Z");
    assert.equal(events[0].observedAt, "2026-07-20T00:00:00.000Z");
    assert.equal(events[0].updatedAt, null);
  });
});

test("CWFIS pagination continues when the provider omits a total", { concurrency: false }, async () => {
  await withFetch(async (url) => {
    const start = Number(new URL(String(url)).searchParams.get("startIndex"));
    const count = start === 0 ? 500 : 1;
    return jsonResponse({ features: Array.from({ length: count }, (_, i) => ({
      id: `page-${start}-${i}`,
      properties: { area: 600, firstdate: "2026-07-01", lastdate: "2026-07-20" },
      geometry: square(-120 + (start + i) / 10000, 55),
    })) });
  }, async () => {
    assert.equal((await source("cwfis")()).length, 501);
  });
});

test("USGS M3+ coverage comes from the full weekly feed", { concurrency: false }, async () => {
  const quakeTime = Date.now() - 2 * 86400000;
  await withFetch(async (url) => {
    assert.match(String(url), /2\.5_week\.geojson/);
    return jsonResponse({ features: [{
      id: "two-days-old", properties: { mag: 3.2, place: "Test place", time: quakeTime, url: "https://earthquake.usgs.gov/example" },
      geometry: { type: "Point", coordinates: [-100, 40, 5] },
    }] });
  }, async () => {
    const events = await source("quakes")();
    assert.equal(events.length, 1);
    assert.match(events[0].title, /^M3\.2/);
    assert.equal(events[0].responseClass, "observed-event");
    assert.equal(events[0].matchMethod, "estimated-radius");
    assert.equal(events[0].startedAt, new Date(quakeTime).toISOString());
  });
});

test("WFIGS rejects non-finite, out-of-range, and non-North-American points", { concurrency: false }, async () => {
  const records = [
    { IncidentName: "Valid", coordinates: [-122, 44] },
    { IncidentName: "String", coordinates: ["-122", 44] },
    { IncidentName: "Out of range", coordinates: [181, 44] },
    { IncidentName: "Outside coverage", coordinates: [10, 44] },
  ];
  await withFetch(async () => jsonResponse({ features: records.map((record) => ({
    properties: { IncidentName: record.IncidentName, POOState: "US-OR", IncidentSize: 1200 },
    geometry: { type: "Point", coordinates: record.coordinates },
  })) }), async () => {
    const events = await source("fires")();
    assert.deepEqual(events.map((event) => event.title), ["Valid Fire — OR"]);
  });
});

test("EONET preserves event-start and latest-observation timestamps", { concurrency: false }, async () => {
  await withFetch(async () => jsonResponse({ events: [{
    id: "EONET-1",
    title: "Test volcano",
    categories: [{ id: "volcanoes" }],
    geometry: [
      { type: "Point", coordinates: [-110, 45], date: "2026-09-01T00:00:00Z" },
      { type: "Point", coordinates: [-109, 45.5], date: "2026-09-03T06:00:00Z" },
    ],
    sources: [{ id: "test", url: "https://example.test/event" }],
  }] }), async () => {
    const [event] = await source("eonet")();
    assert.equal(event.startedAt, "2026-09-01T00:00:00.000Z");
    assert.equal(event.observedAt, "2026-09-03T06:00:00.000Z");
    assert.equal(event.time, event.startedAt);
    assert.equal(event.responseClass, "observed-event");
    assert.equal(event.matchMethod, "estimated-radius");
    assert.equal(event.screeningPriority, 3);
  });
});

test("event normalization keeps explicit fields and compatibility aliases synchronized", () => {
  const event = Feeds.test.mkEvent({
    screeningPriority: 4,
    severity: 1,
    providerSeverity: 7,
    responseClass: "warning",
    matchMethod: "published-polygon",
    startedAt: "2026-09-07T12:00:00Z",
    observedAt: "2026-09-07T12:05:00Z",
    updatedAt: "2026-09-07T12:10:00Z",
    expiresAt: "2026-09-08T00:00:00Z",
  });
  assert.equal(event.screeningPriority, 4);
  assert.equal(event.screeningPriorityLabel, "Extreme");
  assert.equal(event.severity, 4);
  assert.equal(event.sevLabel, "Extreme");
  assert.equal(event.providerSeverity, "7");
  assert.equal(event.time, event.startedAt);
  assert.equal(event.expires, event.expiresAt);
  assert.deepEqual(event.affected, []);

  const inferred = Feeds.test.mkEvent({
    severity: 2,
    responseClass: "not-a-class",
    matchMethod: "not-a-method",
    observedAt: "2026-09-07T12:05:00Z",
    point: [-100, 40],
    radiusKm: 30,
  });
  assert.equal(inferred.responseClass, "unknown");
  assert.equal(inferred.matchMethod, "estimated-radius");
  assert.equal(inferred.time, inferred.observedAt);
  assert.equal(inferred.startedAt, null);
  assert.equal(inferred.expiresAt, null);
});

test("provider response classification uses the terminal alert type", () => {
  assert.equal(Feeds.test.responseClass("Fire Weather Watch"), "watch");
  assert.equal(Feeds.test.responseClass("Watch Hill Flood Warning"), "warning");
  assert.equal(Feeds.test.responseClass("Heat Advisory"), "advisory");
  assert.equal(Feeds.test.responseClass("Hurricane Local Statement"), "observed-event");
  assert.equal(Feeds.test.responseClass("Hydrologic Outlook"), "unknown");
  assert.equal(Feeds.test.responseClass("Bulletin", "observed-event"), "observed-event");
});

test("only exact, bounded Polygon and MultiPolygon geometry is accepted", () => {
  assert.equal(Feeds.geometryIsUsable, Feeds.test.geometryIsUsable, "production geometry validator must be exported");
  assert.equal(Feeds.test.geometryIsUsable(square()), true);
  assert.equal(Feeds.test.geometryIsUsable({ type: "MultiPolygon", coordinates: [square().coordinates] }), true);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Point", coordinates: [-100, 50] }), false);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [] }), false);
  assert.equal(Feeds.test.geometryIsUsable({ type: "MultiPolygon", coordinates: [] }), false);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[[-100, 50], [-99, 50], [-99, 51], [-100, 51]]] }), false, "rings must close");
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[[-100, 50], [-99, 50], [-100, 50]]] }), false, "rings need four positions");
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[[-100, 50], [-100, 50], [-100, 50], [-100, 50]]] }), false, "rings need three distinct positions");
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[-100, 50], [-99, 50], [-99, 51], [-100, 50]] }), false, "Polygon nesting must be exact");
  assert.equal(Feeds.test.geometryIsUsable({ type: "MultiPolygon", coordinates: square().coordinates }), false, "MultiPolygon nesting must be exact");
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[[999, 50], [0, 0], [1, 1], [999, 50]]] }), false);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[[NaN, 50], [0, 0], [1, 1], [NaN, 50]]] }), false);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[[0, Infinity], [0, 0], [1, 1], [0, Infinity]]] }), false);
});

test("geometry complexity limits are enforced before coordinate scanning", () => {
  const limits = Feeds.test.limits;
  const tooLongRing = Array.from({ length: limits.maxRingVertices + 1 }, (_, i) => [-120 + (i % 1000) / 10000, 40 + Math.floor(i / 1000) / 10000]);
  tooLongRing[tooLongRing.length - 1] = tooLongRing[0];
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [tooLongRing] }), false);

  const tooManyRings = Array.from({ length: limits.maxGeometryRings + 1 }, () => square().coordinates[0]);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: tooManyRings }), false);

  const tooManyPolygons = Array.from({ length: limits.maxGeometryPolygons + 1 }, () => square().coordinates);
  assert.equal(Feeds.test.geometryIsUsable({ type: "MultiPolygon", coordinates: tooManyPolygons }), false);

  const ringLength = Math.floor(limits.maxGeometryVertices / 3) + 2;
  const overBudgetRings = Array.from({ length: 3 }, (_, ringIndex) => {
    const ring = Array.from({ length: ringLength - 1 }, (_, i) => [-120 + i / 100000, 40 + ringIndex / 100]);
    ring.push(ring[0]);
    return ring;
  });
  assert.ok(overBudgetRings.every((ring) => ring.length < limits.maxRingVertices));
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: overBudgetRings }), false, "total vertex budget must apply across rings");
});

test("point validation rejects values that could corrupt radius matching", () => {
  assert.equal(Feeds.test.pointIsUsable([-100, 50]), true);
  assert.equal(Feeds.test.pointIsUsable([-100, 50, 10]), true);
  assert.equal(Feeds.test.pointIsUsable(["-100", 50]), false);
  assert.equal(Feeds.test.pointIsUsable([NaN, 50]), false);
  assert.equal(Feeds.test.pointIsUsable([-100, Infinity]), false);
  assert.equal(Feeds.test.pointIsUsable([-181, 50]), false);
  assert.equal(Feeds.test.pointIsUsable([-100, 91]), false);
  assert.equal(Feeds.test.pointIsUsable({ lon: -100, lat: 50 }), false);
});
