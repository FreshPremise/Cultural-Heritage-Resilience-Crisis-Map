// One-time build tool. Reverse-geocodes every US organization to its county FIPS code via
// the free FCC Census Area API, writing fips_map.json (name -> "SSCCC"). inject_fips.mjs
// then merges those codes into data/organizations.js. County FIPS is what lets the app
// match the ~90% of US weather alerts that carry only county codes, not polygons.
// Run from the project root: `node scripts/geocode_fips.mjs` then `node scripts/inject_fips.mjs`.
// The paths below assume the working directory is the project root.
import fs from 'fs';
const src = fs.readFileSync('./data/organizations.js', 'utf8');
const window = {};
new Function('window', src)(window);
const orgs = window.ORGANIZATIONS;
const us = orgs.filter(o => o.country === 'US');
console.error(`Geocoding ${us.length} US orgs...`);

async function fips(o) {
  const url = `https://geo.fcc.gov/api/census/area?lat=${o.lat}&lon=${o.lon}&format=json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      const res = (d.results || [])[0];
      return res && res.county_fips ? res.county_fips : null;
    } catch (e) {
      if (attempt === 2) { console.error('FAIL', o.name, e.message); return null; }
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

const map = {};
const CONC = 12;
let i = 0, done = 0;
async function worker() {
  while (i < us.length) {
    const o = us[i++];
    map[o.name] = await fips(o);
    if (++done % 50 === 0) console.error(`  ${done}/${us.length}`);
  }
}
await Promise.all(Array.from({length: CONC}, worker));
const hit = Object.values(map).filter(Boolean).length;
console.error(`Done: ${hit}/${us.length} resolved`);
fs.writeFileSync('fips_map.json', JSON.stringify(map, null, 0));
console.error('wrote fips_map.json');
