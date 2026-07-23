import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "vendor/maplibre-gl/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (manifest.name !== "maplibre-gl" || !/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
  throw new Error("Invalid vendored dependency manifest");
}

for (const [relative, expected] of Object.entries(manifest.files || {})) {
  const absolute = resolve(root, relative);
  if (!absolute.startsWith(root + sep) || !relative.replaceAll("\\", "/").startsWith("vendor/maplibre-gl/")) {
    throw new Error(`Unsafe manifest path: ${relative}`);
  }
  const actual = createHash("sha256").update(readFileSync(absolute)).digest("hex");
  if (actual !== expected) throw new Error(`Integrity check failed for ${relative}: expected ${expected}, got ${actual}`);
  console.log(`${relative}: sha256 ${actual}`);
}

console.log(`Vendored ${manifest.name} ${manifest.version} integrity check passed.`);
