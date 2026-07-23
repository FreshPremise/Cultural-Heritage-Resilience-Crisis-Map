// One-time build tool for data/libraries-expanded.js.
//
// Sources:
//   1. IMLS Public Libraries Survey FY 2023 administrative-entity and outlet CSVs.
//   2. NCES IPEDS 2023 Academic Libraries and Directory Information CSVs.
//
// Run from the project root:
//   node scripts/build_library_expansion.mjs <PLS AE.csv> <PLS Outlet.csv> <HD2023.csv> <AL2023.csv>
//   node scripts/enrich_library_websites.mjs queries <query-directory>
//   node scripts/enrich_library_websites.mjs apply <response-directory>
//
// The IMLS source has no website field. Run the separate, conservative enrichment step
// after rebuilding if public-library website URLs should be restored.
//
// The selection is deliberately broad rather than purely a "largest institutions" list:
// each state and DC receives up to five places first, then remaining places are filled by
// service population (public) or total library expenditure (academic). Existing curated
// organizations with the same normalized name, city, and state are not duplicated.

import fs from "fs";

const [, , plsAePath, plsOutletPath, hdPath, alPath] = process.argv;
if (!plsAePath || !plsOutletPath || !hdPath || !alPath) {
  console.error("Usage: node scripts/build_library_expansion.mjs <PLS AE.csv> <PLS Outlet.csv> <HD2023.csv> <AL2023.csv>");
  process.exit(1);
}

