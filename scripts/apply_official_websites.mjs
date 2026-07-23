// Applies websites found through a single targeted web search per organization.
// Only clearly official library, municipal, county, or state pages are included.
// Ambiguous search results are deliberately omitted.
//
// Usage: node scripts/apply_official_websites.mjs

import fs from "fs";

const dataPath = "data/libraries-expanded.js";
const mappingPath = "data/official-library-websites.json";
const dataWindow = {};
new Function("window", fs.readFileSync(dataPath, "utf8"))(dataWindow);

const libraries = dataWindow.ORGANIZATIONS || [];
const mappings = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
const byKey = new Map(mappings.map(item => [`${item.region}:${item.sourceId}`, item.url]));

if (byKey.size !== mappings.length) throw new Error("Duplicate official website mapping key");
if (!mappings.length) throw new Error("No official website mappings found");

let found = 0;
let updated = 0;
let removed = 0;
for (const org of libraries) {
  if (org.websiteSource !== "Official website search") continue;
  if (byKey.has(`${org.region}:${org.sourceId}`)) continue;
  org.url = null;
  delete org.websiteSource;
  removed++;
}

for (const org of libraries) {
  const url = byKey.get(`${org.region}:${org.sourceId}`);
  if (!url) continue;
  found++;
  if (org.url && org.url !== url && org.websiteSource !== "Official website search") {
    throw new Error(`Refusing to replace a different URL for ${org.name}: ${org.url}`);
  }
  if (!org.url) updated++;
  org.url = url;
  org.websiteSource = "Official website search";
}

if (found !== mappings.length) throw new Error(`Matched ${found} of ${mappings.length} mappings`);

function jsValue(value) {
  return value == null ? "null" : JSON.stringify(value);
}

const lines = libraries.map(org => {
  let line = "  { name: " + jsValue(org.name) +
    ", type: \"library\", libraryType: " + jsValue(org.libraryType) +
    ", city: " + jsValue(org.city) +
    ", region: " + jsValue(org.region) +
    ", country: \"US\", lat: " + org.lat +
    ", lon: " + org.lon +
    ", fips: " + jsValue(org.fips) +
    ", url: " + jsValue(org.url) +
    ", source: " + jsValue(org.source) +
    ", sourceId: " + jsValue(org.sourceId);
  if (org.websiteSource) line += ", websiteSource: " + jsValue(org.websiteSource);
  return line + " },";
});

const output = `// Permanent library expansion generated from official public-use data.\n` +
  `// 1,000 public libraries: IMLS Public Libraries Survey FY 2023, central outlets.\n` +
  `// 1,000 academic libraries: NCES IPEDS Academic Libraries FY 2023 joined to HD2023.\n` +
  `// Website URLs are attributed to OpenStreetMap or a one-search official-site review.\n` +
  `// See scripts/build_library_expansion.mjs, scripts/enrich_library_websites.mjs, and scripts/apply_official_websites.mjs.\n` +
  `window.ORGANIZATIONS = (window.ORGANIZATIONS || []).concat([\n${lines.join("\n")}\n]);\n`;

fs.writeFileSync(dataPath, output, "utf8");
console.error(`Verified ${found} official website mappings; updated ${updated} blank records; removed ${removed} stale mappings.`);
