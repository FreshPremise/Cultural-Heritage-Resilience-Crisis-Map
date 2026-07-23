// One-time build tool. Reads fips_map.json (produced by geocode_fips.mjs) and inserts a
// `fips: "SSCCC"` field into each US organization line in data/organizations.js.
// Idempotent — skips lines that already have a fips. Run from the project root.
import fs from 'fs';
const fipsMap = JSON.parse(fs.readFileSync('fips_map.json', 'utf8'));
const lines = fs.readFileSync('./data/organizations.js', 'utf8').split('\n');
let injected = 0, missing = 0;
const out = lines.map(line => {
  if (!/country:\s*"US"/.test(line)) return line;
  if (/fips:/.test(line)) return line;
  const m = line.match(/name:\s*"([^"]*)"/);
  if (!m) return line;
  const code = fipsMap[m[1]];
  if (!code) { missing++; console.error('MISS', m[1]); return line; }
  injected++;
  return line.replace(/(\s*)url:/, `$1fips: "${code}", url:`);
});
fs.writeFileSync('./data/organizations.js', out.join('\n'));
console.error(`Injected: ${injected}, missing: ${missing}`);
