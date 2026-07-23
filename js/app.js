/* Cultural Heritage Resilience — application logic.
   Loads organizations, renders the map, fetches live hazard feeds, computes which
   organizations fall inside each hazard footprint, and drives the panel, popups,
   search, filters, and theme. No build step, no framework — plain modern browser JS. */

(function () {
  "use strict";

  var Security = window.HWSecurity;
  if (!Security) throw new Error("Security helpers failed to load");

  var BASE_ORGS = (window.ORGANIZATIONS || []).map(function (o, i) {
    return Object.assign({ id: "org" + i }, o);
  });

  // The working org list is the curated public dataset plus an optional private overlay of
  // organizations the user has chosen to track — their members, grantees, partners,
  // consortium, or any watchlist at all. It lives in this browser's localStorage and is
  // excluded from assistant access unless the user grants session consent in chat.js.
  // Selected records get ids of their own so the two sets cannot collide.
  var SELECTED_LS = "hw-selected-orgs";
  var LEGACY_SELECTED_LS = "hw-member-orgs";
  var MAX_SELECTED_RECORDS = 10000;
  var MAX_SELECTED_FILE_BYTES = 5 * 1024 * 1024;
  var ORGS = [];
  var orgById = {};
  var orgsByFips = {};
  var orgGrid = {};
  var GRID_DEGREES = 2;
  function loadSelected() {
    try {
      var current = localStorage.getItem(SELECTED_LS);
      var legacy = localStorage.getItem(LEGACY_SELECTED_LS);
      var raw = current || legacy;
      var list = raw ? Security.parsePrivateOrganizations(raw, MAX_SELECTED_RECORDS) : [];
      // Complete the legacy-key migration once. Keeping the fallback key around made the
      // old list reappear after the user explicitly chose "Remove my list".
      if (!current && legacy && list.length) localStorage.setItem(SELECTED_LS, JSON.stringify(list));
      if (legacy) localStorage.removeItem(LEGACY_SELECTED_LS);
      return list;
    } catch (e) { return []; }
  }
  function rebuildOrgs() {
    var picked = loadSelected().map(function (m, i) {
      return Object.assign({ id: "sel" + i, selected: true }, m);
    });
    ORGS = BASE_ORGS.concat(picked);
    orgById = {};
    orgsByFips = {};
    orgGrid = {};
    ORGS.forEach(function (o) {
      orgById[o.id] = o;
      if (o.fips) (orgsByFips[o.fips] = orgsByFips[o.fips] || []).push(o);
      var key = Math.floor(o.lon / GRID_DEGREES) + ":" + Math.floor(o.lat / GRID_DEGREES);
      (orgGrid[key] = orgGrid[key] || []).push(o);
    });
  }
  rebuildOrgs();

  var TYPE_COLOR = { library: "#1f8e76", museum: "#c2632f", archive: "#5d74a8" };
  var TYPE_LABEL = { library: "Libraries", museum: "Museums", archive: "Archives" };
  var TYPE_SINGULAR = { library: "Library", museum: "Museum", archive: "Archive" };
  var COUNTRY_LABEL = { US: "United States", CA: "Canada", MX: "Mexico" };
  var EVENT_LIST_PAGE_SIZE = 250;
  function orgTypeLabel(o) {
    if (o.type === "library" && o.libraryType === "public") return "Public Library";
    if (o.type === "library" && o.libraryType === "academic") return "Academic Library";
    return TYPE_SINGULAR[o.type] || "Organization";
  }

  var CAT_META = {
    tropical: { label: "Storm", icon: "bolt", cls: "cat-tropical" },
    tornado: { label: "Tornado", icon: "bolt", cls: "cat-tornado" },
    storm: { label: "Storm", icon: "bolt", cls: "cat-storm" },
    flood: { label: "Flood", icon: "waves", cls: "cat-flood" },
    fire: { label: "Wildfire", icon: "flame", cls: "cat-fire" },
    quake: { label: "Earthquake", icon: "jagged", cls: "cat-quake" },
    winter: { label: "Winter", icon: "thermometer", cls: "cat-winter" },
    heat: { label: "Heat", icon: "thermometer", cls: "cat-heat" },
    volcano: { label: "Volcano", icon: "triangle", cls: "cat-volcano" },
    air: { label: "Air quality", icon: "haze", cls: "cat-air" },
    other: { label: "Other advisory", icon: "alert", cls: "cat-other" },
  };

  // Colours for both specific event categories and their broader visible filter groups.
  // Map markers use each group's `key` colour so they match the right-hand controls and
  // map legend; specific category tints remain available for event details.
  var CAT_COLOR = {
    tropical: "#b5385f", tornado: "#a32c25", storm: "#d19a1f",
    flood: "#2f6b9e", fire: "#d2601a", quake: "#8a6034",
    winter: "#4f7292", heat: "#d1451b", volcano: "#8f4d3c",
    air: "#6f8f3a", other: "#77705f",
  };
  function catColorExpr(propertyName) {
    var expr = ["match", ["get", propertyName || "cat"]];
    Object.keys(CAT_COLOR).forEach(function (c) { expr.push(c, CAT_COLOR[c]); });
    expr.push(CAT_COLOR.other);
    return expr;
  }

  // Hazard layer groupings for the panel filter chips. Each chip carries the same icon
  // and name its hazards are drawn with on the map, so the legend, chip, and marker read
  // as one symbol set.
  // `key` names the category whose colour represents the group, so a chip is tinted the
  // same as the markers it controls.
  var LAYER_GROUPS = {
    storms: { label: "Storms", icon: "bolt", key: "storm", cats: ["tropical", "tornado", "storm"] },
    flood: { label: "Flooding", icon: "waves", key: "flood", cats: ["flood"] },
    fire: { label: "Wildfire", icon: "flame", key: "fire", cats: ["fire"] },
    quake: { label: "Earthquakes", icon: "jagged", key: "quake", cats: ["quake"] },
    winter: { label: "Winter / heat", icon: "thermometer", key: "heat", cats: ["winter", "heat"] },
    air: { label: "Air quality", icon: "haze", key: "air", cats: ["air"] },
    other: { label: "Other", icon: "alert", key: "other", cats: ["volcano", "other"] },
  };

  function hazardGroupId(category) {
    return Object.keys(LAYER_GROUPS).find(function (group) {
      return LAYER_GROUPS[group].cats.indexOf(category) !== -1;
    }) || "other";
  }

  var ICON = {
    bolt: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    waves: '<path d="M1 7q2.75-2.5 5.5 0t5.5 0 5.5 0 5.5 0"/><path d="M1 12q2.75-2.5 5.5 0t5.5 0 5.5 0 5.5 0"/><path d="M1 17q2.75-2.5 5.5 0t5.5 0 5.5 0 5.5 0"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    jagged: '<path d="M5 3L3.5 8l3 5-3 5L5 21"/><path d="M12 3l-1.5 5 3 5-3 5L12 21"/><path d="M19 3l-1.5 5 3 5-3 5L19 21"/>',
    thermometer: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
    haze: '<path d="M3 7h13"/><path d="M8 11h13"/><path d="M3 15h13"/><path d="M8 19h11"/>',
    triangle: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  };

  function svg(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[name] || ICON.alert) + "</svg>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function catMeta(c) { return CAT_META[c] || CAT_META.other; }
  function el(id) { return document.getElementById(id); }

  /* ---------------- geometry: point in hazard footprint ---------------- */

  function pointInRing(lon, lat, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      var intersect = (yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function pointInPolygon(lon, lat, coords) {
    if (!coords || !coords.length) return false;
    if (!pointInRing(lon, lat, coords[0])) return false;
    for (var h = 1; h < coords.length; h++) if (pointInRing(lon, lat, coords[h])) return false;
    return true;
  }
  function pointInGeometry(lon, lat, geom) {
    if (!geom) return false;
    if (geom.type === "Polygon") return pointInPolygon(lon, lat, geom.coordinates);
    if (geom.type === "MultiPolygon") {
      for (var i = 0; i < geom.coordinates.length; i++) if (pointInPolygon(lon, lat, geom.coordinates[i])) return true;
      return false;
    }
    return false;
  }
  function haversineKm(lon1, lat1, lon2, lat2) {
    var R = 6371, toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function orgInEvent(org, ev) {
    // Prefer a precise polygon; fall back to county-code membership (US zone alerts);
    // finally fall back to a radius around a point (quakes, fires, EONET).
    if (ev.geometry) {
      // Cheap bounding-box reject before the full point-in-polygon test — keeps matching
      // fast even with hundreds of fire perimeters loaded.
      var bb = ev._bbox;
      if (bb && (org.lon < bb[0] || org.lon > bb[2] || org.lat < bb[1] || org.lat > bb[3])) return false;
      return pointInGeometry(org.lon, org.lat, ev.geometry);
    }
    if (ev.fips && org.fips) return ev._fipsSet ? ev._fipsSet.has(org.fips) : ev.fips.indexOf(org.fips) !== -1;
    if (ev.point && ev.radiusKm) return haversineKm(org.lon, org.lat, ev.point[0], ev.point[1]) <= ev.radiusKm;
    return false;
  }

  function orgsInBounds(bounds) {
    if (!bounds) return ORGS;
    var minX = Math.floor(bounds[0] / GRID_DEGREES), maxX = Math.floor(bounds[2] / GRID_DEGREES);
    var minY = Math.floor(bounds[1] / GRID_DEGREES), maxY = Math.floor(bounds[3] / GRID_DEGREES);
    var out = [];
    for (var x = minX; x <= maxX; x++) {
      for (var y = minY; y <= maxY; y++) {
        var bucket = orgGrid[x + ":" + y];
        if (bucket) out = out.concat(bucket);
      }
    }
    return out;
  }

  function candidateOrganizations(ev) {
    if (!ev.geometry && ev.fips && ev.fips.length) {
      var fipsSeen = {};
      var fipsOrgs = [];
      ev.fips.forEach(function (fips) {
        (orgsByFips[fips] || []).forEach(function (org) {
          if (!fipsSeen[org.id]) { fipsSeen[org.id] = true; fipsOrgs.push(org); }
        });
      });
      return fipsOrgs;
    }
    if (ev.geometry && ev._bbox) return orgsInBounds(ev._bbox);
    if (ev.point && ev.radiusKm) {
      var latDelta = ev.radiusKm / 110.574;
      var cosLat = Math.max(0.15, Math.cos(ev.point[1] * Math.PI / 180));
      var lonDelta = ev.radiusKm / (111.32 * cosLat);
      return orgsInBounds([ev.point[0] - lonDelta, ev.point[1] - latDelta, ev.point[0] + lonDelta, ev.point[1] + latDelta]);
    }
    return ORGS;
  }

  /* ---------------- state ---------------- */

  var state = {
    events: [],
    typeOn: { library: true, museum: true, archive: true },
    // Must list every key in LAYER_GROUPS — a group missing here reads as "off" and its
    // hazards vanish from the map and panel while its chip still looks switched on.
    layerOn: { storms: true, flood: true, fire: true, quake: true, winter: true, air: true, other: true },
    selectedEventId: null,
    panelMode: "list",
    listLimit: EVENT_LIST_PAGE_SIZE,
    affectedMode: "now",
    updatedAt: null,
    radarOn: true,
    legendCollapsed: false,
    // Hazard areas containing no mapped organizations are hidden by default. Agencies
    // publish hundreds of them — Canada alone runs ~300 remote wildfire perimeters — and
    // as specks at continental zoom they read as unexplained marks on the map rather than
    // as information. The legend offers a switch to show them.
    showQuiet: false,
  };
  try {
    if (localStorage.getItem("hw-radar") === "0") state.radarOn = false;
    if (localStorage.getItem("hw-quiet") === "1") state.showQuiet = true;
  } catch (e) {}

  function activeCats() {
    var set = {};
    Object.keys(state.layerOn).forEach(function (g) {
      if (state.layerOn[g]) LAYER_GROUPS[g].cats.forEach(function (c) { set[c] = true; });
    });
    return set;
  }
  function visibleEvents() {
    var cats = activeCats();
    return state.events.filter(function (e) { return cats[e.category]; });
  }

  /* ---------------- map ---------------- */

  var map, popup;

  // OpenFreeMap provides key-free OpenStreetMap-derived vector styles for MapLibre.
  // The light and dark styles preserve place and state/province labels.
  function basemapStyle(theme) {
    return "https://tiles.openfreemap.org/styles/" + (theme === "dark" ? "dark" : "positron");
  }

  function currentTheme() { return document.documentElement.getAttribute("data-theme") || "light"; }

  function orgGeoJSON() {
    return {
      type: "FeatureCollection",
      features: ORGS.filter(function (o) { return state.typeOn[o.type]; }).map(function (o) {
        return {
          type: "Feature",
          id: o.id,
          properties: { id: o.id, type: o.type, name: o.name, affected: o._affected ? 1 : 0, selected: o.selected ? 1 : 0 },
          geometry: { type: "Point", coordinates: [o.lon, o.lat] },
        };
      }),
    };
  }

  function isCwfisWildfire(e) {
    return e.feed === "cwfis" && e.category === "fire";
  }

  function shouldRenderHazardArea(e, hasOrgs) {
    return !!hasOrgs || state.showQuiet || isCwfisWildfire(e);
  }

  function hazardAreaGeoJSON() {
    var feats = [];
    visibleEvents().forEach(function (e) {
      var props = {
        sev: e.severity,
        id: e.id,
        hasOrgs: e.affected.length ? 1 : 0,
        cwfis: isCwfisWildfire(e) ? 1 : 0,
      };
      if (!shouldRenderHazardArea(e, props.hasOrgs)) return;
      if (e.geometry) {
        feats.push({ type: "Feature", properties: props, geometry: e.geometry });
      } else if (e.point && e.radiusKm) {
        feats.push({ type: "Feature", properties: props, geometry: circlePolygon(e.point, e.radiusKm) });
      }
    });
    return { type: "FeatureCollection", features: feats };
  }
  // Where to put an event's marker. A point-only event (quake, fire) marks its own
  // coordinate. A polygon event marks the centre of its footprint — never a corner, which
  // is what the raw feed coordinate often is.
  function markerPoint(e) {
    if (e.geometry) {
      var b = geomBounds(e.geometry);
      if (b) return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
    }
    if (e.point) return e.point;
    // County-coded alerts (most US weather warnings, and every Canadian air quality
    // warning) carry no shape and no coordinate at all — which is why the map used to show
    // hardly any weather. Anchor them to the middle of the organizations they affect,
    // which is the part of the alert this tool actually cares about.
    if (e.affected && e.affected.length) {
      var sx = 0, sy = 0, n = 0;
      e.affected.forEach(function (id) {
        var o = orgById[id];
        if (o) { sx += o.lon; sy += o.lat; n++; }
      });
      if (n) return [sx / n, sy / n];
    }
    return null;
  }

  function shouldRenderHazardMarker(e, hasOrgs) {
    if (!e.geometry || hasOrgs) return true;
    // CWFIS publishes Canadian fires as perimeter polygons rather than incident points.
    // Keep their clickable flame markers visible whenever the Wildfire layer is enabled;
    // the secondary quiet-area switch controls other remote polygon alerts only.
    return isCwfisWildfire(e);
  }

  // A lone event stays at its true anchor. Events close enough for their rendered discs
  // to overlap fan out in screen pixels so colours and symbols cannot merge into a
  // misleading hybrid marker.
  var HAZARD_MARKER_OFFSETS = [
    [0, 0],
    [0, -24], [24, 0], [0, 24], [-24, 0],
    [17, -17], [17, 17], [-17, 17], [-17, -17],
    [0, -40], [40, 0], [0, 40], [-40, 0],
  ];
  var HAZARD_MARKER_GROUP_RADIUS = 32;

  function hazardMarkerWorldPixel(coordinates, zoom) {
    var worldSize = 512 * Math.pow(2, zoom);
    var sinLat = Math.sin(coordinates[1] * Math.PI / 180);
    sinLat = Math.max(-0.9999, Math.min(0.9999, sinLat));
    return [
      (coordinates[0] + 180) / 360 * worldSize,
      (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
    ];
  }

  function hazardMarkerCoordinatesFromPixel(point, zoom) {
    var worldSize = 512 * Math.pow(2, zoom);
    var lon = point[0] / worldSize * 360 - 180;
    var mercatorY = Math.PI - 2 * Math.PI * point[1] / worldSize;
    var lat = 180 / Math.PI * Math.atan(Math.sinh(mercatorY));
    return [lon, lat];
  }

  function spreadNearbyHazardMarkers(features, zoom) {
    var groups = [];
    var cells = {};
    features.forEach(function (feature) {
      var pixel = hazardMarkerWorldPixel(feature.geometry.coordinates, zoom);
      var cellX = Math.floor(pixel[0] / HAZARD_MARKER_GROUP_RADIUS);
      var cellY = Math.floor(pixel[1] / HAZARD_MARKER_GROUP_RADIUS);
      var candidates = {};
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          var nearby = cells[(cellX + dx) + "," + (cellY + dy)] || [];
          nearby.forEach(function (groupIndex) { candidates[groupIndex] = true; });
        }
      }
      var chosen = -1;
      Object.keys(candidates).some(function (groupIndex) {
        var group = groups[Number(groupIndex)];
        var touches = group.pixels.some(function (other) {
          var xGap = pixel[0] - other[0];
          var yGap = pixel[1] - other[1];
          return xGap * xGap + yGap * yGap <= HAZARD_MARKER_GROUP_RADIUS * HAZARD_MARKER_GROUP_RADIUS;
        });
        if (touches) chosen = Number(groupIndex);
        return touches;
      });
      if (chosen < 0) {
        chosen = groups.length;
        groups.push({ features: [], pixels: [] });
      }
      feature.properties.offsetSlot = 0;
      groups[chosen].features.push(feature);
      groups[chosen].pixels.push(pixel);
      var ownCell = cellX + "," + cellY;
      if (!cells[ownCell]) cells[ownCell] = [];
      if (cells[ownCell].indexOf(chosen) === -1) cells[ownCell].push(chosen);
    });
    groups.forEach(function (group) {
      if (group.features.length < 2) return;
      group.features.forEach(function (feature, index) {
        var slot = 1 + (index % (HAZARD_MARKER_OFFSETS.length - 1));
        var offset = HAZARD_MARKER_OFFSETS[slot];
        var pixel = hazardMarkerWorldPixel(feature.geometry.coordinates, zoom);
        feature.properties.offsetSlot = slot;
        feature.geometry.coordinates = hazardMarkerCoordinatesFromPixel(
          [pixel[0] + offset[0], pixel[1] + offset[1]],
          zoom
        );
      });
    });
    return features;
  }

  function hazardPointGeoJSON() {
    var feats = [];
    visibleEvents().forEach(function (e) {
      var hasOrgs = e.affected.length ? 1 : 0;
      if (!shouldRenderHazardMarker(e, hasOrgs)) return;
      var p = markerPoint(e);
      if (!p) return;
      var group = hazardGroupId(e.category);
      feats.push({
        type: "Feature",
        properties: {
          id: e.id,
          cat: e.category,
          group: group,
          markerCat: LAYER_GROUPS[group].key,
          sev: e.severity,
          hasOrgs: hasOrgs,
        },
        geometry: { type: "Point", coordinates: p },
      });
    });
    var zoom = map && typeof map.getZoom === "function" ? map.getZoom() : 3.1;
    return { type: "FeatureCollection", features: spreadNearbyHazardMarkers(feats, zoom) };
  }

  /* ---------------- live weather radar overlay ---------------- */

  // RainViewer publishes a rolling set of global precipitation-radar frames as ordinary
  // raster tiles — free, no key, and covering the US, Canada, and Mexico. This is the
  // layer that makes the map read like a weather map: you see the actual storm, not just
  // the polygon an agency drew around it.
  var RADAR = { host: "", path: "", time: 0 };

  function loadRadarFrame() {
    return fetch("https://api.rainviewer.com/public/weather-maps.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        var past = (j.radar && j.radar.past) || [];
        var last = past[past.length - 1];
        if (!last) throw new Error("no radar frames");
        RADAR.host = j.host || "https://tilecache.rainviewer.com";
        RADAR.path = last.path;
        RADAR.time = last.time;
        return RADAR;
      });
  }

  // colour scheme 4 (Rainbow SELEX-IS), smoothed, snow rendered distinctly.
  function radarTiles() {
    return [RADAR.host + RADAR.path + "/256/{z}/{x}/{y}/4/1_1.png"];
  }

  function addRadarLayer() {
    if (!map || !RADAR.path || !map.isStyleLoaded()) return;
    if (map.getSource("radar")) {
      var src = map.getSource("radar");
      if (src.setTiles) src.setTiles(radarTiles());
      return;
    }
    // RainViewer serves real radar only to zoom 7; above that every tile is an identical
    // "Zoom level not supported" placeholder. Declaring maxzoom makes MapLibre stop asking
    // and upscale the z7 tile instead, so zooming in just softens the radar rather than
    // papering the map with error tiles.
    map.addSource("radar", {
      type: "raster", tiles: radarTiles(), tileSize: 256, maxzoom: 7,
      attribution: '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
    });
    // Sits above the basemap but beneath every hazard and organization layer, so dots and
    // alert outlines stay readable on top of the precipitation.
    var before = map.getLayer("hazard-fill") ? "hazard-fill" : undefined;
    map.addLayer({
      id: "radar", type: "raster", source: "radar",
      layout: { visibility: state.radarOn ? "visible" : "none" },
      paint: { "raster-opacity": 0.7, "raster-fade-duration": 0 },
    }, before);
  }

  function setRadar(on) {
    state.radarOn = !!on;
    try { localStorage.setItem("hw-radar", state.radarOn ? "1" : "0"); } catch (e) {}
    var b = el("radar-btn");
    if (b) {
      b.classList.toggle("on", state.radarOn);
      b.setAttribute("aria-pressed", String(state.radarOn));
    }
    if (map && map.getLayer("radar")) {
      map.setLayoutProperty("radar", "visibility", state.radarOn ? "visible" : "none");
    }
    renderLegend();
  }

  function refreshRadar() {
    return loadRadarFrame().then(addRadarLayer).catch(function (e) {
      console.warn("Radar unavailable:", e && e.message);
    });
  }

  /* ---------------- hazard marker icons ---------------- */

  // The category icons are authored once as SVG path data (ICON) and used in three
  // places: the panel list, the filter chips, and — via these rasterized copies — the
  // map markers themselves. Rendering white on the severity-colored disc keeps one
  // symbol set across the whole interface.
  var ICON_IMAGES = null;
  var SELECTED_STAR_IMAGE = null;

  function buildIconImages() {
    var cats = Object.keys(CAT_META);
    var size = 40;
    return Promise.all(cats.map(function (c) {
      return new Promise(function (resolve) {
        var body = ICON[CAT_META[c].icon] || ICON.alert;
        var svgStr = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + size +
          '" height="' + size + '" fill="none" stroke="#ffffff" stroke-width="2.6" ' +
          'stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";
        var img = new Image();
        img.onload = function () {
          try {
            var cv = document.createElement("canvas");
            cv.width = size; cv.height = size;
            var g = cv.getContext("2d");
            g.drawImage(img, 0, 0, size, size);
            resolve([c, g.getImageData(0, 0, size, size)]);
          } catch (e) { resolve([c, null]); }
        };
        img.onerror = function () { resolve([c, null]); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
      });
    })).then(function (pairs) {
      var out = {};
      pairs.forEach(function (p) { if (p[1]) out[p[0]] = p[1]; });
      ICON_IMAGES = out;
      return out;
    });
  }

  // Called both from addDataLayers and once the raster cache resolves, whichever lands
  // last; also re-runs after a theme change, since setStyle drops registered images.
  function addHazardIcons() {
    if (!map || !ICON_IMAGES || !map.getSource("hazard-points")) return;
    Object.keys(ICON_IMAGES).forEach(function (c) {
      var id = "hz-" + c;
      if (!map.hasImage(id)) { try { map.addImage(id, ICON_IMAGES[c]); } catch (e) {} }
    });
    if (map.getLayer("hazard-icon")) return;
    map.addLayer({
      id: "hazard-icon", type: "symbol", source: "hazard-points",
      layout: {
        "icon-image": ["concat", "hz-", ["get", "markerCat"]],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.36, 6, 0.5],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
      paint: {
        "icon-opacity": 1,
      },
    });
  }

  function buildSelectedStarImage() {
    try {
      var size = 48;
      var cv = document.createElement("canvas");
      cv.width = size; cv.height = size;
      var g = cv.getContext("2d");
      var cx = size / 2, cy = size / 2, outer = 20, inner = 8.5;
      g.beginPath();
      for (var i = 0; i < 10; i++) {
        var angle = -Math.PI / 2 + i * Math.PI / 5;
        var radius = i % 2 ? inner : outer;
        var x = cx + Math.cos(angle) * radius;
        var y = cy + Math.sin(angle) * radius;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.fillStyle = "#c7352b";
      g.fill();
      g.lineWidth = 3.5;
      g.strokeStyle = "#ffffff";
      g.stroke();
      return g.getImageData(0, 0, size, size);
    } catch (e) { return null; }
  }

  function addSelectedStarLayer() {
    if (!map || !SELECTED_STAR_IMAGE || !map.getSource("orgs")) return;
    if (!map.hasImage("selected-org-star")) {
      try { map.addImage("selected-org-star", SELECTED_STAR_IMAGE, { pixelRatio: 2 }); } catch (e) {}
    }
    if (map.getLayer("org-selected-star")) return;
    map.addLayer({
      id: "org-selected-star", type: "symbol", source: "orgs",
      filter: ["==", ["get", "selected"], 1],
      layout: {
        "icon-image": "selected-org-star",
        "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.7, 7, 1, 11, 1.25],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "symbol-sort-key": ["get", "affected"],
      },
    });
  }
  function circlePolygon(center, radiusKm) {
    var pts = [], n = 48;
    var lat = center[1] * Math.PI / 180;
    for (var i = 0; i <= n; i++) {
      var brng = (i / n) * 2 * Math.PI;
      var dLat = (radiusKm / 111.32) * Math.cos(brng);
      var dLon = (radiusKm / (111.32 * Math.cos(lat))) * Math.sin(brng);
      pts.push([center[0] + dLon, center[1] + dLat]);
    }
    return { type: "Polygon", coordinates: [pts] };
  }

  var SEV_FILL = { 4: "#a32c25", 3: "#c05427", 2: "#a87b1f", 1: "#8a8374" };

  function addDataLayers() {
    map.addSource("hazard-areas", { type: "geojson", data: hazardAreaGeoJSON() });
    // Hazards touching a mapped organization are drawn at full strength; hazards over areas
    // with no institutions (e.g. weather zones across sparsely-populated Canada) are faded
    // right back so the map stays focused on where heritage collections are actually at risk.
    map.addLayer({
      id: "hazard-fill", type: "fill", source: "hazard-areas",
      paint: {
        "fill-color": ["match", ["get", "sev"], 4, SEV_FILL[4], 3, SEV_FILL[3], 2, SEV_FILL[2], SEV_FILL[1]],
        "fill-opacity": ["case", ["==", ["get", "hasOrgs"], 1],
          ["match", ["get", "sev"], 4, 0.28, 3, 0.21, 0.14],
          ["==", ["get", "cwfis"], 1], 0.13,
          0.035],
      },
    });
    map.addLayer({
      id: "hazard-line", type: "line", source: "hazard-areas",
      paint: {
        "line-color": ["match", ["get", "sev"], 4, SEV_FILL[4], 3, SEV_FILL[3], 2, SEV_FILL[2], SEV_FILL[1]],
        "line-width": ["case",
          ["==", ["get", "hasOrgs"], 1], 1,
          ["==", ["get", "cwfis"], 1], 1.2,
          0.5],
        "line-opacity": ["case",
          ["==", ["get", "hasOrgs"], 1], 0.5,
          ["==", ["get", "cwfis"], 1], 0.65,
          0.15],
      },
    });

    // The disc and white icon use the same visible group as the right-hand controls and
    // legend; severity is carried by marker size.
    map.addSource("hazard-points", { type: "geojson", data: hazardPointGeoJSON() });
    var hazardPointLayers = ["hazard-point"];
    map.addLayer({
      id: "hazard-point", type: "circle", source: "hazard-points",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"],
          2, ["match", ["get", "sev"], 4, 10, 3, 9, 8],
          6, ["match", ["get", "sev"], 4, 14, 3, 12.5, 11]],
        "circle-color": catColorExpr("markerCat"),
        "circle-opacity": 0.94,
        "circle-stroke-width": 1.8,
        "circle-stroke-color": currentTheme() === "dark" ? "#201d17" : "#ffffff",
      },
    });
    addHazardIcons();
    addRadarLayer();

    // Every organization is drawn as its own point (no clustering) so the map reads as a
    // full picture of the sector. A soft halo keeps points legible over labels and terrain.
    // Affected points are enlarged and get a red ring, and sort above the rest. The zoom
    // interpolate must stay top-level (MapLibre rule); the affected size step goes inside it
    // as per-stop `case` outputs, which is the supported data-driven interpolation form.
    var haloRadius = ["interpolate", ["linear"], ["zoom"],
      2, ["case", ["==", ["get", "affected"], 1], 5, 3.6],
      4, ["case", ["==", ["get", "affected"], 1], 6, 4.4],
      7, ["case", ["==", ["get", "affected"], 1], 8.4, 6],
      11, ["case", ["==", ["get", "affected"], 1], 11.5, 8]];
    var pointRadius = ["interpolate", ["linear"], ["zoom"],
      2, ["case", ["==", ["get", "affected"], 1], 3.6, 2.2],
      4, ["case", ["==", ["get", "affected"], 1], 4.6, 3],
      7, ["case", ["==", ["get", "affected"], 1], 6.6, 4.4],
      11, ["case", ["==", ["get", "affected"], 1], 9, 6.4]];
    map.addSource("orgs", { type: "geojson", data: orgGeoJSON() });
    map.addLayer({
      id: "org-halo", type: "circle", source: "orgs",
      paint: {
        "circle-radius": haloRadius,
        "circle-color": currentTheme() === "dark" ? "#171510" : "#ffffff",
        "circle-opacity": 0.85,
      },
    });
    map.addLayer({
      id: "org-point", type: "circle", source: "orgs",
      layout: { "circle-sort-key": ["get", "affected"] },
      paint: {
        "circle-radius": pointRadius,
        "circle-color": ["match", ["get", "type"], "library", TYPE_COLOR.library, "museum", TYPE_COLOR.museum, "archive", TYPE_COLOR.archive, "#888"],
        // Affected points keep the alert ring. Uploaded-list points also retain a subtle
        // base outline beneath their prominent red star as a graceful icon fallback.
        "circle-stroke-width": ["case", ["==", ["get", "affected"], 1], 2.2, ["==", ["get", "selected"], 1], 1.6, 0],
        "circle-stroke-color": ["case", ["==", ["get", "affected"], 1], "#a32c25", currentTheme() === "dark" ? "#eae6dc" : "#201d18"],
      },
    });
    addSelectedStarLayer();

    function showOrganizationAtPoint(point) {
      var hits = map.queryRenderedFeatures(point, { layers: ["org-point"] });
      if (!hits.length) return false;
      showOrgPopup(hits[0].properties.id);
      return true;
    }

    map.on("click", "org-point", function (e) { showOrgPopup(e.features[0].properties.id); });
    map.on("click", "org-selected-star", function (e) { showOrgPopup(e.features[0].properties.id); });
    // Organization points are drawn above alerts. When both occupy the clicked pixels,
    // preserve that visual priority instead of letting the alert handler replace the
    // organization popup a moment later.
    hazardPointLayers.forEach(function (layer) {
      map.on("click", layer, function (e) {
        if (showOrganizationAtPoint(e.point)) return;
        var id = e.features[0].properties.id;
        showHazardPopup(id, e.lngLat);
        selectEvent(id, { frame: false });
      });
    });
    ["org-point", "org-selected-star"].concat(hazardPointLayers).forEach(function (l) {
      map.on("mouseenter", l, function () { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", l, function () { map.getCanvas().style.cursor = ""; });
    });
  }

  function refreshMapData() {
    if (!map || !map.getSource("orgs")) return;
    map.getSource("orgs").setData(orgGeoJSON());
    map.getSource("hazard-areas").setData(hazardAreaGeoJSON());
    map.getSource("hazard-points").setData(hazardPointGeoJSON());
  }

  /* ---------------- org popup ---------------- */

  function eventsForOrg(org) {
    return state.events.filter(function (e) { return e.affected.indexOf(org.id) !== -1; })
      .sort(function (a, b) { return b.severity - a.severity; });
  }

  function showOrgPopup(orgId) {
    var o = orgById[orgId];
    if (!o) return;
    var evs = eventsForOrg(o);
    var website = Security.safeHttpUrl(o.url, { allowHttp: true, rejectCredentials: true });
    var html = '<div class="popup">';
    html += "<h3>" + esc(o.name) + "</h3>";
    html += '<div class="p-meta"><span class="org-dot" style="background:' + TYPE_COLOR[o.type] + '"></span>' +
      esc(orgTypeLabel(o)) + " &middot; " + esc(o.city) + ", " + esc(o.region) +
      " &middot; " + esc(COUNTRY_LABEL[o.country] || o.country) +
      (o.selected ? ' &middot; <span style="color:var(--brand);font-weight:600">On your list</span>' : "") + "</div>";

    if (website) {
      // A deliberate button — the website only opens on an explicit click, never as a side
      // effect of searching for or selecting an organization.
      html += '<div class="p-actions"><a class="visit-btn" href="' + esc(website) + '" target="_blank" rel="noopener noreferrer">' +
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/></svg>Visit website</a></div>';
    } else {
      html += '<div class="p-nourl">Website to be added.</div>';
    }

    if (evs.length) {
      html += '<div class="p-events"><div class="p-events-title">Active events affecting this location</div>';
      evs.forEach(function (e) {
        html += '<div class="p-evt" data-evt="' + esc(e.id) + '"><span class="sdot" style="background:' + SEV_FILL[e.severity] + '"></span><span>' + esc(e.title) + "</span></div>";
      });
      html += "</div>";
    } else {
      html += '<div class="p-none">No active hazards at this location.</div>';
    }
    html += "</div>";

    popup.setLngLat([o.lon, o.lat]).setHTML(html).addTo(map);
    setTimeout(function () {
      document.querySelectorAll(".p-evt").forEach(function (node) {
        node.addEventListener("click", function () { selectEvent(node.getAttribute("data-evt")); });
      });
    }, 0);
  }

  /* ---------------- panel: event list ---------------- */

  function timeAgo(iso) {
    if (!iso) return "";
    var d = new Date(iso).getTime();
    if (isNaN(d)) return "";
    var s = Math.round((Date.now() - d) / 1000);
    if (s < 0) return "upcoming";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  function rankScore(e) {
    // This is a "who needs help" queue, so events touching mapped organizations lead —
    // ranked by severity, then by how many are affected. Events with no mapped
    // organizations in range fall below, still ordered by severity.
    var touches = e.affected.length ? 1 : 0;
    return touches * 1e7 + e.severity * 1000 + Math.min(e.affected.length, 999);
  }

  // Watches are anticipatory — conditions could develop — while warnings and observed
  // events are happening now. The split powers the "needing attention" vs "watchlist"
  // views: one is outreach, the other is pre-positioning.
  function isWatch(e) { return /\bwatch\b/i.test(e.title); }
  function notWatch(e) { return !isWatch(e); }

  // Unique organizations currently inside any visible event's footprint, each with the
  // list of events touching it. This is the "who needs attention" set a support
  // organization acts on. `filterFn` narrows which events count (e.g. isWatch);
  // `ignoreLayerFilters` gives the full picture regardless of panel chips (for the brief).
  function affectedIndex(filterFn, ignoreLayerFilters) {
    var cats = activeCats();
    var byOrg = {};
    state.events.forEach(function (e) {
      if (!ignoreLayerFilters && !cats[e.category]) return;
      if (filterFn && !filterFn(e)) return;
      e.affected.forEach(function (id) {
        if (!byOrg[id]) byOrg[id] = { org: orgById[id], events: [] };
        byOrg[id].events.push(e);
      });
    });
    return Object.keys(byOrg).map(function (id) { return byOrg[id]; })
      .filter(function (x) { return x.org; });
  }

  var GO_ARROW = '<span class="impact-go"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>';

  function renderImpactBar() {
    var bar = el("impact-bar"), wbar = el("watch-bar");
    if (!state.events.length || state.panelMode !== "list") { bar.hidden = true; wbar.hidden = true; return; }
    bar.hidden = false;
    var n = affectedIndex(notWatch).length;
    var evCount = visibleEvents().filter(function (e) { return notWatch(e) && e.affected.length; }).length;
    if (n === 0) {
      bar.classList.add("calm");
      bar.innerHTML = '<span class="impact-num">0</span><span class="impact-text"><b>No mapped organizations</b> are in an active hazard area right now.</span>';
    } else {
      bar.classList.remove("calm");
      bar.innerHTML =
        '<span class="impact-num">' + n + "</span>" +
        '<span class="impact-text"><b>organization' + (n === 1 ? "" : "s") + "</b> in an active hazard area, across " +
        evCount + " event" + (evCount === 1 ? "" : "s") + ". <b>View all &amp; export</b></span>" + GO_ARROW;
    }
    // The anticipation line: organizations inside watch areas, where conditions could
    // develop — the set worth a pre-positioning heads-up rather than urgent outreach.
    var w = affectedIndex(isWatch).length;
    if (!w) { wbar.hidden = true; return; }
    wbar.hidden = false;
    wbar.innerHTML =
      '<span class="impact-num">' + w + "</span>" +
      '<span class="impact-text"><b>on the watchlist</b>: inside a watch area where conditions could develop. <b>View &amp; export</b></span>' + GO_ARROW;
  }

  function renderList() {
    state.panelMode = "list";
    el("event-detail").hidden = true;
    el("affected-view").hidden = true;
    el("event-list").hidden = false;
    el("list-title-row").hidden = false;
    renderImpactBar();

    var evs = visibleEvents().slice().sort(function (a, b) { return rankScore(b) - rankScore(a); });
    el("event-count").textContent = evs.length + " active";
    el("updated").textContent = state.updatedAt ? "Updated " + timeAgo(state.updatedAt) : "";

    var list = el("event-list");
    if (!evs.length) {
      list.innerHTML = '<div class="empty">No active events in the selected layers.</div>';
      return;
    }

    var html = "";
    var shown = evs.slice(0, state.listLimit);
    shown.forEach(function (e) {
      var m = catMeta(e.category);
      var n = e.affected.length;
      var orgLine = n
        ? '<div class="evt-orgs hit"><b>' + n + "</b> organization" + (n === 1 ? "" : "s") + " in the affected area</div>"
        : '<div class="evt-orgs">No mapped organizations in range</div>';
      var when = e.time ? timeAgo(e.time) : "";
      html += '<div class="event-item" data-evt="' + esc(e.id) + '" role="listitem">' +
        '<span class="evt-ic ' + m.cls + '">' + svg(m.icon) + "</span>" +
        '<span class="evt-body">' +
        '<span class="evt-title">' + esc(e.title) + "</span>" +
        '<span class="evt-meta">' + esc(m.label) + (e.area ? " &middot; " + esc(e.area) : "") + (when ? " &middot; " + when : "") + "</span>" +
        orgLine +
        "</span>" +
        '<span class="sev-tag s' + e.severity + '">' + esc(e.sevLabel) + "</span>" +
        "</div>";
    });
    if (shown.length < evs.length) {
      html += '<button class="more-btn list-more" id="event-list-more">Show ' +
        Math.min(EVENT_LIST_PAGE_SIZE, evs.length - shown.length) + " more of " + evs.length + " events</button>";
    }
    list.innerHTML = html;
    list.querySelectorAll(".event-item").forEach(function (node) {
      node.addEventListener("click", function () { selectEvent(node.getAttribute("data-evt")); });
    });
    var more = el("event-list-more");
    if (more) more.addEventListener("click", function () {
      state.listLimit += EVENT_LIST_PAGE_SIZE;
      renderList();
    });
  }

  /* ---------------- panel: event detail ---------------- */

  // `frame` controls whether the map moves. Choosing an event from the panel list frames
  // it, because you asked to go there. Clicking a marker already on screen must NOT move
  // the map — you are pointing at a thing you can see, and yanking the view away is
  // disorienting. It only opens the popup and fills the panel.
  function selectEvent(id, opts) {
    opts = opts || {};
    var e = state.events.find(function (x) { return x.id === id; });
    if (!e) return;
    state.selectedEventId = id;

    if (opts.frame !== false) {
      if (popup) popup.remove();
      if (e.geometry) {
        var b = geomBounds(e.geometry);
        if (b) map.fitBounds(b, { padding: { top: 60, bottom: 60, left: 60, right: 400 }, maxZoom: 8, duration: 700 });
      } else if (e.point) {
        map.easeTo({ center: e.point, zoom: Math.max(map.getZoom(), 6), padding: { right: 380 } });
      }
    }
    renderDetail(e);
  }

  // Small card shown when a hazard marker is clicked, pointing at the panel for the rest.
  function showHazardPopup(eventId, lngLat) {
    var e = state.events.find(function (x) { return x.id === eventId; });
    if (!e) return;
    var m = catMeta(e.category);
    var n = e.affected.length;
    var html = '<div class="popup haz-pop">' +
      '<div class="hp-head">' +
      '<span class="hp-ic" style="background:' + (CAT_COLOR[e.category] || CAT_COLOR.other) + '">' + svg(m.icon) + "</span>" +
      '<div class="hp-text"><div class="hp-title">' + esc(e.title) + "</div>" +
      '<div class="hp-meta">' + esc(m.label) + " &middot; " + esc(e.sevLabel) + "</div></div></div>" +
      (n
        ? '<div class="hp-orgs"><b>' + n + "</b> organization" + (n === 1 ? "" : "s") + " in this area</div>"
        : '<div class="hp-orgs quiet">No mapped organizations in this area</div>') +
      '<div class="hp-cta">Full details are in the panel on the right &rarr;</div>' +
      "</div>";
    popup.setLngLat(lngLat).setHTML(html).addTo(map);
  }

  function geomBounds(geom) {
    var minX = 180, minY = 90, maxX = -180, maxY = -90, any = false;
    function scan(coords) {
      coords.forEach(function (ring) {
        ring.forEach(function (c) {
          any = true;
          if (c[0] < minX) minX = c[0];
          if (c[0] > maxX) maxX = c[0];
          if (c[1] < minY) minY = c[1];
          if (c[1] > maxY) maxY = c[1];
        });
      });
    }
    if (geom.type === "Polygon") scan(geom.coordinates);
    else if (geom.type === "MultiPolygon") geom.coordinates.forEach(scan);
    return any ? [[minX, minY], [maxX, maxY]] : null;
  }

  function renderDetail(e) {
    state.panelMode = "detail";
    el("event-list").hidden = true;
    el("list-title-row").hidden = true;
    el("impact-bar").hidden = true;
    el("watch-bar").hidden = true;
    el("affected-view").hidden = true;
    var d = el("event-detail");
    d.hidden = false;
    d.scrollTop = 0;
    var m = catMeta(e.category);
    var affected = e.affected.map(function (id) { return orgById[id]; }).filter(Boolean)
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    var html = '<button class="back-btn" id="detail-back">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg> All events</button>';

    html += '<div class="detail-head"><span class="evt-ic ' + m.cls + '">' + svg(m.icon) + "</span>" +
      '<div><div class="detail-title">' + esc(e.title) + "</div>" +
      '<div class="detail-sub">' + esc(m.label) + " &middot; " + esc(e.sevLabel) + " severity</div></div></div>";

    html += '<div class="kv">';
    if (e.area) html += kv("Area", esc(e.area));
    if (e.time) html += kv("Onset", fmtTime(e.time) + " (" + timeAgo(e.time) + ")");
    if (e.expires) html += kv("Until", fmtTime(e.expires));
    html += kv("Affected", affected.length + " mapped organization" + (affected.length === 1 ? "" : "s"));
    html += kv("Source", esc(e.source));
    html += "</div>";

    if (e.description) {
      html += '<div class="detail-desc" id="detail-desc">' + esc(e.description) + "</div>";
      if (e.description.length > 320) html += '<button class="more-btn" id="desc-more">Show more</button>';
    }
    var eventLink = e.link && Security.safeHttpUrl(e.link.href, { allowHttp: false, rejectCredentials: true });
    if (eventLink) {
      html += '<div style="margin-top:12px"><a class="link-out" href="' + esc(eventLink) + '" target="_blank" rel="noopener noreferrer">' + esc(e.link.label) + "</a></div>";
    }

    if (affected.length) {
      html += '<div class="affected-head"><span>Organizations in the affected area</span>' +
        '<button class="export-btn" id="detail-export">' + downloadIcon() + "Export CSV</button></div>";
      affected.forEach(function (o) {
        html += '<div class="org-row" data-org="' + esc(o.id) + '">' +
          '<span class="org-dot" style="background:' + TYPE_COLOR[o.type] + '"></span>' +
          '<span class="org-name">' + esc(o.name) + "</span>" +
          '<span class="org-city">' + esc(o.city) + ", " + esc(o.region) + "</span></div>";
      });
    } else {
      html += '<div class="p-none" style="margin-top:16px">No mapped organizations fall inside this event’s footprint. In production, the full 47,000-location dataset would surface smaller institutions here.</div>';
    }

    d.innerHTML = html;
    el("detail-back").addEventListener("click", showList);
    var more = el("desc-more");
    if (more) more.addEventListener("click", function () {
      el("detail-desc").classList.add("expanded");
      more.remove();
    });
    var expBtn = el("detail-export");
    if (expBtn) expBtn.addEventListener("click", function () {
      exportOrgs(affected.map(function (o) { return { org: o, events: [e] }; }), "affected-" + slugify(e.title));
    });
    d.querySelectorAll(".org-row").forEach(function (node) {
      node.addEventListener("click", function () {
        var o = orgById[node.getAttribute("data-org")];
        if (!o) return;
        map.easeTo({ center: [o.lon, o.lat], zoom: Math.max(map.getZoom(), 9), padding: { right: 380 } });
        showOrgPopup(o.id);
      });
    });
  }

  function kv(k, v) { return '<div class="kv-row"><span class="kv-key">' + k + '</span><span class="kv-val">' + v + "</span></div>"; }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function showList() {
    state.selectedEventId = null;
    renderList();
  }

  /* ---------------- consolidated affected-organizations view ---------------- */

  function downloadIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
  }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40); }

  function csvCell(v) {
    v = Security.neutralizeSpreadsheetCell(v);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function exportOrgs(entries, basename) {
    var header = ["Name", "Type", "City", "State/Region", "Country", "Lat", "Lon", "Website", "FIPS", "On your list", "Active hazards"];
    var rows = [header];
    entries.slice().sort(function (a, b) { return a.org.name.localeCompare(b.org.name); }).forEach(function (x) {
      var haz = x.events.map(function (e) { return e.title; }).join("; ");
      rows.push([
        x.org.name, x.org.type, x.org.city, x.org.region,
        COUNTRY_LABEL[x.org.country] || x.org.country, x.org.lat, x.org.lon,
        x.org.url || "", x.org.fips || "", x.org.selected ? "yes" : "", haz,
      ]);
    });
    var csv = rows.map(function (r) { return r.map(csvCell).join(","); }).join("\r\n");
    var stamp = new Date().toISOString().slice(0, 10);
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "heritage-resilience-" + basename + "-" + stamp + ".csv";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  function showAffected(mode) {
    mode = mode === "watch" ? "watch" : "now";
    state.panelMode = "affected";
    state.affectedMode = mode;
    state.selectedEventId = null;
    if (popup) popup.remove();
    el("event-list").hidden = true;
    el("list-title-row").hidden = true;
    el("impact-bar").hidden = true;
    el("watch-bar").hidden = true;
    el("event-detail").hidden = true;
    var v = el("affected-view");
    v.hidden = false;
    v.scrollTop = 0;

    var entries = affectedIndex(mode === "watch" ? isWatch : notWatch);
    // Group by country + region, regions ordered by number affected.
    var groups = {};
    entries.forEach(function (x) {
      var key = (COUNTRY_LABEL[x.org.country] || x.org.country) + " · " + x.org.region;
      (groups[key] = groups[key] || []).push(x);
    });
    var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length || a.localeCompare(b); });

    var html = '<button class="back-btn" id="affected-back">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg> All events</button>';
    html += '<div class="detail-title-row"><div class="detail-title">' +
      (mode === "watch" ? "Watchlist: potential impacts" : "Organizations needing attention") + "</div>" +
      (entries.length ? '<button class="export-btn" id="affected-export">' + downloadIcon() + "Export all</button>" : "") + "</div>";
    html += '<div class="detail-sub">' + entries.length + " organization" + (entries.length === 1 ? "" : "s") +
      (mode === "watch"
        ? " inside a watch area where conditions could develop, across "
        : " inside an active hazard area, across ") +
      keys.length + " state" + (keys.length === 1 ? "" : "s") + "/region" + (keys.length === 1 ? "" : "s") + ".</div>";
    html += '<button class="more-btn" id="affected-switch">' +
      (mode === "watch" ? "&larr; Back to current impacts" : "View watchlist: potential impacts &rarr;") + "</button>";

    if (!entries.length) {
      html += '<div class="p-none" style="margin-top:18px">' +
        (mode === "watch"
          ? "No mapped organizations are currently inside a watch area in the selected layers."
          : "No mapped organizations are currently inside an active hazard footprint in the selected layers.") + "</div>";
    }
    keys.forEach(function (k, ki) {
      var list = groups[k].slice().sort(function (a, b) { return b.events.length - a.events.length || a.org.name.localeCompare(b.org.name); });
      html += '<div class="region-head">' + esc(k) + '<span class="rc">' + list.length + "</span>" +
        '<button class="export-btn draft-btn" data-ri="' + ki + '">' + mailIcon() + "Draft outreach</button></div>";
      list.forEach(function (x) {
        var top = x.events.slice().sort(function (a, b) { return b.severity - a.severity; })[0];
        html += '<div class="org-row" data-org="' + esc(x.org.id) + '">' +
          '<span class="org-dot" style="background:' + TYPE_COLOR[x.org.type] + '"></span>' +
          '<span class="org-name">' + esc(x.org.name) +
          ' <span style="color:var(--ink-3);font-size:11.5px">: ' + esc(top.title) + (x.events.length > 1 ? " +" + (x.events.length - 1) : "") + "</span></span>" +
          '<span class="org-city">' + esc(x.org.city) + "</span></div>";
      });
    });
    v.innerHTML = mode === "watch" ? html.replace(/\s*—\s*/g, ": ") : html;
    el("affected-back").addEventListener("click", showList);
    el("affected-switch").addEventListener("click", function () { showAffected(mode === "watch" ? "now" : "watch"); });
    var exp = el("affected-export");
    if (exp) exp.addEventListener("click", function () {
      exportOrgs(entries, mode === "watch" ? "watchlist-organizations" : "affected-organizations");
    });
    v.querySelectorAll(".draft-btn").forEach(function (node) {
      node.addEventListener("click", function () {
        var k = keys[+node.getAttribute("data-ri")];
        if (k) openOutreach(k, groups[k], mode);
      });
    });
    v.querySelectorAll(".org-row").forEach(function (node) {
      node.addEventListener("click", function () {
        var o = orgById[node.getAttribute("data-org")];
        if (!o) return;
        map.easeTo({ center: [o.lon, o.lat], zoom: Math.max(map.getZoom(), 9), padding: { right: 380 } });
        showOrgPopup(o.id);
      });
    });
  }

  /* ---------------- outreach drafts ---------------- */

  function mailIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>';
  }

  // A ready-to-edit outreach email for one region's affected (or watch-area) organizations.
  // Plain template text the user copies into their own mail client — nothing is sent from
  // here. The assistant panel can rewrite/tone-shift it if the user pastes it there.
  function openOutreach(regionKey, list, mode) {
    var hazardSet = {};
    list.forEach(function (x) { x.events.forEach(function (e) { hazardSet[catMeta(e.category).label.toLowerCase()] = true; }); });
    var hazNames = Object.keys(hazardSet).join(", ") || "hazard";
    var lines = list.slice().sort(function (a, b) { return a.org.name.localeCompare(b.org.name); }).map(function (x) {
      var top = x.events.slice().sort(function (a, b) { return b.severity - a.severity; })[0];
      return "  • " + x.org.name + (x.org.city ? " (" + x.org.city + ")" : "") + " — " + top.title;
    });
    var subject, body;
    if (mode === "watch") {
      subject = "Heads-up: " + hazNames + " watch for the " + regionKey + " area";
      body = "Dear colleagues,\n\n" +
        "Forecasts indicate " + hazNames + " conditions may develop in your area. The following locations are inside the current watch area:\n\n" +
        lines.join("\n") + "\n\n" +
        "This is a precautionary heads-up. Now is a good moment to review your emergency plan, confirm staff contact trees, and move vulnerable collections away from exposure points (windows, basements, ground floors as appropriate to the hazard).\n\n" +
        "If conditions worsen we will follow up — and don't hesitate to reach out if we can help you prepare.\n\n" +
        "With support,\n[Your name]\n[Your organization / contact details]";
    } else {
      subject = "Checking in: " + hazNames + " affecting the " + regionKey + " area";
      body = "Dear colleagues,\n\n" +
        "We are monitoring " + hazNames + " conditions currently affecting your area and wanted to check in on the following locations:\n\n" +
        lines.join("\n") + "\n\n" +
        "If your institution needs support — emergency supplies, salvage and recovery assistance, temporary storage, or help documenting damage — please reply and we will mobilize what we can.\n\n" +
        "No response is needed if you are unaffected; we simply want you to know we are watching and ready to help.\n\n" +
        "With concern and support,\n[Your name]\n[Your organization / contact details]";
    }
    el("outreach-title").textContent = "Outreach draft — " + regionKey;
    el("outreach-text").value = "Subject: " + subject + "\n\n" + body;
    el("outreach").showModal();
  }

  /* ---------------- stats + filters ---------------- */

  function renderStats() {
    var counts = { library: 0, museum: 0, archive: 0 }, picked = 0;
    ORGS.forEach(function (o) { counts[o.type]++; if (o.selected) picked++; });
    el("stats").textContent = ORGS.length + " organizations · " +
      counts.library + " libraries · " + counts.museum + " museums · " + counts.archive + " archives" +
      (picked ? " · " + picked + " selected" : "");
  }

  function renderAboutHazardIcons() {
    var groups = ["storms", "flood", "fire", "quake", "winter", "air"];
    var host = el("about-hazard-icons");
    var primary = el("about-hazard-symbol");
    if (!host || !primary) return;
    host.innerHTML = groups.map(function (g) {
      var meta = LAYER_GROUPS[g];
      return '<span class="about-hazard-item"><span class="haz-key" style="background:' + CAT_COLOR[meta.key] + '">' +
        svg(meta.icon) + "</span>" + esc(meta.label) + "</span>";
    }).join("");
    var storm = LAYER_GROUPS.storms;
    primary.innerHTML = '<span class="haz-key" style="background:' + CAT_COLOR[storm.key] + '">' + svg(storm.icon) + "</span>";
  }

  function renderLegend() {
    // Deliberately does NOT repeat the organization-type key — the filter chips in the
    // panel already carry those colours and are interactive. This explains only what the
    // chips can't: what the coloured markers on the map mean.
    var quiet = countQuietAreas();
    var hazRows = legendHazardGroups().map(function (g) {
      var meta = LAYER_GROUPS[g];
      return '<div class="legend-row"><span class="haz-key" style="background:' + CAT_COLOR[meta.key] + '">' +
        svg(meta.icon) + "</span>" + esc(meta.label) + "</div>";
    }).join("");

    var legend = el("legend");
    legend.classList.toggle("collapsed", state.legendCollapsed);
    legend.innerHTML =
      '<button class="legend-collapse" id="legend-collapse" aria-expanded="' + (!state.legendCollapsed) + '" aria-controls="legend-body" aria-label="' +
        (state.legendCollapsed ? "Open map legend" : "Collapse map legend") + '">' +
        '<span>Map legend</span>' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>' +
      '</button>' +
      '<div class="legend-body" id="legend-body"' + (state.legendCollapsed ? " hidden" : "") + '>' +
      (hazRows
        ? '<div class="legend-title">Hazards on the map</div>' + hazRows +
          '<div class="legend-note">Each marker is one alert; bigger means more severe. Shaded patches are official alert boundaries where an agency published one.</div>'
        : '<div class="legend-title">Hazards on the map</div><div class="legend-note" style="border:0;padding-top:0">No active hazards in the selected layers.</div>') +

      '<div class="legend-title" style="margin-top:8px">Organizations</div>' +
      '<div class="legend-row"><span class="swatch alert"></span>Inside a hazard area</div>' +
      (ORGS.some(function (o) { return o.selected; })
        ? '<div class="legend-row"><span class="swatch selected"></span>On your uploaded list</div>'
        : "") +

      (state.radarOn
        ? '<div class="legend-title" style="margin-top:8px">Weather radar</div>' +
          '<div class="legend-row"><span class="radar-scale"></span></div>' +
          '<div class="legend-note" style="border:0;padding-top:2px">Live precipitation, light to heavy. ' +
          (RADAR.time ? "Updated " + timeAgo(new Date(RADAR.time * 1000).toISOString()) + "." : "") + "</div>"
        : "") +

      (quiet
        ? '<button class="legend-toggle" id="quiet-toggle">' +
          (state.showQuiet
            ? "Hide " + quiet + " alert area" + (quiet === 1 ? "" : "s") + " with no organizations"
            : "Show " + quiet + " hidden alert area" + (quiet === 1 ? "" : "s") + " with no organizations") +
          "</button>"
        : "") +
      "</div>";

    el("legend-collapse").addEventListener("click", function () {
      state.legendCollapsed = !state.legendCollapsed;
      renderLegend();
    });

    var qt = el("quiet-toggle");
    if (qt) qt.addEventListener("click", function () {
      state.showQuiet = !state.showQuiet;
      try { localStorage.setItem("hw-quiet", state.showQuiet ? "1" : "0"); } catch (e) {}
      refreshMapData();
      renderLegend();
    });
  }

  // Show only groups that actually have a marker on the map, in the same order and with
  // the same names, icons, and colours as the hazard controls in the right-hand panel.
  function legendHazardGroups() {
    var counts = {};
    hazardPointGeoJSON().features.forEach(function (f) {
      counts[f.properties.group] = (counts[f.properties.group] || 0) + 1;
    });
    return Object.keys(LAYER_GROUPS).filter(function (group) { return counts[group]; });
  }

  // How many hazard areas are being withheld because nothing we track sits inside them.
  function countQuietAreas() {
    var cats = activeCats(), n = 0;
    state.events.forEach(function (e) {
      if (!cats[e.category] || e.affected.length || isCwfisWildfire(e)) return;
      if (e.geometry || (e.point && e.radiusKm)) n++;
    });
    return n;
  }
  function legendRow(kind, color, label) {
    return '<div class="legend-row"><span class="swatch ' + (kind === "area" ? "area" : "") + '" style="background:' + color + '"></span>' + label + "</div>";
  }

  function buildFilters() {
    // Guard against the failure above ever recurring silently.
    Object.keys(LAYER_GROUPS).forEach(function (g) {
      if (!(g in state.layerOn)) state.layerOn[g] = true;
    });
    var tf = el("type-filters");
    ["library", "museum", "archive"].forEach(function (t) {
      var b = document.createElement("button");
      b.className = "chip";
      b.dataset.type = t;
      b.setAttribute("aria-pressed", "true");
      b.innerHTML = '<span class="cdot" style="background:' + TYPE_COLOR[t] + '"></span>' + TYPE_LABEL[t];
      b.addEventListener("click", function () { setTypeFilter(t, !state.typeOn[t]); });
      tf.appendChild(b);
    });

    var lf = el("layer-filters");
    Object.keys(LAYER_GROUPS).forEach(function (g) {
      var b = document.createElement("button");
      b.className = "chip";
      b.dataset.layer = g;
      b.setAttribute("aria-pressed", "true");
      var col = CAT_COLOR[LAYER_GROUPS[g].key] || CAT_COLOR.other;
      b.innerHTML = '<span class="chip-ic" style="color:' + col + '">' + svg(LAYER_GROUPS[g].icon) + "</span>" +
        esc(LAYER_GROUPS[g].label);
      b.addEventListener("click", function () { setLayerFilter(g, !state.layerOn[g]); });
      lf.appendChild(b);
    });
  }

  function setTypeFilter(t, on) {
    state.typeOn[t] = !!on;
    var chip = document.querySelector('#type-filters [data-type="' + t + '"]');
    if (chip) chip.setAttribute("aria-pressed", String(state.typeOn[t]));
    refreshMapData();
  }
  function setLayerFilter(g, on) {
    state.layerOn[g] = !!on;
    state.listLimit = EVENT_LIST_PAGE_SIZE;
    var chip = document.querySelector('#layer-filters [data-layer="' + g + '"]');
    if (chip) chip.setAttribute("aria-pressed", String(state.layerOn[g]));
    refreshMapData();
    if (state.panelMode === "affected") showAffected(state.affectedMode);
    else showList();
  }

  /* ---------------- search ---------------- */

  function setupSearch() {
    var input = el("search"), box = el("search-results"), active = -1, matches = [];
    function close() { box.hidden = true; active = -1; }
    function run() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      matches = ORGS.filter(function (o) {
        return o.name.toLowerCase().indexOf(q) !== -1 ||
          o.city.toLowerCase().indexOf(q) !== -1 ||
          o.region.toLowerCase().indexOf(q) !== -1;
      }).sort(function (a, b) {
        function score(o) {
          var name = o.name.toLowerCase(), city = o.city.toLowerCase(), region = o.region.toLowerCase();
          if (name === q) return 0;
          if (name.indexOf(q) === 0) return 1;
          if (city === q || region === q) return 2;
          if (city.indexOf(q) === 0 || region.indexOf(q) === 0) return 3;
          return 4;
        }
        return score(a) - score(b) || a.name.localeCompare(b.name);
      });
      if (!matches.length) {
        box.innerHTML = '<div class="sr-empty">No institution, city, or state matches “' + esc(input.value) + '”</div>';
        box.hidden = false; return;
      }
      var shown = matches.slice(0, 8);
      var typeHint = /^(library|libraries|museum|museums|archive|archives)$/.test(q);
      box.innerHTML = (matches.length > 1
        ? '<div class="sr-item sr-all" data-action="all" role="option"><div class="sr-name">Show all ' + matches.length + ' matches</div>' +
          '<div class="sr-meta">' + (typeHint ? "For all organizations of this type, use the filter buttons." : "Center every matching institution on the map.") + '</div></div>'
        : "") + shown.map(function (o, i) {
        return '<div class="sr-item" data-i="' + i + '" role="option"><div class="sr-name">' + esc(o.name) + "</div>" +
          '<div class="sr-meta">' + esc(orgTypeLabel(o)) + " &middot; " + esc(o.city) + ", " + esc(o.region) + "</div></div>";
      }).join("");
      box.hidden = false;
      box.querySelectorAll(".sr-item").forEach(function (node) {
        node.addEventListener("click", function () { activate(node, shown); });
      });
    }
    function activate(node, shown) {
      if (node.getAttribute("data-action") === "all") frame(matches);
      else pick(shown[+node.getAttribute("data-i")]);
    }
    function frame(orgs) {
      if (orgs.length === 1) { pick(orgs[0]); return; }
      input.value = "";
      close();
      if (popup) popup.remove();
      var west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
      orgs.forEach(function (o) {
        west = Math.min(west, o.lon); east = Math.max(east, o.lon);
        south = Math.min(south, o.lat); north = Math.max(north, o.lat);
      });
      if (west === east && south === north) map.easeTo({ center: [west, south], zoom: 10, duration: 700 });
      else map.fitBounds([[west, south], [east, north]], { padding: 70, maxZoom: 10, duration: 700 });
    }
    function pick(o) {
      if (!o) return;
      input.value = "";
      close();
      map.easeTo({ center: [o.lon, o.lat], zoom: 10 });
      showOrgPopup(o.id);
    }
    input.addEventListener("input", run);
    input.addEventListener("keydown", function (e) {
      if (box.hidden) return;
      var items = box.querySelectorAll(".sr-item");
      if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(active + 1, items.length - 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && items[active]) activate(items[active], matches.slice(0, 8));
        else frame(matches);
        return;
      }
      else if (e.key === "Escape") { close(); return; }
      items.forEach(function (n, i) { n.classList.toggle("active", i === active); });
    });
    document.addEventListener("click", function (e) {
      if (!el("search-wrap").contains(e.target)) close();
    });
  }

  /* ---------------- feeds ---------------- */

  var feedCache = {};
  var feedGeneration = 0;
  var FEED_STALE_TTL_MS = 60 * 60 * 1000;

  function eventIsExpired(event, now) {
    if (!event || !event.expires) return false;
    var expiry = new Date(event.expires).getTime();
    return Number.isFinite(expiry) && expiry < now - 2 * 60 * 1000;
  }

  function setFeedStatus(states) {
    el("feed-status").innerHTML = Feeds.sources.map(function (s) {
      var info = states[s.id] || { status: "pending" };
      var status = typeof info === "string" ? info : info.status;
      var detail = status;
      if (info.lastSuccess) detail += " — last loaded " + timeAgo(info.lastSuccess);
      if (info.reason) detail += " — " + info.reason;
      return '<span class="dot ' + status + '" title="' + esc(s.name) + ': ' + esc(detail) + '"></span>';
    }).join("");
  }

  function computeImpact() {
    ORGS.forEach(function (o) { o._affected = false; });
    state.events.forEach(function (e) {
      e.affected = [];
      if (e.fips && !e._fipsSet) e._fipsSet = new Set(e.fips);
      if (e.geometry && !e._bbox) {
        var b = geomBounds(e.geometry);
        e._bbox = b ? [b[0][0], b[0][1], b[1][0], b[1][1]] : null;
      }
      candidateOrganizations(e).forEach(function (o) {
        if (orgInEvent(o, e)) { e.affected.push(o.id); o._affected = true; }
      });
    });
  }

  function loadFeeds() {
    var generation = ++feedGeneration;
    var btn = el("refresh-btn");
    btn.classList.add("busy");
    btn.disabled = true;
    var statuses = {};
    Feeds.sources.forEach(function (s) {
      statuses[s.id] = { status: "pending", lastSuccess: feedCache[s.id] && feedCache[s.id].lastSuccess };
    });
    setFeedStatus(statuses);

    var jobs = Feeds.sources.map(function (s) {
      return s.fetcher()
        .then(function (evs) {
          if (generation !== feedGeneration) return;
          var loadedAt = new Date().toISOString();
          feedCache[s.id] = { events: Array.isArray(evs) ? evs : [], lastSuccess: loadedAt };
          statuses[s.id] = { status: "ok", lastSuccess: loadedAt };
        })
        .catch(function (err) {
          if (generation !== feedGeneration) return;
          statuses[s.id] = {
            status: feedCache[s.id] ? "stale" : "fail",
            lastSuccess: feedCache[s.id] && feedCache[s.id].lastSuccess,
          };
          console.warn("Feed failed:", s.id, err && err.message);
        })
        .finally(function () { if (generation === feedGeneration) setFeedStatus(statuses); });
    });

    Promise.allSettled(jobs).then(function () {
      if (generation !== feedGeneration) return;
      var all = [];
      var now = Date.now();
      Feeds.sources.forEach(function (s) {
        var cached = feedCache[s.id];
        if (!cached) return;
        var age = now - new Date(cached.lastSuccess).getTime();
        if (!Number.isFinite(age) || age > FEED_STALE_TTL_MS) {
          statuses[s.id] = { status: "fail", lastSuccess: cached.lastSuccess, reason: "cached data exceeded the one-hour safety limit" };
          return;
        }
        all = all.concat(cached.events.filter(function (event) { return !eventIsExpired(event, now); }));
      });
      // Dedupe by id.
      var byId = {};
      all.forEach(function (e) { byId[e.id] = e; });
      state.events = Object.keys(byId).map(function (k) { return byId[k]; });
      // Report the oldest contributing source success. Showing the newest one made the
      // whole application look current while a different source was stale.
      state.updatedAt = Feeds.sources.reduce(function (oldest, s) {
        var cached = feedCache[s.id];
        var loaded = cached && now - new Date(cached.lastSuccess).getTime() <= FEED_STALE_TTL_MS ? cached.lastSuccess : null;
        return loaded && (!oldest || loaded < oldest) ? loaded : oldest;
      }, null);
      computeImpact();
      refreshMapData();
      renderTrend(recordHistory(affectedIndex(notWatch, true).length));
      renderLegend();
      refreshRadar();
      var sel = state.selectedEventId && state.events.find(function (e) { return e.id === state.selectedEventId; });
      if (state.panelMode === "affected") {
        showAffected(state.affectedMode);
      } else if (sel) {
        renderDetail(sel);
      } else {
        showList();
      }
      btn.classList.remove("busy");
      btn.disabled = false;
      setFeedStatus(statuses);
    });
  }

  /* ---------------- theme ---------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("hw-theme", theme); } catch (e) {}
    if (map && map.isStyleLoaded()) {
      map.setStyle(basemapStyle(theme));
      map.once("styledata", function () { addDataLayers(); refreshMapData(); });
    }
  }

  function initTheme() {
    var saved;
    try { saved = localStorage.getItem("hw-theme"); } catch (e) {}
    if (saved !== "light" && saved !== "dark") saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", saved);
  }

  /* ---------------- init ---------------- */

  var DEFAULT_VIEW = { center: [-96, 44], zoom: 3.1 };

  // Small custom control that returns the map to the continental default view.
  function ResetViewControl() {}
  ResetViewControl.prototype.onAdd = function (m) {
    this._map = m;
    var c = document.createElement("div");
    c.className = "maplibregl-ctrl maplibregl-ctrl-group";
    var b = document.createElement("button");
    b.type = "button";
    b.title = "Reset to default view";
    b.setAttribute("aria-label", "Reset to default view");
    b.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.36 2.64L3 8"/><path d="M3 4v4h4"/></svg>';
    b.onclick = function () { resetView(); };
    c.appendChild(b);
    this._container = c;
    return c;
  };
  ResetViewControl.prototype.onRemove = function () { this._container.remove(); this._map = undefined; };

  function resetView() {
    if (map) map.easeTo({ center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom, duration: 600 });
  }

  /* ---------------- history: 24-hour impact trend ---------------- */

  var HIST_LS = "hw-history";

  function recordHistory(nowCount) {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem(HIST_LS) || "[]"); } catch (e) {}
    if (!Array.isArray(arr)) arr = [];
    arr.push({ t: Date.now(), a: nowCount });
    var cutoff = Date.now() - 24 * 3600 * 1000;
    arr = arr.filter(function (p) { return p && p.t >= cutoff; }).slice(-400);
    try { localStorage.setItem(HIST_LS, JSON.stringify(arr)); } catch (e) {}
    return arr;
  }

  function renderTrend(arr) {
    var t = el("trend");
    if (!t) return;
    if (!arr || arr.length < 2) { t.innerHTML = ""; t.removeAttribute("title"); return; }
    var w = 64, h = 16;
    var max = Math.max.apply(null, arr.map(function (p) { return p.a; }));
    var t0 = arr[0].t, span = Math.max(1, arr[arr.length - 1].t - t0);
    var pts = arr.map(function (p) {
      var x = ((p.t - t0) / span) * (w - 2) + 1;
      var y = h - 2 - (max ? (p.a / max) * (h - 4) : 0);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    t.innerHTML = '<svg viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
    t.title = "Organizations in active hazard areas, last 24 h — now " + arr[arr.length - 1].a + ", peak " + max;
  }

  /* ---------------- situation brief ---------------- */

  // A printable, self-contained snapshot of the whole picture: key numbers, who needs
  // attention now, the watchlist, and the top events for the morning email, the board
  // packet, or the response call. Opens in a new tab (print → save as PDF); if the popup
  // is blocked it downloads as an .html file instead.
  function briefHTML() {
    var nowIdx = affectedIndex(notWatch, true);
    var watchIdx = affectedIndex(isWatch, true);
    var picked = ORGS.filter(function (o) { return o.selected; }).length;
    var evs = state.events.slice().sort(function (a, b) { return rankScore(b) - rankScore(a); });
    var gen = new Date();

    function groupTables(entries, emptyText) {
      var groups = {};
      entries.forEach(function (x) {
        var k = (COUNTRY_LABEL[x.org.country] || x.org.country) + " · " + x.org.region;
        (groups[k] = groups[k] || []).push(x);
      });
      var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length || a.localeCompare(b); });
      if (!keys.length) return '<p class="none">' + emptyText + "</p>";
      return keys.map(function (k) {
        var rows = groups[k].slice().sort(function (a, b) { return a.org.name.localeCompare(b.org.name); }).map(function (x) {
          var haz = x.events.slice().sort(function (a, b) { return b.severity - a.severity; })
            .map(function (e) { return e.title; }).join("; ");
          return "<tr><td>" + esc(x.org.name) + (x.org.selected ? ' <span class="mem">on list</span>' : "") + "</td><td>" +
            esc(orgTypeLabel(x.org)) + "</td><td>" + esc(x.org.city) + "</td><td>" + esc(haz) + "</td></tr>";
        }).join("");
        return "<h3>" + esc(k) + ' <span class="rc">(' + groups[k].length + ")</span></h3>" +
          "<table><thead><tr><th>Organization</th><th>Type</th><th>City</th><th>Hazards</th></tr></thead><tbody>" + rows + "</tbody></table>";
      }).join("");
    }

    var evRows = evs.slice(0, 25).map(function (e) {
      return '<tr><td>' + esc(e.title) + '</td><td class="sev s' + e.severity + '">' + esc(e.sevLabel) + "</td><td>" +
        esc(String(e.area || "").slice(0, 70)) + '</td><td class="num">' + e.affected.length + "</td><td>" +
        (e.expires ? esc(fmtTime(e.expires)) : "Not listed") + "</td></tr>";
    }).join("");

    var html = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Cultural Heritage Resilience: Situation Brief</title><style>" +
      "body{font:13px/1.5 'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;color:#201d18;background:#fff;max-width:800px;margin:32px auto;padding:0 24px}" +
      "h1{font-size:24px;margin:0 0 2px}h2{font-size:15px;margin:26px 0 8px;border-bottom:2px solid #201d18;padding-bottom:4px;text-transform:uppercase;letter-spacing:0.6px;font-family:-apple-system,'Segoe UI',sans-serif}" +
      "h3{font-size:13.5px;margin:16px 0 4px}.rc{font-weight:400;color:#6e6759}" +
      ".masthead{display:flex;align-items:center;gap:10px}.mark{width:13px;height:13px;background:#8c2f24;transform:rotate(45deg)}" +
      ".sub{color:#5f584b;font-size:12px;margin:2px 0 0}" +
      ".keyrow{display:flex;gap:26px;margin:18px 0 4px;flex-wrap:wrap}.key b{display:block;font-size:23px;font-family:-apple-system,'Segoe UI',sans-serif}.key span{font-size:11px;color:#5f584b;text-transform:uppercase;letter-spacing:0.5px}" +
      "table{width:100%;border-collapse:collapse;font-size:12px;font-family:-apple-system,'Segoe UI',sans-serif}" +
      "th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:0.4px;color:#5f584b;border-bottom:1px solid #cdc7b7;padding:4px 8px 4px 0}" +
      "td{border-bottom:1px solid #e5e1d8;padding:5px 8px 5px 0;vertical-align:top}" +
      ".sev{white-space:nowrap;font-weight:600}.s4{color:#a32c25}.s3{color:#c05427}.s2{color:#a87b1f}.s1{color:#8a8374}.num{text-align:left;font-variant-numeric:tabular-nums}" +
      ".mem{font-size:10px;color:#8c2f24;border:1px solid #8c2f24;border-radius:3px;padding:0 4px;font-family:-apple-system,'Segoe UI',sans-serif}" +
      ".none{color:#5f584b;font-style:italic}" +
      ".foot{margin-top:30px;padding-top:10px;border-top:1px solid #cdc7b7;font-size:11px;color:#5f584b}" +
      ".noprint{margin:18px 0;font:13px -apple-system,'Segoe UI',sans-serif;color:#5f584b}" +
      "@media print{.noprint{display:none}body{margin:0}}" +
      "</style></head><body>" +
      '<div class="masthead"><span class="mark"></span><div><h1>Cultural Heritage Resilience: Situation Brief</h1>' +
      '<p class="sub">Generated ' + esc(gen.toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })) +
      (state.updatedAt ? " · live data updated " + esc(timeAgo(state.updatedAt)) : "") + "</p></div></div>" +
      '<div class="noprint">Use your browser’s Print command to print or save this brief as a PDF.</div>' +
      '<div class="keyrow">' +
      '<div class="key"><b>' + ORGS.length + "</b><span>organizations monitored" + (picked ? " (" + picked + " on your list)" : "") + "</span></div>" +
      '<div class="key"><b>' + state.events.length + "</b><span>active events</span></div>" +
      '<div class="key"><b>' + nowIdx.length + "</b><span>needing attention now</span></div>" +
      '<div class="key"><b>' + watchIdx.length + "</b><span>on the watchlist</span></div>" +
      "</div>" +
      "<h2>Needing attention now</h2>" + groupTables(nowIdx, "No mapped organizations are inside an active hazard footprint.") +
      "<h2>Watchlist: potential impacts</h2>" + groupTables(watchIdx, "No mapped organizations are inside a watch area.") +
      "<h2>Most significant active events</h2>" +
      (evRows ? "<table><thead><tr><th>Event</th><th>Severity</th><th>Area</th><th>Orgs</th><th>Until</th></tr></thead><tbody>" + evRows + "</tbody></table>" : '<p class="none">No active events.</p>') +
      '<div class="foot">Sources: National Weather Service, Environment and Climate Change Canada, USGS, NIFC/WFIGS, Natural Resources Canada (CWFIS), NASA EONET. ' +
      "For situational awareness only; this is not an emergency alerting system. Always follow official guidance from local authorities.</div>" +
      "</body></html>";
    return html.replace(/\s*—\s*/g, ": ");
  }

  function openBrief() {
    var html = briefHTML();
    var w = null;
    try { w = window.open("", "_blank"); } catch (e) {}
    if (w && w.document) {
      w.document.open(); w.document.write(html); w.document.close();
    } else {
      // Popup blocked (or assistant-triggered outside a user gesture) — download instead.
      var blob = new Blob([html], { type: "text/html;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = "heritage-resilience-brief-" + new Date().toISOString().slice(0, 10) + ".html";
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
    }
  }

  /* ---------------- selected-organization overlay: spreadsheet import ---------------- */

  // Handles comma- and tab-separated exports (Excel, Numbers, Google Sheets all produce
  // one or the other), including quoted fields containing the delimiter.
  function parseDelimited(text, delim) {
    var rows = [], row = [], cur = "", inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (cur !== "" || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; }
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else cur += ch;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  function importSelected(text) {
    text = String(text || "").replace(/^﻿/, ""); // Excel writes a BOM
    if (text.length > MAX_SELECTED_FILE_BYTES) {
      return { ok: false, msg: "That file is too large. Use a CSV smaller than 5 MB and no more than 10,000 rows." };
    }
    // A real .xlsx is a zip archive; its first bytes are "PK". Reading it as text yields
    // binary noise, so say something useful instead of "no usable rows".
    if (/^PK\x03\x04/.test(text)) {
      return { ok: false, msg: "That looks like an Excel workbook (.xlsx). In Excel or Google Sheets choose File → Save As / Download → CSV, then upload that file." };
    }
    // Pick the delimiter from whichever appears more often in the header line.
    var firstLine = text.split(/\r?\n/)[0] || "";
    var delim = (firstLine.split("\t").length > firstLine.split(",").length) ? "\t" : ",";
    var rows = parseDelimited(text, delim);
    if (rows.length < 2) return { ok: false, msg: "The file needs a header row plus at least one data row." };
    if (rows.length - 1 > MAX_SELECTED_RECORDS) return { ok: false, msg: "That file has more than 10,000 data rows. Split it into a smaller watchlist." };
    var head = rows[0].map(function (h) { return String(h).trim().toLowerCase(); });
    function col() { for (var i = 0; i < arguments.length; i++) { var ix = head.indexOf(arguments[i]); if (ix !== -1) return ix; } return -1; }
    var ci = {
      name: col("name", "organization", "institution"),
      type: col("type"),
      city: col("city", "town"),
      region: col("state", "region", "province", "state/region"),
      country: col("country"),
      lat: col("lat", "latitude"),
      lon: col("lon", "lng", "long", "longitude"),
      url: col("website", "url"),
      fips: col("fips", "county fips", "countyfips"),
    };
    if (ci.name === -1 || ci.lat === -1 || ci.lon === -1) {
      var missing = [];
      if (ci.name === -1) missing.push("name");
      if (ci.lat === -1) missing.push("lat");
      if (ci.lon === -1) missing.push("lon");
      return {
        ok: false,
        msg: "Missing required column" + (missing.length === 1 ? "" : "s") + ": " + missing.join(", ") +
          ". Found: " + head.filter(Boolean).join(", ") + ".",
      };
    }
    var list = [], skipped = 0;
    rows.slice(1).forEach(function (r) {
      var name = String(r[ci.name] || "").trim();
      var lat = parseFloat(r[ci.lat]), lon = parseFloat(r[ci.lon]);
      // North-America sanity bounds, using the same envelope as the feeds.
      if (!name || !isFinite(lat) || !isFinite(lon) || lat < 5 || lat > 84 || lon < -172 || lon > -50) {
        if (r.join("").trim()) skipped++;
        return;
      }
      var normalized = Security.privateOrganizationRecord({
        name: name,
        type: ci.type !== -1 ? r[ci.type] : "library",
        city: ci.city !== -1 ? String(r[ci.city] || "").trim() : "",
        region: ci.region !== -1 ? String(r[ci.region] || "").trim() : "",
        country: ci.country !== -1 ? String(r[ci.country] || "US").trim() : "US",
        lat: lat, lon: lon,
        url: ci.url !== -1 ? r[ci.url] : "",
        fips: ci.fips !== -1 ? r[ci.fips] : "",
      });
      if (normalized) list.push(normalized); else skipped++;
    });
    if (!list.length) {
      return { ok: false, msg: "No usable rows: check that lat/lon are decimal degrees (e.g. 39.8017, -89.6437)." };
    }
    try { localStorage.setItem(SELECTED_LS, JSON.stringify(list)); }
    catch (e) { return { ok: false, msg: "Could not save; the list may be too large for browser storage." }; }
    selectionChanged();
    return {
      ok: true,
      msg: "Loaded " + list.length + " organization" + (list.length === 1 ? "" : "s") +
        (skipped ? " (" + skipped + " row" + (skipped === 1 ? "" : "s") + " skipped)." : "."),
    };
  }

  function selectionChanged() {
    rebuildOrgs();
    renderStats();
    computeImpact();
    renderLegend();
    refreshMapData();
    if (state.panelMode === "affected") showAffected(state.affectedMode);
    else if (state.panelMode === "list") renderList();
    refreshSelectButton();
    try { window.dispatchEvent(new CustomEvent("hw:selected-list-changed", { detail: { count: selectedCount() } })); } catch (e) {}
  }

  function selectedCount() {
    return ORGS.filter(function (o) { return o.selected; }).length;
  }

  function compactCount(n) {
    if (n >= 10000) return "10k";
    if (n >= 1000) return (Math.round(n / 100) / 10) + "k";
    return String(n);
  }

  function refreshSelectButton() {
    var btn = el("select-btn");
    var badge = el("select-active-count");
    if (!btn || !badge) return;
    var n = selectedCount();
    btn.classList.toggle("has-list", !!n);
    badge.hidden = !n;
    badge.textContent = n ? compactCount(n) : "";
    btn.title = n
      ? "Your list is active: " + n + " organization" + (n === 1 ? "" : "s") + ". Open to replace or remove it."
      : "Select overlay: track your own list of organizations";
    btn.setAttribute("aria-label", n
      ? "Your uploaded list is active with " + n + " organization" + (n === 1 ? "" : "s") + ". Open list controls."
      : "Select overlay");
  }

  function setSelectStatus(message, tone) {
    var status = el("select-status");
    status.className = "about-note select-status status-" + (tone || "empty");
    status.textContent = message;
  }

  function refreshSelectDialog() {
    var n = selectedCount();
    el("select-clear").hidden = !n;
    el("select-file-label").textContent = n ? "Replace spreadsheet…" : "Choose spreadsheet…";
    refreshSelectButton();
    setSelectStatus(n
      ? "✓ Your list is active: " + n + " organization" + (n === 1 ? "" : "s") +
        (n === 1 ? " is" : " are") + " on the map. It stays active in this browser until you choose Remove my list."
      : "No list is active. Choose a spreadsheet to add your organizations to the map.", n ? "active" : "empty");
  }

  /* ---------------- public facade for the assistant panel ----------------
     A deliberately narrow API over already-loaded map data and visible UI actions.
     Private uploaded organizations are excluded unless the user grants session consent
     in chat.js. Event text is untrusted data and never controls which methods exist. */

  function assistantOrganizations(includeSelected) {
    return Security.filterAssistantOrganizations(ORGS, includeSelected);
  }
  function assistantEntries(includeSelected, filterFn) {
    return affectedIndex(filterFn).filter(function (entry) { return includeSelected || !entry.org.selected; });
  }
  function assistantAffectedCount(e, includeSelected) {
    return e.affected.reduce(function (count, id) {
      var org = orgById[id];
      return count + (org && (includeSelected || !org.selected) ? 1 : 0);
    }, 0);
  }
  function assistantRankScore(e, includeSelected) {
    var count = assistantAffectedCount(e, includeSelected);
    return (count ? 1e7 : 0) + e.severity * 1000 + Math.min(count, 999);
  }
  function eventSummary(e, includeSelected) {
    return {
      id: e.id, title: e.title, category: e.category, hazard: catMeta(e.category).label,
      severity: e.severity, severityLabel: e.sevLabel, area: e.area || "",
      affectedCount: assistantAffectedCount(e, includeSelected), source: e.source,
      startsAt: e.time || null, endsAt: e.expires || null,
    };
  }
  function orgSummary(o) {
    return { id: o.id, name: o.name, type: o.type, libraryType: o.libraryType || null, city: o.city, region: o.region, country: COUNTRY_LABEL[o.country] || o.country, website: Security.safeHttpUrl(o.url, { allowHttp: true }) };
  }

  window.HW = {
    // --- read-only ---
    getContext: function (opts) {
      opts = opts || {};
      var includeSelected = !!opts.includeSelected;
      var orgs = assistantOrganizations(includeSelected);
      var vis = visibleEvents().slice().sort(function (a, b) { return assistantRankScore(b, includeSelected) - assistantRankScore(a, includeSelected); });
      var affected = assistantEntries(includeSelected);
      var byRegion = {};
      affected.forEach(function (x) {
        var k = (COUNTRY_LABEL[x.org.country] || x.org.country) + " / " + x.org.region;
        byRegion[k] = (byRegion[k] || 0) + 1;
      });
      var counts = { library: 0, museum: 0, archive: 0 };
      orgs.forEach(function (o) { counts[o.type]++; });
      return {
        updatedAt: state.updatedAt,
        totalOrganizations: orgs.length,
        selectedOrganizations: includeSelected ? orgs.filter(function (o) { return o.selected; }).length : 0,
        privateDataIncluded: includeSelected,
        organizationsByType: counts,
        countriesCovered: ["United States", "Canada", "Mexico"],
        activeEventCount: vis.length,
        organizationsInHazardArea: affected.length,
        needingAttentionNow: assistantEntries(includeSelected, notWatch).length,
        onWatchlist: assistantEntries(includeSelected, isWatch).length,
        affectedByRegion: byRegion,
        topEvents: vis.slice(0, 25).map(function (e) { return eventSummary(e, includeSelected); }),
      };
    },
    searchOrganizations: function (query, limit, opts) {
      opts = opts || {};
      var q = String(query || "").toLowerCase().trim();
      if (!q) return [];
      return assistantOrganizations(!!opts.includeSelected).filter(function (o) {
        return o.name.toLowerCase().indexOf(q) !== -1 || o.city.toLowerCase().indexOf(q) !== -1 || o.region.toLowerCase().indexOf(q) !== -1;
      }).slice(0, limit || 15).map(function (o) {
        var r = orgSummary(o); r.activeHazards = eventsForOrg(o).map(function (e) { return e.title; }); return r;
      });
    },
    getEvents: function (opts) {
      opts = opts || {};
      var includeSelected = !!opts.includeSelected;
      var out = visibleEvents().slice();
      if (opts.category) out = out.filter(function (e) { return e.category === opts.category; });
      if (opts.minSeverity) out = out.filter(function (e) { return e.severity >= opts.minSeverity; });
      if (opts.affectedOnly) out = out.filter(function (e) { return assistantAffectedCount(e, includeSelected); });
      out.sort(function (a, b) { return assistantRankScore(b, includeSelected) - assistantRankScore(a, includeSelected); });
      return out.slice(0, opts.limit || 40).map(function (e) { return eventSummary(e, includeSelected); });
    },
    getAffectedOrganizations: function (opts) {
      opts = opts || {};
      var entries = assistantEntries(!!opts.includeSelected);
      if (opts.region) {
        var rq = String(opts.region).toLowerCase();
        entries = entries.filter(function (x) {
          return x.org.region.toLowerCase() === rq || (COUNTRY_LABEL[x.org.country] || "").toLowerCase().indexOf(rq) !== -1 || x.org.city.toLowerCase().indexOf(rq) !== -1;
        });
      }
      return entries.slice(0, opts.limit || 200).map(function (x) {
        var r = orgSummary(x.org); r.hazards = x.events.map(function (e) { return e.title; }); return r;
      });
    },
    // --- reversible UI actions ---
    setHazardLayers: function (groups) {
      // groups: array of layer group ids to turn ON; the rest turn OFF.
      Object.keys(LAYER_GROUPS).forEach(function (g) { setLayerFilter(g, groups.indexOf(g) !== -1); });
      return { activeLayers: Object.keys(state.layerOn).filter(function (g) { return state.layerOn[g]; }) };
    },
    setOrganizationTypes: function (types) {
      ["library", "museum", "archive"].forEach(function (t) { setTypeFilter(t, types.indexOf(t) !== -1); });
      return { activeTypes: Object.keys(state.typeOn).filter(function (t) { return state.typeOn[t]; }) };
    },
    focusEvent: function (id, opts) {
      opts = opts || {};
      var e = state.events.find(function (x) { return x.id === id; });
      if (!e) return { ok: false, error: "No event with that id" };
      selectEvent(id);
      return { ok: true, focused: eventSummary(e, !!opts.includeSelected) };
    },
    focusOrganization: function (id, opts) {
      opts = opts || {};
      var o = orgById[id];
      if (!o) return { ok: false, error: "No organization with that id" };
      if (o.selected && !opts.includeSelected) return { ok: false, error: "Private uploaded organizations are not available to the assistant without user permission" };
      map.easeTo({ center: [o.lon, o.lat], zoom: Math.max(map.getZoom(), 9) });
      showOrgPopup(o.id);
      return { ok: true, focused: orgSummary(o) };
    },
    showAffectedView: function (mode) { showAffected(mode === "watch" ? "watch" : "now"); return { ok: true, mode: state.affectedMode }; },
    openSituationBrief: function (opts) {
      opts = opts || {};
      if (opts.requireConfirmation && !window.confirm("The assistant wants to create a situation brief. Continue? The brief may include organizations from your private list, but it stays on this device.")) {
        return { ok: false, cancelled: true, note: "The user declined to create the brief." };
      }
      openBrief();
      return { ok: true, note: "Brief opened in a new tab (or downloaded if the popup was blocked)." };
    },
    resetView: function () { resetView(); showList(); return { ok: true }; },
    layerGroups: function () {
      return Object.keys(LAYER_GROUPS).map(function (g) { return { id: g, label: LAYER_GROUPS[g].label }; });
    },
  };

  function init() {
    initTheme();
    renderStats();
    renderLegend();
    buildFilters();
    renderAboutHazardIcons();
    setupSearch();

    map = new maplibregl.Map({
      container: "map",
      style: basemapStyle(currentTheme()),
      center: DEFAULT_VIEW.center,
      zoom: DEFAULT_VIEW.zoom,
      minZoom: 2,
      maxZoom: 15,
      attributionControl: { compact: true },
    });
    window.__hwMap = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
    map.addControl(new ResetViewControl(), "top-left");
    // focusAfterOpen:false is important — otherwise opening a popup from the search box moves
    // focus onto the popup's "Visit website" link, and the Enter keystroke that selected the
    // result then activates it, opening the site in a new tab. We never want that automatic.
    popup = new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "300px", offset: 12, focusAfterOpen: false });

    // Rasterize the hazard icons in parallel with map startup; whichever finishes last
    // attaches the symbol layer.
    buildIconImages().then(addHazardIcons);
    SELECTED_STAR_IMAGE = buildSelectedStarImage();
    addSelectedStarLayer();

    map.on("load", function () {
      addDataLayers();
      refreshMapData();
      refreshRadar();
    });
    // Coordinate spreading is recalculated at the new scale so coincident markers keep
    // a stable screen-pixel gap instead of drifting together or far apart while zooming.
    map.on("zoomend", function () {
      if (map.getSource("hazard-points")) {
        map.getSource("hazard-points").setData(hazardPointGeoJSON());
      }
    });
    // The basemap is a CDN dependency; the event panel must not depend on it.
    // Swallow style/tile errors so a basemap outage degrades to a blank map, not a blank app.
    map.on("error", function (e) {
      if (!window._hwMapWarned) { window._hwMapWarned = true; console.warn("Map resource error:", e && e.error && e.error.message); }
    });

    // Load feeds immediately, independent of basemap readiness.
    loadFeeds();

    el("refresh-btn").addEventListener("click", loadFeeds);
    el("impact-bar").addEventListener("click", function () { showAffected("now"); });
    el("watch-bar").addEventListener("click", function () { showAffected("watch"); });
    el("brief-btn").addEventListener("click", openBrief);
    el("radar-btn").addEventListener("click", function () { setRadar(!state.radarOn); });
    setRadar(state.radarOn);
    el("theme-btn").addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
    var about = el("about");
    el("about-btn").addEventListener("click", function () { about.showModal(); });
    el("about-close").addEventListener("click", function () { about.close(); });
    about.addEventListener("click", function (e) { if (e.target === about) about.close(); });

    // Selected-organization overlay dialog.
    var selectDlg = el("select-overlay");
    el("select-btn").addEventListener("click", function () { refreshSelectDialog(); selectDlg.showModal(); });
    refreshSelectDialog();
    el("select-close").addEventListener("click", function () { selectDlg.close(); });
    selectDlg.addEventListener("click", function (e) { if (e.target === selectDlg) selectDlg.close(); });
    el("select-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (!f) return;
      if (f.size > MAX_SELECTED_FILE_BYTES) {
        setSelectStatus("That file is too large. Use a CSV smaller than 5 MB and no more than 10,000 rows.", "error");
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var res = importSelected(String(reader.result || ""));
        var n = selectedCount();
        el("select-clear").hidden = !n;
        el("select-file-label").textContent = n ? "Replace spreadsheet…" : "Choose spreadsheet…";
        refreshSelectButton();
        setSelectStatus(res.ok
          ? "✓ Upload complete: " + res.msg + " Your list is active on the map and stays active until you choose Remove my list."
          : res.msg + (n ? " Your existing list is still active." : ""), res.ok ? "success" : "error");
      };
      reader.onerror = function () {
        setSelectStatus("The spreadsheet could not be read. Choose the file again or save a fresh CSV copy.", "error");
      };
      reader.readAsText(f);
    });
    el("select-clear").addEventListener("click", function () {
      try { localStorage.removeItem(SELECTED_LS); } catch (e) {}
      try { localStorage.removeItem(LEGACY_SELECTED_LS); } catch (e) {}
      selectionChanged();
      refreshSelectDialog();
      setSelectStatus("Your list has been removed from this browser. No uploaded organizations remain active on the map.", "empty");
    });

    // Outreach draft dialog.
    var outDlg = el("outreach");
    el("outreach-close").addEventListener("click", function () { outDlg.close(); });
    outDlg.addEventListener("click", function (e) { if (e.target === outDlg) outDlg.close(); });
    el("outreach-copy").addEventListener("click", function () {
      var ta = el("outreach-text"), btn = el("outreach-copy");
      function done() { btn.textContent = "Copied ✓"; setTimeout(function () { btn.textContent = "Copy to clipboard"; }, 1600); }
      function legacy() { ta.select(); try { document.execCommand("copy"); } catch (e) {} done(); }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, legacy);
      else legacy();
    });

    // Restore the impact-trend sparkline from any history recorded in earlier sessions.
    try { renderTrend(JSON.parse(localStorage.getItem(HIST_LS) || "[]")); } catch (e) {}

    // Auto-refresh feeds every 5 minutes.
    setInterval(loadFeeds, 5 * 60 * 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
