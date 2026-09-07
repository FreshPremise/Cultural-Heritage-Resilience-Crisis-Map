const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const feeds = fs.readFileSync(path.join(root, "js", "feeds.js"), "utf8");
const chat = fs.readFileSync(path.join(root, "js", "chat.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const dataSources = fs.readFileSync(path.join(root, "DATA_SOURCES.md"), "utf8");
const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
const privacy = fs.readFileSync(path.join(root, "privacy.html"), "utf8");
const version = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));

function openingTag(id) {
  const match = html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`));
  assert.ok(match, `missing opening tag for #${id}`);
  return match[0];
}

function functionSource(name) {
  const match = app.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`));
  assert.ok(match, `missing ${name}()`);
  return match[0];
}

function contrastRatio(foreground, background) {
  function luminance(hex) {
    const channels = hex.match(/[0-9a-f]{2}/gi).map((value) => parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }
  const light = luminance(foreground);
  const dark = luminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

function cssVariable(block, name) {
  const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  assert.ok(value, `missing --${name}`);
  return value;
}

test("README shows the repository-owned application screenshot before What it does", () => {
  const imageRef = "docs/images/cultural-heritage-resilience-map.png";
  const imagePosition = readme.indexOf(`](${imageRef})`);
  assert.ok(imagePosition >= 0, "README screenshot reference is missing");
  assert.ok(imagePosition < readme.indexOf("## What it does"), "README screenshot is not near the top");
  const image = fs.readFileSync(path.join(root, imageRef));
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "screenshot is not a PNG");
});

test("README identifies the Windows launcher as an alternative to the manual server steps", () => {
  assert.match(readme, /\*\*Windows alternative:\*\* Instead of following steps 3-5 above/);
  assert.match(readme, /`Launch-Cultural-Heritage-Resilience\.ps1`/);
  assert.match(readme, /opens only the\s+port that process owns/);
  assert.match(readme, /never probes or reuses an existing local web server/);
  assert.doesNotMatch(readme, /Start-Cultural-Heritage-Resilience\.ps1/);
});

test("README presents local use and rejects unsupported direct-file use", () => {
  assert.match(readme, /The application is designed to be downloaded and run locally\./);
  assert.match(readme, /Opening `index\.html` directly is not supported\. Use one of the local server options above\./);
  assert.doesNotMatch(readme, /open `index\.html` directly/i);
});

test("methodology documents every live-feed selection threshold and partial-data limit", () => {
  for (const rule of [
    /NWS[\s\S]*Moderate, Severe, or Extreme/,
    /Environment and Climate Change Canada[\s\S]*orange or red/,
    /USGS[\s\S]*magnitude 3\.0 or greater/,
    /NIFC WFIGS[\s\S]*at least 100 acres/,
    /CWFIS[\s\S]*larger than 500 hectares/,
    /NASA EONET[\s\S]*Up to 300 open/,
    /5,000-feature boundary/,
    /64 MB per-response boundary/,
    /partial refresh is not a complete trend\s+observation/,
  ]) assert.match(dataSources, rule);
  assert.match(dataSources, /USGS \| 30 km for M3\.0-4\.49; 70 km for M4\.5-5\.49; 150 km for M5\.5-6\.49; 300 km for M6\.5\+/);
  assert.match(dataSources, /WFIGS \| The radius of a circle with the reported incident area, plus an 8 km buffer, with an 8 km minimum/);
  assert.match(dataSources, /NASA EONET \| 300 km for severe storms; 50 km for volcanoes and floods; 25 km for wildfires/);
});

test("the private audit script has an exact root-relative ignore rule", () => {
  const rules = gitignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.ok(rules.includes("/scripts/audit_match_accuracy.mjs"));
  assert.ok(!rules.includes("scripts/audit_match_accuracy.mjs"), "ignore must remain anchored to the repository root");
});

test("README requires Node.js 22 or later for the quoted test glob", () => {
  assert.match(readme, /Run the automated checks with Node\.js 22 or later:/);
  assert.ok(readme.includes('node --test "tests/*.test.cjs"'));
  assert.doesNotMatch(readme, /Node(?:\.js)? 20 or later/);
});

test("README mobile-readiness link points to an existing document", () => {
  const readinessPath = "MOBILE-READINESS.md";
  assert.ok(readme.includes(`[mobile and tablet usability testing](${readinessPath})`));
  assert.ok(fs.statSync(path.join(root, readinessPath)).isFile(), "mobile-readiness document is missing");
});

test("public mobile guidance identifies the current build and outstanding device checks", () => {
  const mobile = fs.readFileSync(path.join(root, "MOBILE-READINESS.md"), "utf8");
  assert.match(mobile, /^# Mobile support and known limitations/);
  assert.ok(mobile.includes(`Current build: \`${version.build}\``));
  assert.ok(mobile.includes(`Asset version: \`${version.assetVersion}\``));
  assert.match(mobile, /physical iPhone/i);
  assert.match(mobile, /screen-reader/i);
  assert.doesNotMatch(mobile, /NEXT-CHAT-HANDOFF|47f3d60|Obtain explicit authorization/);
});

