// Prepare a local, allowlisted Hosting package. This script never deploys it.
import { constants, copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PUBLIC_FILES = Object.freeze([
  "index.html",
  "privacy.html",
  "styles.css",
  "version.json",
  "data/libraries-expanded.js",
  "data/official-library-websites.json",
  "data/organizations.js",
  "js/app.js",
  "js/chat.js",
  "js/feeds.js",
  "js/security.js",
  "vendor/maplibre-gl/LICENSE.txt",
  "vendor/maplibre-gl/manifest.json",
  "vendor/maplibre-gl/maplibre-gl.css",
  "vendor/maplibre-gl/maplibre-gl.js"
]);

export function prepareFirebase(outputDirectory, sourceRoot = root) {
  if (typeof outputDirectory !== "string" || !outputDirectory.trim()) {
    throw new Error("Provide a new output directory.");
  }
  const output = resolve(outputDirectory);
  try {
    lstatSync(output);
    throw new Error(`Refusing to overwrite existing destination: ${output}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Validate every source before creating any output, including its parents.
  const source = realpathSync(sourceRoot);
  const files = [
    ["deployment/firebase.json", "firebase.json"],
    ...PUBLIC_FILES.map((file) => [file, `public/${file}`])
  ].map(([from, to]) => {
    const input = join(source, from);
    if (!lstatSync(input).isFile()) throw new Error(`Source is not a regular file: ${from}`);
    const inside = relative(source, realpathSync(input));
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new Error(`Source escapes repository: ${from}`);
    }
    return { input, target: join(output, to) };
  });
  const config = JSON.parse(readFileSync(files[0].input, "utf8"));
  if (config.hosting?.public !== "public") {
    throw new Error('Hosting public directory must be exactly "public".');
  }

  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output); // No recursive option: an existing destination must fail.
  for (const { input, target } of files) {
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(input, target, constants.COPYFILE_EXCL);
  }
  return { outputDirectory: output, publicFileCount: PUBLIC_FILES.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node scripts/prepare_firebase.mjs <new-output-directory>");
    const result = prepareFirebase(process.argv[2]);
    console.log(`Prepared ${result.publicFileCount} public files and firebase.json in ${result.outputDirectory}`);
    console.log("No project selection, credentials, or deployment were performed.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
