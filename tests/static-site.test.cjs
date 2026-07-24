const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const chat = fs.readFileSync(path.join(root, "js", "chat.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const privacy = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
const version = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));

test("README shows the repository-owned application screenshot before What it does", () => {
  const imageRef = "docs/images/cultural-heritage-resilience-map.png";
  const imagePosition = readme.indexOf(`](${imageRef})`);
  assert.ok(imagePosition >= 0, "README screenshot reference is missing");
  assert.ok(imagePosition < readme.indexOf("## What it does"), "README screenshot is not near the top");
  const image = fs.readFileSync(path.join(root, imageRef));
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "screenshot is not a PNG");
});

test("README identifies the Windows launcher as an alternative to the manual server steps", () => {
  assert.match(readme, /\*\*Windows alternative:\*\* Instead of following steps 3–5 above/);
});

test("runtime scripts and styles are local and consistently cache-versioned", () => {
  const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)\?v=(\d+))"/g)];
  assert.ok(refs.length >= 8, "expected all runtime assets to be versioned");
  assert.equal(new Set(refs.map((m) => m[2])).size, 1, "mixed cache versions");
  for (const [, ref] of refs) {
    assert.ok(!/^https?:/i.test(ref), ref);
    assert.ok(fs.existsSync(path.join(root, ref.split("?")[0])), ref);
  }
});

test("release metadata, update discovery, and cache-busting reload stay synchronized", () => {
  const assetVersions = [...html.matchAll(/(?:src|href)="[^"]+\.(?:js|css)\?v=(\d+)"/g)].map((m) => Number(m[1]));
  const appBuild = app.match(/var APP_BUILD = "([^"]+)"/)?.[1];
  const metaBuild = html.match(/<meta name="application-version" content="([^"]+)">/)?.[1];
  assert.equal(appBuild, version.build);
  assert.equal(metaBuild, version.build);
  assert.ok(assetVersions.length >= 8);
  assert.ok(assetVersions.every((value) => value === version.assetVersion));
  assert.match(html, /id="update-notice"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden/);
  assert.match(html, /Build 2026\.07\.24\.1 · Released July 24, 2026/);
  assert.match(app, /new URL\("\/version\.json", window\.location\.origin\)/);
  assert.match(app, /cache: "no-store"/);
  assert.match(app, /credentials: "same-origin"/);
  assert.match(app, /redirect: "error"/);
  assert.match(app, /text\.length > 1024/);
  assert.match(app, /url\.searchParams\.set\("build", latestAvailableBuild \|\| APP_BUILD\)/);
  assert.match(app, /window\.location\.replace\(url\.href\)/);
  assert.match(app, /window\.addEventListener\("pageshow", checkForAppUpdate\)/);
  assert.match(app, /document\.visibilityState === "visible"/);
});

