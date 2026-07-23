// Adds public-library website URLs from high-confidence OpenStreetMap matches.
//
// This is intentionally a separate, repeatable step because the IMLS FY2023
// public-use files do not contain website URLs.
//
//   node scripts/enrich_library_websites.mjs queries <output-directory>
//   # POST each .overpassql file to an Overpass API and save matching .json files.
//   node scripts/enrich_library_websites.mjs apply <json-directory>
//
// Matches require both geographic proximity and compatible names. Ambiguous
// results remain null instead of receiving a guessed URL.

import fs from "fs";
import path from "path";

const [, , command, inputPath] = process.argv;
if (!command || !inputPath || !["queries", "apply"].includes(command)) {
  console.error("Usage: node scripts/enrich_library_websites.mjs <queries|apply> <directory>");
  process.exit(1);
}

const dataPath = "data/libraries-expanded.js";
const dataWindow = {};
new Function("window", fs.readFileSync(dataPath, "utf8"))(dataWindow);
const libraries = dataWindow.ORGANIZATIONS || [];
const publicLibraries = libraries.filter(org =>
  org.libraryType === "public" && org.source === "IMLS PLS FY2023"
);

function textKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const genericWords = new Set([
  "and", "branch", "central", "city", "community", "county", "district",
  "free", "headquarters", "library", "main", "memorial", "municipal",
  "of", "public", "regional", "system", "the",
]);

function nameTokens(value) {
  return new Set(textKey(value).split(" ").filter(word => word && !genericWords.has(word)));
}

function nameScore(a, b) {
  const rawA = textKey(a), rawB = textKey(b);
  if (rawA && rawA === rawB) return 1;
  const left = nameTokens(a), right = nameTokens(b);
  if (!left.size || !right.size) return 0;
  let common = 0;
  left.forEach(word => { if (right.has(word)) common++; });
  return common / Math.max(left.size, right.size);
}

function distanceMeters(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat), lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function website(value) {
  let candidate = String(value || "").split(/[;,]/)[0].trim();
  if (!candidate) return null;
  if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.hostname.includes(".")
      ? parsed.href
      : null;
  } catch (_) {
    return null;
  }
}

if (command === "queries") {
  fs.mkdirSync(inputPath, { recursive: true });
  const batchSize = 50;
  for (let start = 0; start < publicLibraries.length; start += batchSize) {
    const batch = publicLibraries.slice(start, start + batchSize);
    const statements = batch.map(org =>
      `nwr(around:300,${org.lat},${org.lon})["amenity"="library"];`
    ).join("\n");
    const query = `[out:json][timeout:120];\n(\n${statements}\n);\nout center tags;\n`;
    const number = String(start / batchSize + 1).padStart(2, "0");
    fs.writeFileSync(path.join(inputPath, `libraries-${number}.overpassql`), query, "utf8");
  }
  console.error(`Wrote ${Math.ceil(publicLibraries.length / batchSize)} Overpass query files to ${inputPath}`);
  process.exit(0);
}

const features = [];
for (const filename of fs.readdirSync(inputPath).filter(name => name.endsWith(".json")).sort()) {
  const payload = JSON.parse(fs.readFileSync(path.join(inputPath, filename), "utf8"));
  for (const element of payload.elements || []) {
    const tags = element.tags || {};
    const url = website(tags.website || tags["contact:website"]);
    const lat = Number(element.lat ?? element.center?.lat);
    const lon = Number(element.lon ?? element.center?.lon);
    if (!url || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    features.push({
      id: `${element.type}/${element.id}`,
      name: tags.name || tags.official_name || tags.short_name || "",
      lat,
      lon,
      url,
    });
  }
}

const uniqueFeatures = [...new Map(features.map(feature => [feature.id, feature])).values()];
let matched = 0;
let ambiguous = 0;
for (const org of publicLibraries) {
  if (website(org.url)) continue;
  const nearby = uniqueFeatures.map(feature => ({
    feature,
    distance: distanceMeters(org, feature),
    score: nameScore(org.name, feature.name),
  })).filter(match => match.distance <= 300).sort((a, b) =>
    b.score - a.score || a.distance - b.distance
  );

  const best = nearby[0];
  if (!best) continue;
  const acceptable =
    (best.distance <= 60 && best.score >= 0.15) ||
    (best.distance <= 150 && best.score >= 0.35) ||
    (best.distance <= 300 && best.score >= 0.65);
  const runnerUp = nearby[1];
  const clearlyBest = !runnerUp || best.score > runnerUp.score || best.distance + 40 < runnerUp.distance;
  if (!acceptable || !clearlyBest) {
    ambiguous++;
    continue;
  }
  org.url = best.feature.url;
  org.websiteSource = "OpenStreetMap";
  matched++;
}

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
  `// Public-library website URLs marked websiteSource: OpenStreetMap were matched by name and location.\n` +
  `// See scripts/build_library_expansion.mjs and scripts/enrich_library_websites.mjs.\n` +
  `window.ORGANIZATIONS = (window.ORGANIZATIONS || []).concat([\n${lines.join("\n")}\n]);\n`;

fs.writeFileSync(dataPath, output, "utf8");
console.error(`Added ${matched} public-library websites from ${uniqueFeatures.length} unique OSM features.`);
console.error(`Left ${ambiguous} nearby but ambiguous candidates unchanged.`);
