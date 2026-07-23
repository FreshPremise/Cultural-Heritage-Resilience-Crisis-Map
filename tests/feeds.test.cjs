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

test("WFIGS uses the current IncidentSize field", { concurrency: false }, async () => {
  await withFetch(async (url) => {
    assert.match(String(url), /IncidentSize/);
    assert.doesNotMatch(String(url), /DailyAcres/);
    assert.match(String(url), /resultOffset=0/);
    return jsonResponse({ features: [{
      properties: { IncidentName: "Test", POOState: "US-OR", IncidentSize: 1200, PercentContained: 25, FireDiscoveryDateTime: 1700000000000 },
      geometry: { type: "Point", coordinates: [-122, 44] },
    }] });
  }, async () => {
    const events = await source("fires")();
    assert.equal(events.length, 1);
    assert.match(events[0].description, /1,200 acres/);
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
      alert_name_en: "Storm warning", feature_name_en: `Area ${i}`, province: "ON",
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
  });
});

test("CWFIS results are not truncated at the old 200-feature cap", { concurrency: false }, async () => {
  const features = Array.from({ length: 225 }, (_, i) => ({
    properties: { area: 600, firstdate: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`, lastdate: "2026-07-20" },
    geometry: square(-120 + i / 1000, 55),
  }));
  await withFetch(async (url) => {
    assert.match(String(url), /count=500/);
    return jsonResponse({ numberMatched: 225, features });
  }, async () => {
    assert.equal((await source("cwfis")()).length, 225);
  });
});

test("USGS M3+ coverage comes from the full weekly feed", { concurrency: false }, async () => {
  await withFetch(async (url) => {
    assert.match(String(url), /2\.5_week\.geojson/);
    return jsonResponse({ features: [{
      id: "two-days-old", properties: { mag: 3.2, place: "Test place", time: Date.now() - 2 * 86400000, url: "https://earthquake.usgs.gov/example" },
      geometry: { type: "Point", coordinates: [-100, 40, 5] },
    }] });
  }, async () => {
    const events = await source("quakes")();
    assert.equal(events.length, 1);
    assert.match(events[0].title, /^M3\.2/);
  });
});

test("only bounded polygon geometry is accepted", () => {
  assert.equal(Feeds.test.geometryIsUsable(square()), true);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Point", coordinates: [-100, 50] }), false);
  assert.equal(Feeds.test.geometryIsUsable({ type: "Polygon", coordinates: [[[999, 50], [0, 0], [1, 1], [999, 50]]] }), false);
});
