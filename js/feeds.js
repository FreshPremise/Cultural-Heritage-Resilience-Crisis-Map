/* Heritage Watch — live hazard feed fetchers and normalizers.
   Every fetcher returns an array of normalized events:
   { id, feed, category, title, area, severity 1-4, sevLabel, time, expires,
     description, link {href,label}|null, source, geometry|null, point|null, radiusKm|null }
   All fetchers are defensive: a failed or malformed feed reports failure and
   never takes the app down. */

(function () {
  "use strict";

  const SEV_LABELS = { 4: "Extreme", 3: "Severe", 2: "Moderate", 1: "Minor" };
  const MAX_JSON_BYTES = 64 * 1024 * 1024;
  const MAX_SOURCE_FEATURES = 5000;

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

  function geometryIsUsable(geometry) {
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") || !Array.isArray(geometry.coordinates)) return false;
    let vertices = 0, invalid = false;
    (function scan(value, depth) {
      if (invalid || depth > 5 || !Array.isArray(value)) { invalid = true; return; }
      if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
        vertices++;
        if (vertices > 500000 || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || value[0] < -180 || value[0] > 180 || value[1] < -90 || value[1] > 90) invalid = true;
        return;
      }
      value.forEach(function (child) { scan(child, depth + 1); });
    })(geometry.coordinates, 0);
    return !invalid && vertices >= 4;
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

  function mkEvent(o) {
    o.sevLabel = SEV_LABELS[o.severity] || "Minor";
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

      out.push(
        mkEvent({
          id: "nws:" + (p.id || f.id || Math.random().toString(36).slice(2)),
          feed: "nws",
          category,
          title,
          area: clip(p.areaDesc, 140),
          severity,
          time: p.onset || p.effective || p.sent || null,
          expires: p.ends || p.expires || null,
          description: clip([p.headline, p.description, p.instruction].filter(Boolean).join("\n\n"), 4000),
          link: p["@id"] || p.id ? { href: p["@id"] || p.id, label: "Official alert record (NWS)" } : null,
          source: p.senderName || "National Weather Service",
          geometry: geometryIsUsable(f.geometry) ? f.geometry : null,
          fips: fips.length ? fips : null,
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
      if (page.length < pageSize || allFeatures.length >= Number(data.numberMatched || 0)) break;
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
          severity,
          time: p.validity_datetime || p.publication_datetime || null,
          expires: p.event_end_datetime || p.expiration_datetime || null,
          description: clip(p.alert_text_en || "", 4000),
          link: { href: "https://weather.gc.ca/index_e.html?layers=alert", label: "Environment Canada warnings" },
          source: "Environment and Climate Change Canada",
          geometry: geometryIsUsable(f.geometry) ? f.geometry : null,
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
      const mag = p.mag;
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      if (!inNorthAmerica(lon, lat)) continue;
      if (!mag || mag < 3) continue;

      const severity = mag >= 6.5 ? 4 : mag >= 5.5 ? 3 : mag >= 4.5 ? 2 : 1;
      const radiusKm = mag >= 6.5 ? 300 : mag >= 5.5 ? 150 : mag >= 4.5 ? 70 : 30;
      out.push(
        mkEvent({
          id: "usgs:" + f.id,
          feed: "quakes",
          category: "quake",
          title: "M" + mag.toFixed(1) + " earthquake — " + (p.place || "unknown location"),
          area: clip(p.place || "", 140),
          severity,
          time: p.time ? new Date(p.time).toISOString() : null,
          expires: null,
          description: "Magnitude " + mag.toFixed(1) + " at " + (p.place || "unknown location") + (typeof c[2] === "number" ? ", depth " + Math.round(c[2]) + " km." : "."),
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
      "&outFields=" + encodeURIComponent("IncidentName,POOState,IncidentSize,PercentContained,FireDiscoveryDateTime") +
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
      if (typeof lon !== "number" || typeof lat !== "number") continue;
      const acres = Number(p.IncidentSize) || 0;
      if (acres < 100) continue;

      const severity = acres >= 50000 ? 4 : acres >= 10000 ? 3 : acres >= 1000 ? 2 : 1;
      const areaKm2 = acres * 0.004047;
      const radiusKm = Math.max(8, Math.sqrt(areaKm2 / Math.PI) + 8);
      const contained = p.PercentContained == null ? null : Math.round(Number(p.PercentContained));
      const st = String(p.POOState || "").replace("US-", "");
      out.push(
        mkEvent({
          id: "fire:" + (p.IncidentName || "") + ":" + lon.toFixed(3) + "," + lat.toFixed(3),
          feed: "fires",
          category: "fire",
          title: (p.IncidentName ? p.IncidentName + " Fire" : "Wildfire") + (st ? " — " + st : ""),
          area: st || "US",
          severity,
          time: p.FireDiscoveryDateTime ? new Date(p.FireDiscoveryDateTime).toISOString() : null,
          expires: null,
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
      const g = geoms[geoms.length - 1];
      if (!g) continue;
      let lon, lat;
      if (g.type === "Point") {
        lon = g.coordinates[0]; lat = g.coordinates[1];
      } else if (g.type === "Polygon") {
        const ring = g.coordinates[0] || [];
        if (!ring.length) continue;
        lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      } else continue;
      if (typeof lon !== "number" || typeof lat !== "number") continue;
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
          severity,
          time: g.date || null,
          expires: null,
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

  // Natural Resources Canada's Canadian Wildland Fire Information System publishes current
  // fire perimeters (the "M3" product) as GeoJSON with an area in hectares. We match
  // organizations directly against the perimeter polygon, so a Canadian institution inside
  // an active fire is flagged precisely — far more accurate than the coarse EONET points.
  function firstCoord(geom) {
    if (!geom) return null;
    if (geom.type === "Polygon") { var r = geom.coordinates[0] || []; return r.length ? r[0] : null; }
    if (geom.type === "MultiPolygon") { var m = (geom.coordinates[0] || [])[0] || []; return m.length ? m[0] : null; }
    return null;
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
      if (page.length < pageSize || allFeatures.length >= Number(data.numberMatched || data.totalFeatures || 0)) break;
    }
    if (allFeatures.length >= MAX_SOURCE_FEATURES) throw new Error("CWFIS result exceeds safe feature limit");
    const out = [];
    for (const f of allFeatures) {
      const p = f.properties || {};
      const ha = Number(p.area) || 0; // hectares
      if (!geometryIsUsable(f.geometry) || ha < 500) continue;
      const acres = ha * 2.47105;
      const severity = ha >= 20000 ? 4 : ha >= 5000 ? 3 : ha >= 500 ? 2 : 1;
      const c = firstCoord(f.geometry) || [];
      out.push(
        mkEvent({
          id: "cwfis:" + (p.firstdate || "") + ":" + (c[0] != null ? c[0].toFixed(3) : Math.random().toString(36).slice(2)) + "," + (c[1] != null ? c[1].toFixed(3) : ""),
          feed: "cwfis",
          category: "fire",
          title: "Active wildfire — Canada",
          area: Math.round(acres).toLocaleString() + " acres burned",
          severity,
          time: p.firstdate || null,
          expires: null,
          description:
            "Active fire perimeter of about " + Math.round(ha).toLocaleString() + " hectares (" +
            Math.round(acres).toLocaleString() + " acres). Perimeter last updated " +
            (p.lastdate ? new Date(p.lastdate).toLocaleDateString() : "recently") +
            ". Individual Canadian fires are not individually named in this feed; the shaded area is the mapped perimeter. Source: Natural Resources Canada, CWFIS.",
          link: { href: "https://cwfis.cfs.nrcan.gc.ca/interactive-map", label: "CWFIS interactive fire map" },
          source: "Natural Resources Canada (CWFIS)",
          geometry: f.geometry,
          fips: null,
          point: c.length ? [c[0], c[1]] : null,
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
    test: { fetchJSON, geometryIsUsable },
  };
})();
