const test = require("node:test");
const assert = require("node:assert/strict");
const officialWebsiteMappings = require("../data/official-library-websites.json");

global.window = {};
require("../data/organizations.js");
require("../data/libraries-expanded.js");
const organizations = global.window.ORGANIZATIONS;

test("organization data has the expected beta inventory", () => {
  assert.equal(organizations.length, 2583);
  assert.equal(organizations.filter((o) => o.type === "library").length, 2116);
  assert.equal(organizations.filter((o) => o.libraryType === "public").length, 1000);
  assert.equal(organizations.filter((o) => o.libraryType === "academic").length, 1000);
});

test("organization records have valid coordinates, types, and safe website URLs", () => {
  const allowedTypes = new Set(["library", "museum", "archive"]);
  for (const row of organizations) {
    assert.ok(row.name && row.city && row.region && row.country, JSON.stringify(row));
    assert.ok(allowedTypes.has(row.type), row.type);
    assert.ok(Number.isFinite(row.lat) && row.lat >= -90 && row.lat <= 90, row.name);
    assert.ok(Number.isFinite(row.lon) && row.lon >= -180 && row.lon <= 180, row.name);
    if (row.url) assert.match(row.url, /^https?:\/\//i, row.name);
    if (row.fips) assert.match(String(row.fips), /^\d{5}$/, row.name);
  }
});

test("generated library source IDs are unique within each source and state", () => {
  const seen = new Set();
  for (const row of organizations.filter((o) => o.sourceId)) {
    const key = row.source + "::" + row.region + "::" + row.sourceId;
    assert.ok(!seen.has(key), key);
    seen.add(key);
  }
});

test("website enrichment is attributable and leaves ambiguous records blank", () => {
  const enriched = organizations.filter((o) => o.websiteSource === "OpenStreetMap");
  const official = organizations.filter((o) => o.websiteSource === "Official website search");
  assert.ok(enriched.length >= 150, `only ${enriched.length} OSM website matches`);
  for (const row of enriched) {
    assert.equal(row.libraryType, "public", row.name);
    assert.equal(row.source, "IMLS PLS FY2023", row.name);
    assert.match(row.url, /^https?:\/\//i, row.name);
  }
  assert.equal(official.length, officialWebsiteMappings.length);
  for (const row of official) {
    assert.equal(row.libraryType, "public", row.name);
    assert.equal(row.source, "IMLS PLS FY2023", row.name);
    assert.match(row.url, /^https?:\/\//i, row.name);
  }
  assert.ok(organizations.filter((o) => !o.source && !o.url).length <= 2);
});

test("reviewed cross-state and same-name library records use their physical locations and official sites", () => {
  const lawrenceMA = organizations.find((o) => o.sourceId === "LAWRENCE" && o.region === "MA");
  assert.ok(lawrenceMA);
  assert.equal(lawrenceMA.url, "https://www.lawrencepl.org/");
  assert.equal(lawrenceMA.websiteSource, "Official website search");

  const texarkana = organizations.find((o) => o.sourceId === "AR0028-002");
  assert.ok(texarkana);
  assert.equal(texarkana.region, "TX");
  assert.equal(texarkana.fips, "48037");
});
