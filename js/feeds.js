/* Heritage Watch — live hazard feed fetchers and normalizers.
   Every fetcher returns an array of normalized events. Canonical fields include
   screeningPriority, screeningPriorityLabel, providerSeverity, responseClass,
   matchMethod, startedAt, observedAt, updatedAt, and expiresAt. The legacy
   severity, sevLabel, time, and expires aliases remain while callers migrate.
   All fetchers are defensive: a failed or malformed feed reports failure and
   never takes the app down. */

(function () {
  "use strict";

  const SEV_LABELS = { 4: "Extreme", 3: "Severe", 2: "Moderate", 1: "Minor" };
  const MAX_JSON_BYTES = 64 * 1024 * 1024;
  const MAX_SOURCE_FEATURES = 5000;
  const MAX_GEOMETRY_VERTICES = 100000;
  const MAX_RING_VERTICES = 50000;
  const MAX_GEOMETRY_RINGS = 2000;
  const MAX_GEOMETRY_POLYGONS = 500;
  const MAX_NWS_ZONE_URLS = 80;
  const MAX_WFIGS_ACRES = 100000000;
  const RESPONSE_CLASSES = new Set(["watch", "warning", "advisory", "observed-event", "unknown"]);
  const MATCH_METHODS = new Set(["published-polygon", "official-zone", "county-approximate", "estimated-radius", "unknown"]);

  async function readResponseText(response, maxBytes) {
    const declared = Number(response.headers && response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Response exceeds " + maxBytes + " bytes");
    if (!response.body || !response.body.getReader) {
      const text = await response.text();
      if (text.length > maxBytes) throw new Error("Response exceeds " + maxBytes + " bytes");
      return text;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let total = 0, text = "";
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch (e) {}
        throw new Error("Response exceeds " + maxBytes + " bytes");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  }

  async function fetchJSON(url, timeoutMs, maxBytes) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
    try {
      const response = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/geo+json, application/json" } });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const text = await readResponseText(response, maxBytes || MAX_JSON_BYTES);
      let data;
      try { data = JSON.parse(text); } catch (e) { throw new Error("Invalid JSON response"); }
      if (data && data.error) {
        const detail = [data.error.message].concat(data.error.details || []).filter(Boolean).join(" — ");
        throw new Error("Provider error" + (detail ? ": " + clip(detail, 300) : ""));
      }
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  function features(data) {
    if (!data || !Array.isArray(data.features)) throw new Error("Feed response has no feature array");
    if (data.features.length > MAX_SOURCE_FEATURES) throw new Error("Feed returned too many features");
    return data.features;
  }

  function knownTotalReached(data, loaded) {
    var raw = data && data.numberMatched != null ? data.numberMatched : data && data.totalFeatures;
    var total = Number(raw);
    return Number.isFinite(total) && total >= 0 && loaded >= total;
  }

  function pointIsUsable(point) {
    return Array.isArray(point) && point.length >= 2 &&
      Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
      point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90;
  }

  function samePosition(a, b) {
    return pointIsUsable(a) && pointIsUsable(b) && a[0] === b[0] && a[1] === b[1];
  }

  function geometryIsUsable(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return false;
    let vertices = 0, rings = 0, polygons = 0;

    function validRing(ring) {
      if (!Array.isArray(ring) || ring.length < 4 || ring.length > MAX_RING_VERTICES) return false;
      if (++rings > MAX_GEOMETRY_RINGS || !samePosition(ring[0], ring[ring.length - 1])) return false;
      const distinct = new Set();
      for (let i = 0; i < ring.length; i++) {
        if (!pointIsUsable(ring[i]) || ++vertices > MAX_GEOMETRY_VERTICES) return false;
        if (i < ring.length - 1) distinct.add(ring[i][0] + "," + ring[i][1]);
      }
      return distinct.size >= 3;
    }

    function validPolygon(polygon) {
      if (!Array.isArray(polygon) || !polygon.length || ++polygons > MAX_GEOMETRY_POLYGONS) return false;
      for (let i = 0; i < polygon.length; i++) if (!validRing(polygon[i])) return false;
      return true;
    }

    if (geometry.type === "Polygon") return validPolygon(geometry.coordinates);
    if (geometry.type !== "MultiPolygon" || !geometry.coordinates.length) return false;
    for (let i = 0; i < geometry.coordinates.length; i++) {
      if (!validPolygon(geometry.coordinates[i])) return false;
    }
    return true;
  }

  function geometryCenter(geometry) {
    if (!geometryIsUsable(geometry)) return null;
    let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach(function (polygon) {
      polygon.forEach(function (ring) {
        ring.forEach(function (point) {
          minLon = Math.min(minLon, point[0]); maxLon = Math.max(maxLon, point[0]);
          minLat = Math.min(minLat, point[1]); maxLat = Math.max(maxLat, point[1]);
        });
      });
    });
    return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
  }

  function inNorthAmerica(lon, lat) {
    return lon >= -172 && lon <= -50 && lat >= 5 && lat <= 84;
  }

  function inUS(lon, lat) {
    return (
      (lat >= 24.2 && lat <= 49.6 && lon >= -125.5 && lon <= -66.5) || // conterminous
      (lat >= 51 && lat <= 72 && lon >= -170 && lon <= -129) ||        // Alaska
      (lat >= 18.4 && lat <= 22.6 && lon >= -161 && lon <= -154.3)     // Hawaii
    );
  }

  function inCanada(lon, lat) {
    return lat >= 41.5 && lat <= 84 && lon >= -141.5 && lon <= -52 && !inUS(lon, lat);
  }

  function clip(s, n) {
    if (!s) return "";
    s = String(s);
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function categorize(title) {
    const t = (title || "").toLowerCase();
    // Air quality first: it is the single most common Canadian alert (wildfire smoke) and
    // would otherwise fall through to the generic "other" bucket, or be misread as fire.
    if (t.includes("air quality") || t.includes("smog")) return "air";
    if (t.includes("tornado")) return "tornado";
    if (t.includes("hurricane") || t.includes("tropical") || t.includes("typhoon") || t.includes("storm surge") || t.includes("cyclone")) return "tropical";
    if (t.includes("flood") || t.includes("rainfall") || t.includes("seiche") || t.includes("tsunami")) return "flood";
    if (t.includes("fire") || t.includes("red flag") || t.includes("smoke")) return "fire";
    if (t.includes("winter") || t.includes("blizzard") || t.includes("snow") || t.includes("ice ") || t.includes("icy") || t.includes("freez") || t.includes("cold") || t.includes("wind chill") || t.includes("arctic")) return "winter";
    if (t.includes("heat")) return "heat";
    if (t.includes("volcan") || t.includes("ashfall")) return "volcano";
    if (t.includes("thunderstorm") || t.includes("squall") || t.includes("wind") || t.includes("storm") || t.includes("dust")) return "storm";
    return "other";
  }

  function responseClass(value, fallback) {
    const normalized = String(value || "").trim().toLowerCase();
    if (/(^|\s)watch$/.test(normalized)) return "watch";
    if (/(^|\s)warning$/.test(normalized)) return "warning";
    if (/(^|\s)advisory$/.test(normalized)) return "advisory";
    if (/(^|\s)statement$/.test(normalized)) return "observed-event";
    return RESPONSE_CLASSES.has(fallback) ? fallback : "unknown";
  }

  function timestamp(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }

  function mkEvent(o) {
    let priority = Number(o.screeningPriority == null ? o.severity : o.screeningPriority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 4) priority = 1;
    o.screeningPriority = priority;
    o.screeningPriorityLabel = SEV_LABELS[priority];
    o.providerSeverity = o.providerSeverity == null || o.providerSeverity === "" ? null : String(o.providerSeverity);
    o.responseClass = RESPONSE_CLASSES.has(o.responseClass) ? o.responseClass : "unknown";
    if (!MATCH_METHODS.has(o.matchMethod)) {
      o.matchMethod = o.geometry ? "published-polygon" :
        o.fips && o.fips.length ? "county-approximate" :
          o.point && o.radiusKm ? "estimated-radius" : "unknown";
    }

    o.startedAt = timestamp(o.startedAt == null ? o.time : o.startedAt);
    o.observedAt = timestamp(o.observedAt);
    o.updatedAt = timestamp(o.updatedAt);
    o.expiresAt = timestamp(o.expiresAt == null ? o.expires : o.expiresAt);

    // Compatibility aliases for the existing map and assistant surfaces.
    o.severity = o.screeningPriority;
    o.sevLabel = o.screeningPriorityLabel;
    o.time = o.startedAt || o.observedAt || o.updatedAt;
    o.expires = o.expiresAt;
    o.affected = [];
    return o;
  }

  /* ---------- 1. NWS active alerts (United States) ---------- */

  const NWS_SKIP = ["test", "small craft", "marine", "gale", "hazardous seas", "rip current", "surf", "beach", "lakeshore", "low water"];

  async function fetchNWS() {
    // The active-alerts endpoint rejects limit/message_type alongside status; request
    // all actual alerts and filter to what matters client-side.
    const data = await fetchJSON("https://api.weather.gov/alerts/active?status=actual");
    const out = [];
    for (const f of features(data)) {
      const p = f.properties || {};
      const title = p.event || "Weather alert";
      const tl = title.toLowerCase();
      if (NWS_SKIP.some((s) => tl.includes(s))) continue;

      const sevRaw = (p.severity || "").toLowerCase();
      const severity = sevRaw === "extreme" ? 4 : sevRaw === "severe" ? 3 : sevRaw === "moderate" ? 2 : 1;
      const category = categorize(title);
      // Keep warnings, watches, and advisories (moderate and up); drop only minor/unknown
      // noise. Advisories — heat, winter, air quality — cover metro counties full of
      // institutions and are exactly what a heritage monitor should surface.
      if (severity < 2) continue;

      // 247 of ~273 active alerts carry no polygon, only county codes (geocode.SAME,
      // a 6-digit "0SSCCC"). Strip the leading digit to a 5-digit county FIPS so we can
      // match against the FIPS baked into each US organization.
      var fips = ((p.geocode && p.geocode.SAME) || []).map(function (s) {
        return String(s).length === 6 ? String(s).slice(1) : String(s);
      });

      // The warned area itself is the alert's UGC zone set, one api.weather.gov URL per
      // zone in affectedZones. Kept (host-checked) so county-matched alerts can be
      // upgraded to their true zone polygons after impact matching (see app.js).
      var rawZoneUrls = Array.isArray(p.affectedZones) ? p.affectedZones : [];
      var allZoneUrls = rawZoneUrls
        .filter(function (u) { return typeof u === "string" && /^https:\/\/api\.weather\.gov\/zones\//.test(u); });
      var zonesTruncated = rawZoneUrls.length !== allZoneUrls.length || allZoneUrls.length > MAX_NWS_ZONE_URLS;
      var zoneUrls = allZoneUrls.slice(0, MAX_NWS_ZONE_URLS);
      var geometry = geometryIsUsable(f.geometry) ? f.geometry : null;

      out.push(
        mkEvent({
          id: "nws:" + (p.id || f.id || Math.random().toString(36).slice(2)),
          feed: "nws",
          category,
          title,
          area: clip(p.areaDesc, 140),
          screeningPriority: severity,
          providerSeverity: p.severity || null,
          responseClass: responseClass(p.event),
          matchMethod: geometry ? "published-polygon" : fips.length ? "county-approximate" : "unknown",
          startedAt: p.onset || p.effective || null,
          updatedAt: p.sent || p.effective || null,
          expiresAt: p.ends || p.expires || null,
          description: clip([p.headline, p.description, p.instruction].filter(Boolean).join("\n\n"), 4000),
          link: p["@id"] || p.id ? { href: p["@id"] || p.id, label: "Official alert record (NWS)" } : null,
          source: p.senderName || "National Weather Service",
          geometry,
          fips: fips.length ? fips : null,
          zones: zoneUrls.length ? zoneUrls : null,
          zonesTruncated,
          point: null,
          radiusKm: null,
        })
      );
    }
    // Highest severity first. Do not cap before impact matching: an alert near the end of
    // the provider response may be the one that intersects a mapped organization.
    out.sort((a, b) => b.severity - a.severity);
    return out;
  }

  /* ---------- 2. Environment and Climate Change Canada alerts ---------- */

  async function fetchECCC() {
    const allFeatures = [];
    const pageSize = 500;
    for (let offset = 0; offset < MAX_SOURCE_FEATURES; offset += pageSize) {
      const data = await fetchJSON("https://api.weather.gc.ca/collections/weather-alerts/items?f=json&limit=" + pageSize + "&offset=" + offset);
      const page = features(data);
      allFeatures.push(...page);
      if (page.length < pageSize || knownTotalReached(data, allFeatures.length)) break;
    }
    if (allFeatures.length >= MAX_SOURCE_FEATURES) throw new Error("ECCC result exceeds safe feature limit");
    const out = [];
    const seen = new Set();
    for (const f of allFeatures) {
      const p = f.properties || {};
      const status = String(p.status_en || "").toLowerCase();
      if (status.includes("ended") || status.includes("cancel")) continue;

      const type = String(p.alert_type || "").toLowerCase();
      const name = p.alert_name_en || p.alert_short_name_en || "Weather alert";
      const colour = String(p.risk_colour_en || "").toLowerCase();
      // Severity from alert type, escalated by the published risk colour.
      let severity = type.includes("warning") ? 3 : type.includes("watch") ? 2 : 1;
      if (colour.includes("red")) severity = 4;
      else if (colour.includes("orange") && severity < 3) severity = 3;
      if (severity < 2) continue;

      const category = categorize(name + " " + (p.alert_short_name_en || ""));
      const area = p.feature_name_en || p.province || "Canada";
      const geometry = geometryIsUsable(f.geometry) ? f.geometry : null;
      // Collapse the many per-zone rows a single warning generates into one event.
      const dedupeKey = "eccc:" + p.alert_code + ":" + name + ":" + area;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      out.push(
        mkEvent({
          id: dedupeKey,
          feed: "eccc",
          category,
          title: name.replace(/\b\w/, (c) => c.toUpperCase()) + " — " + area,
          area: clip(area + (p.province ? ", " + p.province : ""), 140),
          screeningPriority: severity,
          providerSeverity: p.risk_colour_en || p.alert_type || null,
          responseClass: responseClass(type, responseClass(name)),
          matchMethod: geometry ? "published-polygon" : "unknown",
          startedAt: p.validity_datetime || null,
          updatedAt: p.publication_datetime || null,
          expiresAt: p.event_end_datetime || p.expiration_datetime || null,
          description: clip(p.alert_text_en || "", 4000),
          link: { href: "https://weather.gc.ca/index_e.html?layers=alert", label: "Environment Canada warnings" },
          source: "Environment and Climate Change Canada",
          geometry,
          point: null,
          radiusKm: null,
        })
      );
    }
    out.sort((a, b) => b.severity - a.severity);
    return out;
  }

  /* ---------- 3. USGS earthquakes (all of North America) ---------- */

  async function fetchQuakes() {
    const week = await fetchJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson");
    const seen = new Set();
    const out = [];
    for (const f of features(week)) {
      if (!f.id || seen.has(f.id)) continue;
      seen.add(f.id);
      const p = f.properties || {};
      const c = (f.geometry || {}).coordinates || [];
      const lon = c[0], lat = c[1];
      const mag = Number(p.mag);
      if (!pointIsUsable(c)) continue;
      if (!inNorthAmerica(lon, lat)) continue;
      if (!Number.isFinite(mag) || mag < 3) continue;

      const severity = mag >= 6.5 ? 4 : mag >= 5.5 ? 3 : mag >= 4.5 ? 2 : 1;
      const radiusKm = mag >= 6.5 ? 300 : mag >= 5.5 ? 150 : mag >= 4.5 ? 70 : 30;
      out.push(
        mkEvent({
          id: "usgs:" + f.id,
          feed: "quakes",
          category: "quake",
          title: "M" + mag.toFixed(1) + " earthquake — " + (p.place || "unknown location"),
          area: clip(p.place || "", 140),
          screeningPriority: severity,
          providerSeverity: null,
          responseClass: "observed-event",
          matchMethod: "estimated-radius",
          startedAt: p.time || null,
          updatedAt: p.updated || null,
          expiresAt: null,
          description: "Magnitude " + mag.toFixed(1) + " at " + (p.place || "unknown location") + (Number.isFinite(c[2]) ? ", depth " + Math.round(c[2]) + " km." : "."),
          link: p.url ? { href: p.url, label: "USGS event page" } : null,
          source: "US Geological Survey",
          geometry: null,
          point: [lon, lat],
          radiusKm,
        })
      );
    }
    out.sort((a, b) => b.severity - a.severity);
    return out;
  }

  /* ---------- 4. NIFC WFIGS current wildfire incidents (United States) ---------- */

  async function fetchFires() {
    const base = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";
    const common = "?where=" + encodeURIComponent("IncidentTypeCategory='WF' AND IncidentSize>=100") +
      "&outFields=" + encodeURIComponent("IncidentName,POOState,IncidentSize,PercentContained,FireDiscoveryDateTime,ModifiedOnDateTime_dt") +
      "&returnGeometry=true&outSR=4326&f=geojson";
    const allFeatures = [];
    const pageSize = 1000;
    for (let offset = 0; offset < MAX_SOURCE_FEATURES; offset += pageSize) {
      const data = await fetchJSON(base + common + "&resultRecordCount=" + pageSize + "&resultOffset=" + offset, 20000);
      const page = features(data);
      allFeatures.push(...page);
      if (page.length < pageSize) break;
    }
    if (allFeatures.length >= MAX_SOURCE_FEATURES) throw new Error("WFIGS result exceeds safe feature limit");
    const out = [];
    for (const f of allFeatures) {
      const p = f.properties || {};
      const c = (f.geometry || {}).coordinates || [];
      const lon = c[0], lat = c[1];
      if (!pointIsUsable(c) || !inNorthAmerica(lon, lat)) continue;
      const acres = Number(p.IncidentSize);
      if (!Number.isFinite(acres) || acres < 100 || acres > MAX_WFIGS_ACRES) continue;

      const severity = acres >= 50000 ? 4 : acres >= 10000 ? 3 : acres >= 1000 ? 2 : 1;
      const areaKm2 = acres * 0.004047;
      const radiusKm = Math.max(8, Math.sqrt(areaKm2 / Math.PI) + 8);
      const containedValue = Number(p.PercentContained);
      const contained = p.PercentContained == null || !Number.isFinite(containedValue) ? null : Math.max(0, Math.min(100, Math.round(containedValue)));
      const st = String(p.POOState || "").replace("US-", "");
      out.push(
        mkEvent({
          id: "fire:" + (p.IncidentName || "") + ":" + lon.toFixed(3) + "," + lat.toFixed(3),
          feed: "fires",
          category: "fire",
          title: (p.IncidentName ? p.IncidentName + " Fire" : "Wildfire") + (st ? " — " + st : ""),
          area: st || "US",
          screeningPriority: severity,
          providerSeverity: null,
          responseClass: "observed-event",
          matchMethod: "estimated-radius",
          startedAt: p.FireDiscoveryDateTime || null,
          updatedAt: p.ModifiedOnDateTime_dt || null,
          expiresAt: null,
          description:
            Math.round(acres).toLocaleString() + " acres" +
            (contained == null ? "" : ", " + contained + "% contained") +
            ". Impact radius shown is an estimate based on reported size.",
          link: { href: "https://inciweb.wildfire.gov", label: "InciWeb incident information" },
          source: "NIFC / WFIGS",
          geometry: null,
          point: [lon, lat],
          radiusKm,
        })
      );
    }
    out.sort((a, b) => b.severity - a.severity);
    return out;
  }

  /* ---------- 5. NASA EONET (continent-wide: Canada, Mexico, offshore) ---------- */

  const EONET_CATS = { wildfires: "fire", severeStorms: "tropical", volcanoes: "volcano", floods: "flood" };

  async function fetchEONET() {
    const data = await fetchJSON("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=300", 20000);
    const out = [];
    if (!data || !Array.isArray(data.events) || data.events.length > MAX_SOURCE_FEATURES) throw new Error("EONET response has an invalid event array");
    for (const ev of data.events) {
      const catId = ((ev.categories || [])[0] || {}).id;
      const category = EONET_CATS[catId];
      if (!category) continue;

      const geoms = ev.geometry || [];
      if (!Array.isArray(geoms) || geoms.length > 10000) continue;
      const g = geoms[geoms.length - 1];
      if (!g) continue;
      let lon, lat;
      if (g.type === "Point") {
        if (!pointIsUsable(g.coordinates)) continue;
        lon = g.coordinates[0]; lat = g.coordinates[1];
      } else if (g.type === "Polygon") {
        const center = geometryCenter(g);
        if (!center) continue;
        lon = center[0]; lat = center[1];
      } else continue;
      if (!inNorthAmerica(lon, lat)) continue;
      // NWS/WFIGS cover US fires+floods and CWFIS covers Canadian fires; EONET fills the gaps
      // (Mexico, offshore storms/volcanoes) so we don't double-count.
      if ((category === "fire" || category === "flood") && inUS(lon, lat)) continue;
      if (category === "fire" && inCanada(lon, lat)) continue;

      const severity = category === "tropical" || category === "volcano" ? 3 : 2;
      const radiusKm = category === "tropical" ? 300 : category === "volcano" ? 50 : category === "fire" ? 25 : 50;
      const src = (ev.sources || [])[0];
      out.push(
        mkEvent({
          id: "eonet:" + ev.id,
          feed: "eonet",
          category,
          title: clip(ev.title, 120),
          area: category === "tropical" ? "Storm track — latest position shown" : "",
          screeningPriority: severity,
          providerSeverity: null,
          responseClass: "observed-event",
          matchMethod: "estimated-radius",
          startedAt: geoms[0] && geoms[0].date || null,
          observedAt: g.date || null,
          updatedAt: null,
          expiresAt: null,
          description: "Tracked by NASA EONET (" + (catId || "event") + "). Position reflects the most recent observation.",
          link: src && src.url ? { href: src.url, label: "Source: " + (src.id || "event report") } : { href: "https://eonet.gsfc.nasa.gov", label: "NASA EONET" },
          source: "NASA EONET",
          geometry: null,
          point: [lon, lat],
          radiusKm,
        })
      );
    }
    return out;
  }

  /* ---------- 6. CWFIS active fire perimeters (Canada) ---------- */

  // Natural Resources Canada's FireM3 product publishes satellite-derived perimeter
  // estimates as GeoJSON. The polygons are useful for screening, but are not operational
  // incident perimeters and the layer does not consistently name individual fires.
  function formatCoordinate(point) {
    if (!pointIsUsable(point)) return "";
    const lat = Math.abs(point[1]).toFixed(2) + "° " + (point[1] < 0 ? "S" : "N");
    const lon = Math.abs(point[0]).toFixed(2) + "° " + (point[0] < 0 ? "W" : "E");
    return lat + ", " + lon;
  }

  async function fetchCWFIS() {
    const allFeatures = [];
    const pageSize = 500;
    for (let startIndex = 0; startIndex < MAX_SOURCE_FEATURES; startIndex += pageSize) {
      var url = "https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?service=WFS&version=2.0.0&request=GetFeature" +
        "&outputFormat=application/json&srsName=EPSG:4326&typeNames=public:m3_polygons_current&count=" + pageSize +
        "&startIndex=" + startIndex + "&CQL_FILTER=" + encodeURIComponent("area>500");
      const data = await fetchJSON(url, 30000);
      const page = features(data);
      allFeatures.push(...page);
      if (page.length < pageSize || knownTotalReached(data, allFeatures.length)) break;
    }
    if (allFeatures.length >= MAX_SOURCE_FEATURES) throw new Error("CWFIS result exceeds safe feature limit");
    const out = [];
    for (const f of allFeatures) {
      const p = f.properties || {};
      const ha = Number(p.area); // hectares
      if (!Number.isFinite(ha) || ha < 500 || !geometryIsUsable(f.geometry)) continue;
      const acres = ha * 2.47105;
      const severity = ha >= 20000 ? 4 : ha >= 5000 ? 3 : ha >= 500 ? 2 : 1;
      const c = geometryCenter(f.geometry);
      if (!c || !inNorthAmerica(c[0], c[1])) continue;
      const sourceId = clip(f.id || p.fireid || p.fire_id || "", 60);
      const coordinate = formatCoordinate(c);
      const observedAt = timestamp(p.lastdate);
      const fallbackId = (p.firstdate || "unknown-date") + ":" + c[0].toFixed(3) + "," + c[1].toFixed(3) + ":" + ha.toFixed(1);
      out.push(
        mkEvent({
          id: "cwfis:" + (sourceId || fallbackId),
          feed: "cwfis",
          category: "fire",
          title: "Satellite-estimated wildfire perimeter" + (sourceId ? " " + sourceId : "") + " near " + coordinate,
          area: "About " + Math.round(acres).toLocaleString() + " acres in mapped estimate",
          screeningPriority: severity,
          providerSeverity: null,
          responseClass: "observed-event",
          matchMethod: "published-polygon",
          startedAt: p.firstdate || null,
          observedAt: observedAt,
           updatedAt: null,
          expiresAt: null,
          description:
            "Satellite-derived FireM3 perimeter estimate of about " + Math.round(ha).toLocaleString() + " hectares (" +
            Math.round(acres).toLocaleString() + " acres). Source observation date: " +
            (observedAt ? new Date(observedAt).toLocaleDateString() : "not listed") +
            ". This national monitoring product is not an operational incident perimeter, and this layer does not consistently name individual fires. Source: Natural Resources Canada, CWFIS.",
          link: { href: "https://cwfis.cfs.nrcan.gc.ca/interactive-map", label: "CWFIS interactive fire map" },
          source: "Natural Resources Canada (CWFIS)",
          geometry: f.geometry,
          fips: null,
          point: c,
          radiusKm: null,
        })
      );
    }
    out.sort((a, b) => b.severity - a.severity);
    return out;
  }

  window.Feeds = {
    sources: [
      { id: "nws", name: "US weather alerts (NWS)", fetcher: fetchNWS },
      { id: "eccc", name: "Canada weather alerts (ECCC)", fetcher: fetchECCC },
      { id: "fires", name: "US wildfires (NIFC)", fetcher: fetchFires },
      { id: "cwfis", name: "Canada wildfires (CWFIS)", fetcher: fetchCWFIS },
      { id: "quakes", name: "Earthquakes (USGS)", fetcher: fetchQuakes },
      { id: "eonet", name: "Continental events (NASA EONET)", fetcher: fetchEONET },
    ],
    fetchJSON,
    geometryIsUsable,
    test: {
      fetchJSON,
      geometryIsUsable,
      pointIsUsable,
      responseClass,
      mkEvent,
      limits: {
        maxGeometryVertices: MAX_GEOMETRY_VERTICES,
        maxRingVertices: MAX_RING_VERTICES,
        maxGeometryRings: MAX_GEOMETRY_RINGS,
        maxGeometryPolygons: MAX_GEOMETRY_POLYGONS,
      },
    },
  };
})();