test("build comparison only accepts and orders the fixed numeric release format", () => {
  const validSource = app.match(/function validBuild\(value\) \{[\s\S]*?\n  \}/)?.[0];
  const compareSource = app.match(/function compareBuilds\(a, b\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(validSource && compareSource, "build validation helpers are missing");
  const context = { result: null };
  vm.runInNewContext(
    `${validSource}; ${compareSource}; result = [` +
      `compareBuilds("2026.07.24.2", "2026.07.24.1"),` +
      `compareBuilds("2026.07.24.1", "2026.07.24.1"),` +
      `compareBuilds("2026.07.23.9", "2026.07.24.1"),` +
      `compareBuilds("not-a-build", "2026.07.24.1")];`,
    context
  );
  assert.deepEqual(Array.from(context.result), [1, 0, -1, 0]);
});

test("the page declares the core content-security restrictions", () => {
  assert.match(html, /Content-Security-Policy/i);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'self'/);
  assert.match(html, /form-action 'self'/);
  assert.match(html, /https:\/\/tiles\.openfreemap\.org/);
  assert.doesNotMatch(html, /cartocdn|fonts\.openmaptiles\.org/i);
});

test("the public privacy page is linked from the information panel", () => {
  assert.match(html, /href="privacy\.html"[^>]*>Privacy information<\/a>/);
  assert.match(privacy, /<h1>Privacy<\/h1>/);
  assert.match(privacy, /does not upload the\s+file to its host/i);
});

test("the basemap uses OpenFreeMap without CARTO or API credentials", () => {
  assert.match(app, /https:\/\/tiles\.openfreemap\.org\/styles\//);
  assert.match(app, /theme === "dark" \? "dark" : "positron"/);
  assert.doesNotMatch(app, /cartocdn|CARTO/);
  assert.match(readme, /OpenFreeMap provides the OpenStreetMap-derived basemap/);
});

test("the default Groq model is current and supports tool use", () => {
  assert.match(chat, /defaultModel: "openai\/gpt-oss-120b"/);
  assert.doesNotMatch(chat, /llama-3\.3-70b-versatile/);
});

test("collapsed mobile assistant and narrow header remain usable", () => {
  assert.match(css, /#assistant\.collapsed \{ display: none; width: 0; \}/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*#feed-status \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.brand-text \{ display: none; \}/);
});

test("the private overlay stays visibly active until the user removes it", () => {
  assert.doesNotMatch(html, /id="select-export"/);
  assert.match(html, /id="select-active-count"/);
  assert.match(html, /id="select-clear"/);
  assert.match(app, /stays active until you choose Remove my list/);
  assert.match(app, /classList\.toggle\("has-list", !!n\)/);
  assert.match(app, /localStorage\.removeItem\(LEGACY_SELECTED_LS\)/);
});

test("map hazard markers and legend use the right-panel hazard groups", () => {
  assert.match(app, /markerCat: LAYER_GROUPS\[group\]\.key/);
  assert.match(app, /legendHazardGroups\(\)\.map/);
  assert.match(app, /svg\(meta\.icon\).*esc\(meta\.label\)/s);
  assert.doesNotMatch(app, /label: "Tropical"/);
});

test("every hazard group is enabled in the default map state", () => {
  const groupsBlock = app.match(/var LAYER_GROUPS = \{([\s\S]*?)\n  \};/)?.[1] || "";
  const defaultsBlock = app.match(/layerOn: \{([^}]+)\}/)?.[1] || "";
  const groups = [...groupsBlock.matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]).sort();
  const defaults = [...defaultsBlock.matchAll(/(\w+):\s*true/g)].map((match) => match[1]).sort();
  assert.deepEqual(defaults, groups);
});

test("CWFIS wildfire perimeters and markers stay visible independently of the quiet-area switch", () => {
  const cwfisSource = app.match(/function isCwfisWildfire\(e\) \{[\s\S]*?\n  \}/)?.[0];
  const areaSource = app.match(/function shouldRenderHazardArea\(e, hasOrgs\) \{[\s\S]*?\n  \}/)?.[0];
  const markerSource = app.match(/function shouldRenderHazardMarker\(e, hasOrgs\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(cwfisSource && areaSource && markerSource, "CWFIS visibility helpers are missing");

  function visibility(showQuiet, event, hasOrgs) {
    const context = { state: { showQuiet }, event, hasOrgs, area: null, marker: null };
    vm.runInNewContext(
      `${cwfisSource}; ${areaSource}; ${markerSource};` +
      "area = shouldRenderHazardArea(event, hasOrgs);" +
      "marker = shouldRenderHazardMarker(event, hasOrgs);",
      context
    );
    return { area: context.area, marker: context.marker };
  }

  const cwfisPerimeter = { feed: "cwfis", category: "fire", geometry: { type: "Polygon" } };
  const weatherPolygon = { feed: "eccc", category: "storm", geometry: { type: "Polygon" } };
  assert.deepEqual(visibility(false, cwfisPerimeter, 0), { area: true, marker: true });
  assert.deepEqual(visibility(true, cwfisPerimeter, 0), { area: true, marker: true });
  assert.deepEqual(visibility(false, weatherPolygon, 0), { area: false, marker: false });
  assert.deepEqual(visibility(true, weatherPolygon, 0), { area: true, marker: false });
  assert.deepEqual(visibility(false, weatherPolygon, 1), { area: true, marker: true });
  assert.deepEqual(
    visibility(false, { feed: "fires", category: "fire", geometry: null }, 0),
    { area: false, marker: true }
  );
  assert.match(app, /e\.affected\.length \|\| isCwfisWildfire\(e\)/);
  assert.match(app, /\["get", "cwfis"\][^\n]*0\.13/);
  assert.match(app, /\["get", "cwfis"\][^\n]*0\.65/);
});

test("nearby hazards receive separate fixed-pixel coordinates", () => {
  const offsetsSource = app.match(/var HAZARD_MARKER_OFFSETS = \[[\s\S]*?\n  \];/)?.[0];
  const radiusSource = app.match(/var HAZARD_MARKER_GROUP_RADIUS = \d+;/)?.[0];
  const projectSource = app.match(/function hazardMarkerWorldPixel\(coordinates, zoom\) \{[\s\S]*?\n  \}/)?.[0];
  const unprojectSource = app.match(/function hazardMarkerCoordinatesFromPixel\(point, zoom\) \{[\s\S]*?\n  \}/)?.[0];
  const spreadSource = app.match(/function spreadNearbyHazardMarkers\(features, zoom\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(offsetsSource && radiusSource && projectSource && unprojectSource && spreadSource, "nearby-marker spreading logic is missing");

  const zoom = 6;
  const anchor = [-119.49, 49.88];
  const setupContext = {};
  vm.runInNewContext(`${projectSource}; ${unprojectSource};`, setupContext);
  const anchorPixel = setupContext.hazardMarkerWorldPixel(anchor, zoom);
  const nearbyAnchor = setupContext.hazardMarkerCoordinatesFromPixel(
    [anchorPixel[0] + 10, anchorPixel[1] + 6],
    zoom
  );
  const features = [
    { properties: { id: "heat" }, geometry: { coordinates: anchor } },
    { properties: { id: "air" }, geometry: { coordinates: nearbyAnchor } },
    { properties: { id: "fire" }, geometry: { coordinates: [-120.2, 50.1] } },
  ];
  const context = { features: structuredClone(features), result: null };
  vm.runInNewContext(
    `${offsetsSource}; ${radiusSource}; ${projectSource}; ${unprojectSource}; ${spreadSource};` +
      `result = spreadNearbyHazardMarkers(features, ${zoom});`,
    context
  );
  assert.deepEqual(
    context.result.map((feature) => feature.properties.offsetSlot),
    [1, 2, 0]
  );
  const heatPixel = context.hazardMarkerWorldPixel(context.result[0].geometry.coordinates, zoom);
  const airPixel = context.hazardMarkerWorldPixel(context.result[1].geometry.coordinates, zoom);
  assert.ok(Math.hypot(heatPixel[0] - airPixel[0], heatPixel[1] - airPixel[1]) >= 32);
  assert.match(app, /map\.on\("zoomend"[\s\S]*?hazardPointGeoJSON\(\)/);
});

test("private-list assistant sharing is hidden without a list and clearly states its live status", () => {
  assert.match(html, /id="asst-private-option" hidden/);
  assert.doesNotMatch(chat, /No private organization list is currently loaded/);
  assert.match(chat, /Off\. The assistant cannot see or use your uploaded list\./);
  assert.match(chat, /On for this tab\./);
  assert.match(chat, /hw:selected-list-changed/);
});

test("assistant discloses missing information and provider output cutoffs", () => {
  assert.match(chat, /If essential information needed for the answer is unavailable/);
  assert.match(chat, /stop_reason === "max_tokens"/);
  assert.match(chat, /finish_reason === "length"/);
  assert.match(chat, /This answer was cut off by the response limit/);
  assert.match(chat, /var MAX_OUTPUT_TOKENS = 1024/);
  assert.doesNotMatch(chat, /temperature\s*:/);
});

test("map legend arrows point down when open and up when closed", () => {
  assert.match(css, /\.legend-collapse svg[^}]*transform: rotate\(180deg\)/s);
  assert.match(css, /#legend\.collapsed \.legend-collapse svg \{ transform: rotate\(0deg\); \}/);
});

test("uploaded organizations use a red star on the map and in the legend", () => {
  assert.match(app, /id: "org-selected-star"/);
  assert.match(app, /filter: \["==", \["get", "selected"\], 1\]/);
  assert.match(app, /fillStyle = "#c7352b"/);
  assert.match(app, /map\.on\("click", "org-selected-star"/);
  assert.match(app, /On your uploaded list/);
  assert.match(css, /\.swatch\.selected[^}]*clip-path: polygon/s);
});

test("the information button is larger than the other header icons", () => {
  assert.match(css, /#about-btn svg \{ width: 19px; height: 19px; \}/);
});

test("the information panel uses concise copy and a visual map-reading guide", () => {
  const downloadNote = "This project may be downloaded from";
  assert.ok(html.indexOf(downloadNote) > html.indexOf("<h2>Cultural Heritage Resilience</h2>"));
  assert.ok(html.indexOf(downloadNote) < html.indexOf('class="about-prototype"'));
  assert.match(html, /This project may be downloaded from <a href="https:\/\/github\.com\/FreshPremise\/Cultural-Heritage-Resilience-Crisis-Map"[^>]*>GitHub<\/a>\./);
  assert.match(html, /Prototype:<\/b> This map shows a non-exhaustive sample of cultural heritage organizations across North America/);
  assert.match(html, /class="about-prototype"/);
  assert.match(html, /This is an interactive live crisis map for North American cultural heritage organizations/);
  assert.match(html, /class="about-map-guide"/);
  assert.match(html, /id="about-hazard-icons"/);
  assert.match(html, /Red stars\.<\/b> These are organizations from your uploaded spreadsheet/);
  assert.match(html, /IMLS Public Libraries Survey \(PLS\), FY2023/);
  assert.match(html, /NCES Integrated Postsecondary Education Data System \(IPEDS\), FY2023 Academic Libraries and Directory Information/);
  assert.match(html, /href="data\/organizations\.js"[^>]*>Curated North American demonstration set<\/a>/);
  assert.match(html, /href="data\/official-library-websites\.json"[^>]*>Project-maintained official library and government website review<\/a>/);
  assert.match(html, /Created and maintained by <a[^>]+>FreshPremise<\/a>\./);
  assert.match(html, /OpenAI Codex and Anthropic Claude Code were used for assistance/);
  assert.match(app, /function renderAboutHazardIcons\(\)/);
  assert.match(app, /\["storms", "flood", "fire", "quake", "winter", "air"\]/);
});

test("the Select overlay dialog uses the approved wording without em dashes", () => {
  const dialog = html.match(/<dialog id="select-overlay">[\s\S]*?<\/dialog>/)?.[0] || "";
  assert.match(dialog, /Upload a spreadsheet with organizations that you wish to see on the map\./);
  assert.doesNotMatch(dialog, /—/);
  assert.match(app, /Your list is active: /);
  assert.match(app, /Upload complete: /);
  assert.doesNotMatch(app, /Select overlay —|Your list is active —|Upload complete —|No usable rows —|Could not save —/);
});

test("watchlist views and situation briefs do not display em dashes", () => {
  assert.match(app, /<b>on the watchlist<\/b>: inside a watch area/);
  assert.match(app, /Watchlist: potential impacts/);
  assert.match(app, /mode === "watch" \? html\.replace\(\/\\s\*—\\s\*\/g, ": "\) : html/);
  assert.match(app, /return html\.replace\(\/\\s\*—\\s\*\/g, ": "\);/);
  assert.doesNotMatch(app, /Cultural Heritage Resilience — Situation Brief|Watchlist — potential impacts/);
});

test("the information panel uses high-contrast black text and readable prototype copy", () => {
  assert.match(css, /dialog#about \{[^}]*--panel: #ffffff;[^}]*--ink: #000000;[^}]*--ink-2: #000000;[^}]*--ink-3: #000000;[^}]*--link: #000000;/s);
  assert.match(css, /#about \.about-prototype,\s*#about \.about-lede \{ font-size: 13\.5px; \}/);
});

test("organization profiles use the pending website message when no URL is listed", () => {
  assert.match(app, /<div class="p-nourl">Website to be added\.<\/div>/);
  assert.doesNotMatch(app, /The IMLS source does not include website addresses/);
  assert.doesNotMatch(app, /No website on file in this demo dataset/);
});

test("right-panel organization and hazard controls use the compact layout", () => {
  assert.match(css, /\.panel-head[^}]*padding: 8px 10px[^}]*gap: 3px/s);
  assert.match(css, /\.filter-hint \{ display: none; \}/);
  assert.match(css, /\.filters \{[^}]*gap: 4px/);
  assert.match(css, /\.chip \{[^}]*min-height: 24px[^}]*font-size: 11px[^}]*padding: 3px 7px/s);
});

test("organization points take click priority over overlapping hazard markers", () => {
  assert.match(app, /queryRenderedFeatures\(point, \{ layers: \["org-point"\] \}\)/);
  assert.match(app, /if \(showOrganizationAtPoint\(e\.point\)\) return;/);
});

test("large live result sets are paged only after impact matching", () => {
  assert.match(app, /var EVENT_LIST_PAGE_SIZE = 250/);
  assert.match(app, /var evs = visibleEvents\(\)\.slice\(\)\.sort/);
  assert.match(app, /var shown = evs\.slice\(0, state\.listLimit\)/);
  assert.match(app, /state\.listLimit \+= EVENT_LIST_PAGE_SIZE/);
});