test("public guidance does not assume the information panel is on the right", () => {
  assert.match(readme, /The information panel provides three ways to work with affected organizations:/);
  assert.match(html, /Their icons and colors match the filter controls\./);
  assert.match(app, /<div class="hp-cta">Full details are in the information panel\.<\/div>/);
  assert.doesNotMatch(readme, /The right-hand panel provides three ways/);
  assert.doesNotMatch(html, /Their icons and colors match the controls on the right/);
  assert.doesNotMatch(app, /Full details are in the panel on the right/);
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
  const releaseDate = new Date(`${version.released}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric", timeZone: "UTC",
  });
  assert.ok(html.includes(`Build ${version.build} · Released ${releaseDate}`));
  assert.ok(app.includes("!/^https?:$/.test(window.location.protocol)"));
  assert.match(app, /new URL\("version\.json", document\.baseURI\)/);
  assert.match(app, /versionUrl\.searchParams\.set\("check", String\(Date\.now\(\)\)\)/);
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

test("the approved Groq model id is configured", () => {
  assert.match(chat, /defaultModel: "openai\/gpt-oss-120b"/);
  assert.doesNotMatch(chat, /llama-3\.3-70b-versatile/);
});

test("the document has one primary heading and every dialog has an accessible name", () => {
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
  assert.match(html, /<h1 class="brand-title">/);
  for (const [dialogId, titleId] of [
    ["about", "about-title"],
    ["select-overlay", "select-overlay-title"],
    ["outreach", "outreach-title"],
  ]) {
    assert.match(openingTag(dialogId), new RegExp(`aria-labelledby="${titleId}"`));
    assert.match(html, new RegExp(`<h2 id="${titleId}">`));
  }
});

test("organization search implements the combobox state and keyboard contract", () => {
  const search = openingTag("search");
  const results = openingTag("search-results");
  const status = openingTag("search-status");
  assert.match(search, /role="combobox"/);
  assert.match(search, /aria-autocomplete="list"/);
  assert.match(search, /aria-controls="search-results"/);
  assert.match(search, /aria-expanded="false"/);
  assert.match(search, /aria-describedby="search-status"/);
  assert.match(results, /role="listbox"/);
  assert.match(status, /class="sr-only"/);
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);

  const searchSource = functionSource("setupSearch");
  assert.match(searchSource, /input\.setAttribute\("aria-expanded", "false"\)/);
  assert.match(searchSource, /input\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(searchSource, /role="option" aria-selected="false"/);
  assert.match(searchSource, /node\.setAttribute\("aria-selected", String\(selected\)\)/);
  assert.match(searchSource, /input\.setAttribute\("aria-activedescendant", node\.id\)/);
  assert.match(searchSource, /node\.scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(searchSource, /if \(!items\.length && e\.key === "Enter"\) \{ e\.preventDefault\(\); return; \}/);
});

test("clickable event and organization rows use native controls with focus styles", () => {
  assert.match(html, /<ul id="event-list" class="event-list"><\/ul>/);
  assert.match(app, /<li><button type="button" class="event-item"/);
  assert.match(app, /<button type="button" class="org-row"/);
  assert.match(app, /<button type="button" class="p-evt"/);
  assert.doesNotMatch(app, /<div class="(?:event-item|org-row|p-evt)"/);
  for (const selector of ["event-item", "org-row", "p-evt"]) {
    const block = css.match(new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`))?.[1] || "";
    if (selector === "org-row") {
      for (const side of ["top", "right", "left"]) assert.match(block, new RegExp(`border-${side}:\\s*0;`));
      assert.match(block, /border-bottom:\s*1px solid var\(--line\);/);
    } else {
      assert.match(block, /border:\s*0;/, `${selector} should reset the native button border`);
    }
    assert.match(block, /background:\s*transparent;/, `${selector} should reset the native button background`);
    assert.match(css, new RegExp(`\\.${selector}:focus-visible`));
  }
  assert.match(css, /\.org-row, \.p-evt \{ min-height: 44px; \}/);
});

test("assistant disclosure state and settings state stay synchronized for assistive technology", () => {
  assert.match(openingTag("assistant"), /aria-labelledby="assistant-title"/);
  assert.match(openingTag("assistant"), /aria-hidden="true"/);
  assert.match(openingTag("asst-launch"), /aria-controls="assistant"/);
  assert.match(openingTag("asst-launch"), /aria-expanded="false"/);
  assert.match(openingTag("asst-settings-btn"), /aria-controls="asst-settings"/);
  assert.match(openingTag("asst-settings-btn"), /aria-expanded="false"/);
  assert.match(chat, /function openPanel\(\)[\s\S]*?setAttribute\("aria-hidden", "false"\)[\s\S]*?setAttribute\("aria-expanded", "true"\)/);
  assert.match(chat, /function closePanel\(\)[\s\S]*?setAttribute\("aria-hidden", "true"\)[\s\S]*?setAttribute\("aria-expanded", "false"\)[\s\S]*?el\("asst-launch"\)\.focus\(\)/);
  assert.match(chat, /function openSettings\(\)[\s\S]*?setAttribute\("aria-expanded", "true"\)/);
  assert.match(chat, /function closeSettings\(\)[\s\S]*?setAttribute\("aria-expanded", "false"\)/);
});