function parseCsv(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(value => value !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map(value => value.trim());
  return rows.map(values => Object.fromEntries(header.map((key, i) => [key, values[i] == null ? "" : values[i].trim()])));
}

function readCsv(file) {
  return parseCsv(fs.readFileSync(file, "utf8"));
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function orgKey(org) {
  return [textKey(org.name), textKey(org.city), textKey(org.region)].join("|");
}

function validCoordinate(lat, lon) {
  return lat != null && lon != null && lat >= 18 && lat <= 72 && lon >= -170 && lon <= -60;
}

function countyFips(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits || Number(digits) < 1) return null;
  return digits.padStart(5, "0").slice(0, 5);
}

function fipsFromTract(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : null;
}

function webUrl(value) {
  const url = String(value || "").trim();
  if (!url || url === "-2") return null;
  return /^https?:\/\//i.test(url) ? url : "https://" + url;
}

function titleCase(value) {
  const original = String(value || "").trim();
  if (!original || original !== original.toUpperCase()) return original;
  const minor = new Set(["and", "at", "for", "in", "of", "on", "the", "to"]);
  const fixed = new Map([["dc", "DC"], ["ny", "NY"], ["us", "US"], ["ii", "II"], ["iii", "III"], ["iv", "IV"]]);
  return original.toLowerCase().split(/(\s+|-)/).map((part, index, parts) => {
    if (/^\s+$/.test(part) || part === "-") return part;
    if (fixed.has(part)) return fixed.get(part);
    if (index > 0 && index < parts.length - 1 && minor.has(part)) return part;
    return part.replace(/(^|['’])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
  }).join("");
}

const states = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
  "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

const baseWindow = {};
new Function("window", fs.readFileSync("data/organizations.js", "utf8"))(baseWindow);
const existingKeys = new Set((baseWindow.ORGANIZATIONS || []).map(orgKey));

function uniqueCandidates(candidates) {
  const seen = new Set(existingKeys);
  return candidates.filter(candidate => {
    const key = orgKey(candidate.org);
    if (!candidate.org.name || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectBalanced(candidates, target, minimumPerState) {
  const byState = new Map();
  candidates.forEach(candidate => {
    const list = byState.get(candidate.org.region) || [];
    list.push(candidate);
    byState.set(candidate.org.region, list);
  });
  byState.forEach(list => list.sort((a, b) => b.score - a.score || a.org.name.localeCompare(b.org.name)));

  const selected = [];
  const used = new Set();
  [...states].sort().forEach(state => {
    (byState.get(state) || []).slice(0, minimumPerState).forEach(candidate => {
      selected.push(candidate);
      used.add(candidate.sourceId);
    });
  });
  candidates
    .slice()
    .sort((a, b) => b.score - a.score || a.org.name.localeCompare(b.org.name))
    .forEach(candidate => {
      if (selected.length < target && !used.has(candidate.sourceId)) {
        selected.push(candidate);
        used.add(candidate.sourceId);
      }
    });
  if (selected.length !== target) throw new Error(`Expected ${target} records, selected ${selected.length}`);
  return selected.map(candidate => candidate.org);
}

const plsAe = readCsv(plsAePath);
const populationBySystem = new Map(plsAe.map(row => [row.FSCSKEY, Math.max(0, number(row.POPU_LSA) || 0)]));
const publicCandidates = uniqueCandidates(readCsv(plsOutletPath)
  .filter(row => row.C_OUT_TY === "CE" && states.has(row.STABR))
  .map(row => {
    const lat = number(row.LATITUDE), lon = number(row.LONGITUD);
    const fips = fipsFromTract(row.CENTRACT);
    return {
      sourceId: "pls:" + row.LIBID,
      score: populationBySystem.get(row.FSCSKEY) || 0,
      org: {
        name: titleCase(row.LIBNAME),
        type: "library",
        libraryType: "public",
        city: titleCase(row.CITY),
        region: row.STABR,
        country: "US",
        lat,
        lon,
        fips,
        url: null,
        source: "IMLS PLS FY2023",
        sourceId: row.LIBID,
      },
    };
  })
  .filter(candidate => validCoordinate(candidate.org.lat, candidate.org.lon) && candidate.org.fips));

const hdById = new Map(readCsv(hdPath).map(row => [row.UNITID, row]));
const academicCandidates = uniqueCandidates(readCsv(alPath)
  .map(row => ({ al: row, hd: hdById.get(row.UNITID) }))
  .filter(item => item.hd && item.hd.DEGGRANT === "1" && states.has(item.hd.STABBR) && (number(item.al.LEXPTOT) || 0) > 0)
  .map(item => {
    const lat = number(item.hd.LATITUDE), lon = number(item.hd.LONGITUD);
    const fips = countyFips(item.hd.COUNTYCD);
    return {
      sourceId: "ipeds:" + item.hd.UNITID,
      score: number(item.al.LEXPTOT) || 0,
      org: {
        name: item.hd.INSTNM + " — Academic Library",
        type: "library",
        libraryType: "academic",
        city: item.hd.CITY,
        region: item.hd.STABBR,
        country: "US",
        lat,
        lon,
        fips,
        url: webUrl(item.hd.WEBADDR),
        source: "NCES IPEDS Academic Libraries FY2023",
        sourceId: item.hd.UNITID,
      },
    };
  })
  .filter(candidate => validCoordinate(candidate.org.lat, candidate.org.lon) && candidate.org.fips));

const publicLibraries = selectBalanced(publicCandidates, 1000, 5);
const academicLibraries = selectBalanced(academicCandidates, 1000, 5);
const libraries = publicLibraries.concat(academicLibraries).sort((a, b) =>
  a.libraryType.localeCompare(b.libraryType) || a.region.localeCompare(b.region) || a.name.localeCompare(b.name));

function jsValue(value) {
  return value == null ? "null" : JSON.stringify(value);
}

const lines = libraries.map(org =>
  "  { name: " + jsValue(org.name) +
  ", type: \"library\", libraryType: " + jsValue(org.libraryType) +
  ", city: " + jsValue(org.city) +
  ", region: " + jsValue(org.region) +
  ", country: \"US\", lat: " + org.lat +
  ", lon: " + org.lon +
  ", fips: " + jsValue(org.fips) +
  ", url: " + jsValue(org.url) +
  ", source: " + jsValue(org.source) +
  ", sourceId: " + jsValue(org.sourceId) + " },");

const output = `// Permanent library expansion generated from official public-use data.\n` +
  `// 1,000 public libraries: IMLS Public Libraries Survey FY 2023, central outlets.\n` +
  `// 1,000 academic libraries: NCES IPEDS Academic Libraries FY 2023 joined to HD2023.\n` +
  `// See scripts/build_library_expansion.mjs for selection and deduplication rules.\n` +
  `window.ORGANIZATIONS = (window.ORGANIZATIONS || []).concat([\n${lines.join("\n")}\n]);\n`;

fs.writeFileSync("data/libraries-expanded.js", output, "utf8");
console.error(`Wrote data/libraries-expanded.js: ${publicLibraries.length} public + ${academicLibraries.length} academic libraries`);
console.error(`Eligible candidates after validation/deduplication: ${publicCandidates.length} public, ${academicCandidates.length} academic`);