test("mobile controls have semantic collapsed defaults and hidden content stays hidden", () => {
  assert.match(css, /:where\(\[hidden\]\)\s*\{\s*display:\s*none\s*!important;\s*\}/);

  const panel = openingTag("panel-filters");
  const filters = openingTag("mobile-filter-toggle");
  const priority = openingTag("list-priority-toggle");
  assert.match(panel, /class="[^"]*\bfilters-collapsed\b[^"]*"/);
  assert.match(filters, /\btype="button"/);
  assert.match(filters, /\baria-expanded="false"/);
  assert.match(filters, /\baria-controls="filter-groups"/);
  assert.match(html, /id="filter-groups" class="filter-groups"/);
  assert.match(priority, /\btype="button"/);
  assert.match(priority, /\baria-pressed="false"/);
  assert.match(priority, /\baria-controls="map panel"/);
  const controls = html.match(/<div class="mobile-panel-controls">([\s\S]*?)<\/div>/)?.[1] || "";
  const titleRow = html.match(/<div[^>]*id="list-title-row"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
  assert.match(controls, /id="mobile-filter-toggle"/);
  assert.match(controls, /id="list-priority-toggle"/);
  assert.match(titleRow, /Active events/);
  assert.doesNotMatch(titleRow, /list-priority-toggle/);
  assert.match(openingTag("impact-bar"), /\bhidden\b/);
  assert.match(openingTag("watch-bar"), /\bhidden\b/);
});

test("mobile filter and list-priority state stay synchronized", () => {
  const filterSetter = functionSource("setMobileFiltersExpanded");
  const prioritySetter = functionSource("setListPriority");
  const setup = functionSource("setupMobilePanelControls");

  assert.match(filterSetter, /classList\.toggle\("filters-collapsed", !expanded\)/);
  assert.match(filterSetter, /setAttribute\("aria-expanded", String\(!!expanded\)\)/);
  assert.match(prioritySetter, /classList\.toggle\("list-priority", !!on\)/);
  assert.match(prioritySetter, /setAttribute\("aria-pressed", String\(!!on\)\)/);
  assert.match(prioritySetter, /updateListPriorityLabel\(\);/);
  assert.match(prioritySetter, /requestAnimationFrame\(function \(\) \{ if \(map\) map\.resize\(\); \}\)/);
  assert.match(setup, /setMobileFiltersExpanded\(false\)/);
  assert.match(setup, /setListPriority\(false\)/);
  assert.match(app, /buildFilters\(\);\s*setupMobilePanelControls\(\);/);
  assert.match(css, /#app-main\.list-priority #map\s*\{\s*height:\s*clamp\(96px, 22%, 180px\);\s*\}/);
  assert.match(css, /\.panel-head\.filters-collapsed \.filter-groups\s*\{\s*display:\s*none;\s*\}/);
});

test("list-priority labels follow the visible panel content and pressed state", () => {
  const source = functionSource("updateListPriorityLabel");
  for (const mode of ["list", "detail", "affected"]) {
    for (const pressed of [false, true]) {
      const label = { textContent: "" };
      const button = { getAttribute: () => String(pressed) };
      const context = {
        state: { panelMode: mode },
        el: (id) => id === "list-priority-toggle" ? button : label,
      };
      vm.runInNewContext(`${source}; updateListPriorityLabel();`, context);
      assert.equal(label.textContent, pressed ? "Show map" : mode === "list" ? "More list" : "More details", `${mode}, pressed=${pressed}`);
    }
  }
  for (const [name, mode] of [["renderList", "list"], ["renderDetail", "detail"], ["showAffected", "affected"]]) {
    assert.match(functionSource(name), new RegExp(`state\\.panelMode = "${mode}";\\s*updateListPriorityLabel\\(\\);`));
  }
});

test("explicit navigation restores map space before moving while marker selection preserves it", () => {
  const sources = ["prepareMapForNavigation", "selectEvent"].map(functionSource).join(";\n");
  function navigate(priorityActive, opts, geometry = false) {
    const calls = [];
    const main = priorityActive === null ? null : { classList: { contains: () => priorityActive } };
    const event = { id: "event", point: [-84, 34] };
    if (geometry) event.geometry = {};
    const context = {
      state: { events: [event] }, opts, popup: null,
      el: () => main,
      setListPriority: (on) => { calls.push(`priority:${on}`); priorityActive = on; },
      map: {
        resize: () => calls.push("resize"), getZoom: () => 4,
        easeTo: () => calls.push("easeTo"), fitBounds: () => calls.push("fitBounds"),
      },
      geomBounds: () => [[-85, 33], [-83, 35]],
      eventFramePadding: () => ({}), pointFramePadding: () => ({}),
      renderDetail: () => calls.push("detail"),
    };
    vm.runInNewContext(`${sources}; selectEvent("event", opts);`, context);
    return calls;
  }
  assert.deepEqual(navigate(true, {}), ["priority:false", "resize", "easeTo", "detail"]);
  assert.deepEqual(navigate(true, {}, true), ["priority:false", "resize", "fitBounds", "detail"]);
  assert.deepEqual(navigate(false, {}), ["easeTo", "detail"]);
  assert.deepEqual(navigate(null, {}), ["easeTo", "detail"]);
  assert.deepEqual(navigate(true, { frame: false }), ["detail"]);

  for (const name of ["renderDetail", "showAffected", "resetView"]) {
    assert.match(functionSource(name), /prepareMapForNavigation\(\);\s*(?:if \(map\) )?map\.easeTo/);
  }
  const search = functionSource("setupSearch");
  assert.match(search, /function frame\(orgs\)[\s\S]*?prepareMapForNavigation\(\);[\s\S]*?map\.fitBounds/);
  assert.match(search, /function pick\(o\)[\s\S]*?prepareMapForNavigation\(\);[\s\S]*?map\.easeTo/);
  assert.match(app, /focusOrganization: function \(id, opts\) \{[\s\S]*?prepareMapForNavigation\(\);\s*map\.easeTo/);
  for (const name of ["showOrgPopup", "showHazardPopup"]) {
    assert.doesNotMatch(functionSource(name), /prepareMapForNavigation|setListPriority|map\.(?:easeTo|fitBounds)/);
  }
});

test("responsive rules cover tablets, touch targets, and device safe areas", () => {
  const mobile = css.match(/@media\s+\(max-width:\s*900px\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(mobile, "the mobile layout must include widths through 900 pixels");
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover[^"]*">/);
  for (const edge of ["top", "right", "bottom", "left"]) {
    assert.match(css, new RegExp(`env\\(safe-area-inset-${edge}\\)`));
  }
  assert.match(css, /@media \(max-width: 1200px\)[\s\S]*?\.stats, \.brand-sub, \.feed-label \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 1200px\)[\s\S]*?\.search \{ width: auto; min-width: 0; flex: 1; margin-left: 0; \}/);
  assert.match(mobile, /#map\s*\{\s*height:\s*46%;\s*flex:\s*none;\s*\}/);
  assert.match(mobile, /#feed-status\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*clip:\s*rect\(0, 0, 0, 0\);/);
  assert.match(mobile, /\.feed-summary-indicator \{ display: block; \}/);
  assert.match(css, /\.mobile-panel-controls,\s*\.mobile-filter-toggle\s*\{\s*display:\s*none;\s*\}/);
  assert.match(mobile, /\.mobile-panel-controls\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*44px/);
  assert.match(mobile, /\.evt-meta\s*\{[^}]*display:\s*-webkit-box;[^}]*-webkit-line-clamp:\s*2;[^}]*-webkit-box-orient:\s*vertical;[^}]*overflow:\s*hidden;/);
  assert.match(css, /\.mobile-filter-toggle\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.chip\s*\{[^}]*min-height:\s*40px/);
  assert.match(css, /\.list-priority-toggle\s*\{[^}]*min-height:\s*40px/);
  assert.match(css, /#panel\s*\{[^}]*padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  assert.match(css, /#panel\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.event-list\s*\{[^}]*padding:\s*2px 0 14px;/);
  assert.doesNotMatch(css, /\.event-list\s*\{[^}]*safe-area-inset-bottom/);
  assert.match(css, /\.update-notice\s*\{[^}]*top:\s*calc\(64px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.update-notice\s*\{[^}]*top:\s*calc\(60px \+ env\(safe-area-inset-top\)\)/);
  assert.match(css, /#assistant\.collapsed \{ display: none; width: 0; \}/);
  assert.doesNotMatch(css, /#feed-status\s*\{[^}]*display:\s*none/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*?\.brand-text\s*\{[^}]*position:\s*absolute;[^}]*clip:\s*rect\(0, 0, 0, 0\);/);
});

test("feed health remains available to screen readers and visible in compact layouts", () => {
  const status = openingTag("feed-status");
  assert.match(status, /role="status"/);
  assert.match(status, /aria-live="polite"/);
  assert.match(status, /aria-atomic="true"/);
  assert.match(openingTag("feed-summary-indicator"), /aria-hidden="true"/);
  assert.match(html, /<button id="refresh-btn"[\s\S]*?<span id="feed-summary-indicator"[\s\S]*?<\/button>/);
  assert.match(css, /\.sr-only\s*\{[^}]*width:\s*1px !important;[^}]*clip:\s*rect\(0, 0, 0, 0\) !important;/);

  const feedStatus = functionSource("setFeedStatus");
  assert.match(feedStatus, /<span class="sr-only">/);
  assert.match(feedStatus, /Refresh feeds\. " \+ summary/);
  assert.match(feedStatus, /indicator\.className = "dot feed-summary-indicator " \+ \(pending \? "pending" : failed\.length \? "fail" : stale\.length \? "stale" : "ok"\)/);
  assert.match(functionSource("renderFeedWarning"), /Counts, exports, briefs, and trends may be incomplete\./);
  assert.match(app, /if \(state\.feedsComplete\) \{\s*renderTrend\(recordHistory\(publicHistoryAffectedCount\(\)\), true\);/);
  assert.match(app, /currentHistoryPointTime = 0;\s*renderTrend\(loadHistory\(\), false\);/);
});

test("radar freshness is age-bounded and its state remains visible in compact layouts", () => {
  const source = functionSource("radarFrameIsFresh");
  const context = { RADAR_FRESH_MAX_AGE_SECONDS: 30 * 60, result: null };
  vm.runInNewContext(
    `${source}; result = {
      current: radarFrameIsFresh(10_000, 10_100),
      boundary: radarFrameIsFresh(8_200, 10_000),
      old: radarFrameIsFresh(8_199, 10_000),
      future: radarFrameIsFresh(10_601, 10_000),
    };`,
    context
  );
  assert.equal(context.result.current, true);
  assert.equal(context.result.boundary, true);
  assert.equal(context.result.old, false);
  assert.equal(context.result.future, false);
  assert.match(app, /state\.radarState = radarFrameIsFresh\(RADAR\.time\) \? "fresh" : "stale"/);
  assert.match(openingTag("radar-status-label"), /class="radar-status-label"/);
  assert.match(functionSource("updateRadarAccessibility"), /visible\.textContent = state\.radarOn/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.radar-status-label\s*\{[^}]*display:\s*block;/);
});

test("secondary text and lower-severity colors meet normal-text contrast", () => {
  const light = css.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const dark = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  const checks = [
    [light, "ink-3", "panel-2"],
    [light, "sev2", "panel-2"],
    [light, "sev1", "panel-2"],
    [dark, "ink-3", "panel-2"],
    [dark, "sev2", "panel-2"],
    [dark, "sev1", "panel-2"],
  ];
  for (const [block, foreground, background] of checks) {
    const ratio = contrastRatio(cssVariable(block, foreground), cssVariable(block, background));
    assert.ok(ratio >= 4.5, `${foreground} on ${background} contrast is only ${ratio.toFixed(2)}:1`);
  }
});

test("stacked list-priority mode keeps map controls in one short row", () => {
  const mobile = css.match(/@media\s+\(max-width:\s*900px\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(mobile, "all stacked mobile maps need horizontally arranged controls");
  assert.match(mobile, /#app-main\.list-priority \.maplibregl-ctrl-top-left\s*\{[^}]*display:\s*flex/);
  assert.match(mobile, /#app-main\.list-priority \.maplibregl-ctrl-top-left \.maplibregl-ctrl-group\s*\{[^}]*display:\s*flex/);
  assert.match(mobile, /button \+ button\s*\{[^}]*border-top:\s*none !important;[^}]*border-left:/);
});

test("short phone landscape uses side-by-side panels and bounded impact text", () => {
  const landscape = css.match(/@media\s+\(max-width:\s*900px\) and \(max-height:\s*500px\) and \(orientation:\s*landscape\)\s*\{([\s\S]*?)\n\}/)?.[1];
  assert.ok(landscape, "short landscape needs its own layout guard");
  assert.match(landscape, /main\s*\{\s*flex-direction:\s*row;\s*\}/);
  assert.match(landscape, /#map\s*\{[^}]*height:\s*auto;[^}]*flex:\s*1;/);
  assert.match(landscape, /#panel\s*\{[^}]*width:\s*clamp\(248px,\s*48vw,\s*400px\);[^}]*flex:\s*none;/);
  assert.match(landscape, /#app-main\.list-priority #map\s*\{[^}]*height:\s*auto;[^}]*flex:\s*0 0 96px;/);
  assert.match(landscape, /#app-main\.list-priority #panel\s*\{[^}]*width:\s*auto;[^}]*flex:\s*1;/);
  assert.match(landscape, /#app-main\.list-priority \.maplibregl-ctrl-top-left\s*\{[^}]*display:\s*block/);
  assert.match(landscape, /#app-main\.list-priority \.maplibregl-ctrl-top-left \.maplibregl-ctrl-group\s*\{[^}]*display:\s*block/);
  assert.match(landscape, /button \+ button\s*\{[^}]*border-top:\s*1px solid var\(--line\) !important;[^}]*border-left:\s*none !important;/);
  assert.match(landscape, /\.impact-text\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
});

test("map framing fits the actual container and centers every point destination", () => {
  const sources = ["eventFramePadding", "pointFramePadding"].map(functionSource).join(";\n");
  const zero = { top: 0, bottom: 0, left: 0, right: 0 };
  const cases = [
    ["desktop", { clientWidth: 1000, clientHeight: 700 }, { top: 24, bottom: 24, left: 24, right: 24 }],
    ["phone", { clientWidth: 390, clientHeight: 300 }, { top: 24, bottom: 24, left: 24, right: 24 }],
    ["narrow 96px map", { clientWidth: 96, clientHeight: 300 }, { top: 24, bottom: 24, left: 19, right: 19 }],
    ["short 96px map", { clientWidth: 390, clientHeight: 96 }, { top: 19, bottom: 19, left: 24, right: 24 }],
    ["absent map container", null, zero],
  ];
  for (const [label, container, eventPadding] of cases) {
    const context = { el: (id) => id === "map" ? container : null, result: null };
    vm.runInNewContext(`${sources}; result = { event: eventFramePadding(), point: pointFramePadding() };`, context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.result)), { event: eventPadding, point: zero }, label);
  }
  assert.doesNotMatch(app, /panelIsBelowMap|\bpadding:\s*70\b|\bright:\s*(?:380|400)\b/);
  assert.match(app, /fitBounds\(b, \{ padding: eventFramePadding\(\)/);
  assert.match(app, /fitBounds\(\[\[west, south\], \[east, north\]\], \{ padding: eventFramePadding\(\)/);
  const pointMoves = app.match(/map\.easeTo\(\{[^}]+\}\)/g) || [];
  assert.equal(pointMoves.length, 7);
  for (const move of pointMoves) assert.match(move, /padding:\s*pointFramePadding\(\)/);
});

test("scrollable dialogs provide accessible top close controls", () => {
  for (const id of ["about-close-top", "select-close-top", "outreach-close-top"]) {
    const button = openingTag(id);
    assert.match(button, /class="dialog-close"/);
    assert.match(button, /\btype="button"/);
    assert.match(button, /\baria-label="[^"]+"/);
    assert.match(app, new RegExp(`el\\("${id}"\\)\\.addEventListener\\("click"`));
  }
  assert.match(css, /\.about-inner\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.dialog-close\s*\{[^}]*position:\s*sticky[^}]*width:\s*44px[^}]*height:\s*44px/s);
  assert.match(css, /\.dialog-close\s*\{[^}]*top:\s*max\(8px,\s*env\(safe-area-inset-top\)\)/);
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
  assert.match(app, /e\.affectedShown\.length \|\| isCwfisWildfire\(e\)/);
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
  assert.match(chat, /On for this tab and this list\. Relevant records may be sent only to/);
  assert.match(chat, /Sharing must be approved separately for each recipient and replacement list\./);
  assert.match(chat, /hw:selected-list-changed/);
  assert.match(chat, /Security\.privateGrantAllows\(settings\.privateGrant, recipient, list\.generation\)/);
  assert.match(chat, /draftConsentRecipient === nextRecipient && draftPrivateGeneration === list\.generation/);
  assert.match(chat, /window\.addEventListener\("hw:selected-list-changed"[\s\S]*?settings\.privateGrant = null/);
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
  assert.ok(html.indexOf(downloadNote) > html.indexOf('<h2 id="about-title">Cultural Heritage Resilience</h2>'));
  assert.ok(html.indexOf(downloadNote) < html.indexOf('class="about-prototype"'));
  assert.match(openingTag("about"), /aria-labelledby="about-title"/);
  assert.match(html, /This project may be downloaded from <a href="https:\/\/github\.com\/FreshPremise\/Cultural-Heritage-Resilience-Crisis-Map"[^>]*>GitHub<\/a>\./);
  assert.match(html, /Prototype:<\/b> This map shows a non-exhaustive sample of cultural heritage organizations across North America/);
  assert.match(html, /This beta monitors 2,583 institutions/);
  assert.doesNotMatch(html, /47,?000|47 thousand/i);
  assert.match(readme, /Displays 2,583 libraries, museums, and archives/);
  assert.doesNotMatch(readme, /47,?000|47 thousand/i);
  assert.match(html, /class="about-prototype"/);
  assert.match(html, /This is an interactive live crisis map for North American cultural heritage organizations/);
  assert.match(html, /class="about-map-guide"/);
  assert.match(html, /id="about-hazard-icons"/);
  assert.match(html, /Red stars\.<\/b> These are organizations from your uploaded spreadsheet/);
  assert.match(html, /National Weather Service alerts<\/a> — US watches, warnings, and advisories/);
  assert.match(html, /CWFIS includes satellite-derived Canadian FireM3 perimeter estimates larger than 500 hectares; these are not operational incident perimeters/);
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
  const dialog = html.match(/<dialog id="select-overlay"[^>]*>[\s\S]*?<\/dialog>/)?.[0] || "";
  assert.match(dialog, /aria-labelledby="select-overlay-title"/);
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

test("the spatial index keeps a representative large-data candidate workload bounded", () => {
  const GRID_DEGREES = 2;
  const ORGS = Array.from({ length: 10000 }, (_, i) => ({
    id: `org${i}`,
    lon: -169 + (i % 200) * 0.59,
    lat: 10 + Math.floor(i / 200) * 1.4,
  }));
  const orgGrid = {};
  for (const org of ORGS) {
    const key = `${Math.floor(org.lon / GRID_DEGREES)}:${Math.floor(org.lat / GRID_DEGREES)}`;
    (orgGrid[key] ||= []).push(org);
  }
  const context = { ORGS, orgGrid, orgsByFips: {}, GRID_DEGREES, total: 0 };
  const started = performance.now();
  vm.runInNewContext(
    `${functionSource("orgsInBounds")}; ${functionSource("candidateOrganizations")};
     for (let i = 0; i < 1000; i++) {
       const org = ORGS[(i * 37) % ORGS.length];
       total += candidateOrganizations({ point: [org.lon, org.lat], radiusKm: 30 }).length;
     }`,
    context
  );
  const elapsed = performance.now() - started;
  assert.ok(context.total < 100000, `candidate ceiling exceeded: ${context.total}`);
  assert.ok(elapsed < 2000, `representative candidate benchmark took ${elapsed.toFixed(1)} ms`);
});

test("NWS alerts keep host-checked warned-zone URLs for the polygon upgrade", () => {
  assert.match(feeds, /zones: zoneUrls\.length \? zoneUrls : null/);
  assert.match(feeds, /zonesTruncated,/);
  assert.match(feeds, /rawZoneUrls\.length !== allZoneUrls\.length \|\| allZoneUrls\.length > MAX_NWS_ZONE_URLS/);
  assert.ok(
    feeds.includes("/^https:\\/\\/api\\.weather\\.gov\\/zones\\//.test(u)"),
    "affectedZones URLs must be restricted to api.weather.gov"
  );
  assert.match(feeds, /window\.Feeds = \{[\s\S]*?\n    fetchJSON,/);
  assert.match(feeds, /window\.Feeds = \{[\s\S]*?\n    geometryIsUsable,/);
});

test("estimated wildfire areas and rendered circles are bounded", () => {
  assert.match(feeds, /const MAX_WFIGS_ACRES = 100000000/);
  assert.match(feeds, /acres > MAX_WFIGS_ACRES/);
  const source = functionSource("circlePolygon");
  const context = { result: null };
  vm.runInNewContext(
    `${source}; result = {
      valid: circlePolygon([-122, 44], 300),
      huge: circlePolygon([-122, 44], 501),
      invalidPoint: circlePolygon([Infinity, 44], 30),
    };`,
    context
  );
  assert.equal(context.result.valid.type, "Polygon");
  assert.equal(context.result.huge, null);
  assert.equal(context.result.invalidPoint, null);
});

test("impact-changing operations dismiss snapshot popups", () => {
  assert.match(functionSource("computeImpact"), /if \(popup\) popup\.remove\(\);/);
  assert.match(functionSource("rerenderImpactViews"), /if \(popup\) popup\.remove\(\);/);
});

test("a county-matched alert upgrades to its warned-zone polygon and sheds outside organizations", () => {
  const names = [
    "pointInRing", "pointInPolygon", "pointInGeometry", "orgInEvent", "zoneKey",
    "mergeZoneGeometries", "applyZoneGeometry", "isApproxMatch", "eventZoneKeys",
  ];
  const sources = names.map((name) => {
    const source = app.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}`))?.[0];
    assert.ok(source, `${name} is missing`);
    return source;
  });

  // The live case verified on 2026-08-06: a Fire Weather Watch for fire zone ORZ703
  // (Warm Springs Reservation, east slopes of the Cascades) listed Marion County in its
  // SAME codes because the zone clips the county's mountain edge, which flagged Salem
  // organizations 90 miles away on the valley floor. The zone polygon excludes Salem.
  const context = {
    zoneMem: {},
    salem: { lon: -123.041, lat: 44.939, fips: "41047" },
    warmSprings: { lon: -121.13, lat: 44.63, fips: "41031" },
    event: {
      feed: "nws",
      geometry: null,
      fips: ["41005", "41031", "41047", "41065"],
      zones: ["https://api.weather.gov/zones/fire/ORZ703"],
      affected: ["seed"],
    },
    result: null,
  };
  const feedsContext = { window: {} };
  vm.runInNewContext(feeds, feedsContext);
  context.Feeds = { geometryIsUsable: feedsContext.window.Feeds.geometryIsUsable };
  vm.runInNewContext(
    `${sources.join(";\n")};\n` +
      `result = {
        countyMatchSalem: orgInEvent(salem, event),
        approxBefore: isApproxMatch(event),
         keys: eventZoneKeys(event),
         truncatedKeys: eventZoneKeys(Object.assign({}, event, { zonesTruncated: true })),
        forecastKey: zoneKey("https://api.weather.gov/zones/forecast/ORZ011"),
        fireKey: zoneKey("https://api.weather.gov/zones/fire/ORZ011"),
        foreignKey: zoneKey("https://example.com/zones/fire/ORZ011"),
        partialMerge: mergeZoneGeometries([{ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, null]),
      };
      zoneMem["fire/ORZ703"] = { type: "Polygon", coordinates: [[[-121.9, 44.45], [-120.8, 44.45], [-120.8, 45.3], [-121.9, 45.3], [-121.9, 44.45]]] };
      result.applied = applyZoneGeometry(event, ["fire/ORZ703"]);
      result.geometryType = event.geometry && event.geometry.type;
      result.approxAfter = isApproxMatch(event);
      result.salemAfter = orgInEvent(salem, event);
      result.warmSpringsAfter = orgInEvent(warmSprings, event);`,
    context
  );
  assert.equal(context.result.countyMatchSalem, true, "county fallback should match Salem before the upgrade");
  assert.equal(context.result.approxBefore, true);
  assert.deepEqual(Array.from(context.result.keys), ["fire/ORZ703"]);
  assert.equal(context.result.truncatedKeys, null, "a bounded subset must not be applied as a complete warned area");
  assert.equal(context.result.forecastKey, "forecast/ORZ011");
  assert.equal(context.result.fireKey, "fire/ORZ011");
  assert.equal(context.result.foreignKey, null, "non-NWS zone URLs must not produce cache keys");
  assert.equal(context.result.partialMerge, null, "a partial zone set must never be used for matching");
  assert.equal(context.result.applied, true);
  assert.equal(context.result.geometryType, "MultiPolygon");
  assert.equal(context.result.approxAfter, false);
  assert.equal(context.result.salemAfter, false, "Salem must drop out once the true zone polygon is applied");
  assert.equal(context.result.warmSpringsAfter, true, "organizations inside the zone must still match");
});

test("trend history keeps a stable public scope and revises the current complete sample after zone refinement", () => {
  const names = ["loadHistory", "recordHistory", "publicHistoryAffectedCount", "reviseCurrentHistory", "renderTrend"];
  const sources = names.map(functionSource).join(";\n");
  const storage = {};
  const trend = { innerHTML: "", title: "", removeAttribute(name) { if (name === "title") this.title = ""; } };
  const context = {
    HIST_LS: "history-test",
    currentHistoryPointTime: 0,
    affectedEntries: [{ org: {} }, { org: { selected: true } }, { org: {} }],
    notWatch: function () { return true; },
    affectedIndex: function () { return context.affectedEntries; },
    localStorage: {
      getItem: function (key) { return storage[key] || null; },
      setItem: function (key, value) { storage[key] = value; },
    },
    el: function () { return trend; },
    result: null,
  };
  vm.runInNewContext(
    `${sources}; Date.now = () => 10000;
     const publicCount = publicHistoryAffectedCount();
     const first = recordHistory(publicCount);
     const revised = reviseCurrentHistory(1);
     renderTrend([{ t: 9000, a: 3, complete: true }, { t: 10000, a: 1, complete: true }], false);
     result = { publicCount, first: first.map(p => ({...p})), revised: revised.map(p => ({...p})), title: el().title };`,
    context
  );
  assert.equal(context.result.publicCount, 2, "private-list records must not change the public trend scope");
  assert.equal(context.result.first[0].a, 2);
  assert.equal(context.result.revised.length, 1, "zone refinement must revise instead of appending");
  assert.equal(context.result.revised[0].a, 1);
  assert.match(context.result.title, /last complete refresh 1, peak 3/);
  assert.match(functionSource("afterZoneUpgrade"), /renderTrend\(reviseCurrentHistory\(publicHistoryAffectedCount\(\)\), true\)/);
});

test("the My list only view narrows every display surface to uploaded organizations", () => {
  assert.match(app, /mine\.id = "only-mine-chip"/);
  assert.match(app, /var ONLY_LS = "hw-only-selected"/);
  assert.match(app, /state\.typeOn\[o\.type\] && orgShown\(o\)/);
  assert.match(app, /orgShown\(o\) && \(o\.name\.toLowerCase\(\)/);
  assert.match(app, /\(includeHiddenOrgs \? e\.affected : e\.affectedShown\)\.forEach/);
  assert.match(app, /affectedIndex\(filterFn, false, true\)/);
  assert.match(app, /mapShowsOnlyPrivateList: includeSelected \? !!state\.onlySelected : false/);
  assert.match(app, /localStorage\.getItem\("hw-only-selected"\) === "1" && ORGS\.some/);
  assert.match(html, /a "My list only" button appears/);
  assert.match(css, /\.chip \.cdot\.star \{/);

  const orgShownSource = app.match(/function orgShown\(o\) \{[\s\S]*?\}/)?.[0];
  const refreshSource = app.match(/function refreshShownAffected\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(orgShownSource && refreshSource, "My-list-only helpers are missing");
  const context = {
    state: {
      onlySelected: true,
      events: [
        { affected: ["pub1", "mine1", "mine2"] },
        { affected: ["pub2"] },
      ],
    },
    orgById: { pub1: {}, pub2: {}, mine1: { selected: true }, mine2: { selected: true } },
    result: null,
  };
  vm.runInNewContext(
    `${orgShownSource}; ${refreshSource};
     refreshShownAffected();
     const onCounts = state.events.map(e => e.affectedShown.length);
     const fullCounts = state.events.map(e => e.affected.length);
     const shownPublicOn = orgShown({});
     const shownMineOn = orgShown({ selected: true });
     state.onlySelected = false;
     refreshShownAffected();
     result = { onCounts, fullCounts, shownPublicOn, shownMineOn,
       offIdentity: state.events.every(e => e.affectedShown === e.affected) };`,
    context
  );
  assert.deepEqual(Array.from(context.result.onCounts), [2, 0], "shown-affected must keep only uploaded organizations while the view is on");
  assert.deepEqual(Array.from(context.result.fullCounts), [3, 1], "the full match set must stay untouched");
  assert.equal(context.result.shownPublicOn, false);
  assert.equal(context.result.shownMineOn, true);
  assert.equal(context.result.offIdentity, true, "turning the view off must restore the full affected list");
});

test("county-level matches are labeled approximate until the exact zone arrives", () => {
  assert.match(app, /applyCachedZonePolygons\(\);\n      computeImpact\(\);/);
  assert.match(app, /fetchMissingZonePolygons\(generation\);/);
  assert.doesNotMatch(functionSource("selectionChanged"), /fetchMissingZonePolygons/);
  assert.match(app, /Feeds\.fetchJSON\(queue\[key\], 20000, ZONE_FETCH_MAX_BYTES\)/);
  assert.match(app, /class="approx-flag"/);
  assert.match(app, /"county-approximate": "County-level approximation"/);
  assert.match(app, /e\.matchMethod = "official-zone"/);
  assert.match(app, /matchMethod: e\.matchMethod \|\| \(isApproxMatch\(e\) \? "county-approximate" : "unknown"\)/);
  assert.match(app, /matchPrecision: e\.matchMethod \|\| \(isApproxMatch\(e\) \? "county-approximate" : "unknown"\)/);
  assert.match(app, /var ZONE_LS = "hw-zone-geoms-v2"/);
  assert.match(functionSource("loadZoneStore"), /localStorage\.removeItem\(LEGACY_ZONE_LS\)/);
  assert.match(app, /localStorage\.removeItem\(ZONE_LS\)/);
  assert.match(css, /\.approx-flag \{/);
  const approxTitle = app.match(/var APPROX_TITLE = "([^"]+)"/)?.[1] || "";
  assert.ok(approxTitle.length > 40, "approximate-match explanation is missing");
  assert.doesNotMatch(approxTitle, /—/);
});

test("private-list matches cannot schedule official-zone network requests", () => {
  const countSource = functionSource("eventPublicAffectedCount");
  const fetchSource = functionSource("fetchMissingZonePolygons");
  const context = {
    orgById: {
      public1: { selected: false },
      private1: { selected: true },
    },
    result: null,
  };
  vm.runInNewContext(
    `${countSource}; result = {
      publicOnly: eventPublicAffectedCount({ affected: ["public1"] }),
      privateOnly: eventPublicAffectedCount({ affected: ["private1"] }),
      mixed: eventPublicAffectedCount({ affected: ["public1", "private1"] })
    };`,
    context
  );
  assert.deepEqual({ ...context.result }, { publicOnly: 1, privateOnly: 0, mixed: 1 });
  assert.match(fetchSource, /!eventPublicAffectedCount\(e\)/);
  assert.doesNotMatch(fetchSource, /e\.affected\.length/);
});
