const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "deployment", "firebase.json");
const packager = import(pathToFileURL(path.join(root, "scripts", "prepare_firebase.mjs")).href);
const expectedPublicFiles = [
  "index.html", "privacy.html", "styles.css", "version.json",
  "data/libraries-expanded.js", "data/official-library-websites.json", "data/organizations.js",
  "js/app.js", "js/chat.js", "js/feeds.js", "js/security.js",
  "vendor/maplibre-gl/LICENSE.txt", "vendor/maplibre-gl/manifest.json",
  "vendor/maplibre-gl/maplibre-gl.css", "vendor/maplibre-gl/maplibre-gl.js"
];

function temporaryDirectory(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, "crisis-firebase-test-"));
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), parent, "cleanup must stay in the temporary parent");
    assert.ok(path.basename(resolved).startsWith("crisis-firebase-test-"));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

function writeFixture(root, name, contents = "fixture\n") {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function seedSource(source, publicFiles) {
  for (const file of publicFiles) writeFixture(source, file);
  writeFixture(source, "deployment/firebase.json", fs.readFileSync(configPath));
}

function listFiles(directory, prefix = "") {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix + entry.name;
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), `${name}/`) : [name];
  }).sort();
}

test("Firebase configuration preserves security and freshness without clearing visitor caches", () => {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(config.hosting.public, "public");
  assert.deepEqual(config.hosting.ignore, ["firebase.json", "**/.*", "**/node_modules/**"]);
  assert.deepEqual(config.hosting.headers.map((entry) => entry.source), ["**", "/", "/index.html", "/version.json"]);
  const headersFor = (source) => Object.fromEntries(config.hosting.headers.find((entry) => entry.source === source).headers.map(({ key, value }) => [key, value]));
  assert.deepEqual(headersFor("**"), {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tiles.openfreemap.org https://tilecache.rainviewer.com https://*.tilecache.rainviewer.com; font-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Strict-Transport-Security": "max-age=31536000"
  });
  for (const source of ["/", "/index.html", "/version.json"]) {
    assert.deepEqual(headersFor(source), {
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      Pragma: "no-cache",
      Expires: "0"
    });
  }
  assert.ok(config.hosting.headers.every((entry) => entry.headers.every(({ key }) => key.toLowerCase() !== "clear-site-data")));
});

test("Firebase package contains exactly 15 unchanged runtime files and its configuration", async (t) => {
  const { prepareFirebase, PUBLIC_FILES } = await packager;
  const output = path.join(temporaryDirectory(t), "new-parent", "release");
  const result = prepareFirebase(output);
  assert.equal(result.outputDirectory, output);
  assert.equal(result.publicFileCount, 15);
  assert.deepEqual(PUBLIC_FILES, expectedPublicFiles);
  assert.equal(PUBLIC_FILES.length, 15);
  assert.equal(new Set(PUBLIC_FILES).size, 15);
  assert.deepEqual(listFiles(output), ["firebase.json", ...PUBLIC_FILES.map((file) => `public/${file}`)].sort());
  for (const file of PUBLIC_FILES) {
    assert.deepEqual(fs.readFileSync(path.join(output, "public", file)), fs.readFileSync(path.join(root, file)), file);
  }
  assert.deepEqual(fs.readFileSync(path.join(output, "firebase.json")), fs.readFileSync(configPath));
  assert.ok(!fs.existsSync(path.join(output, "public", "firebase.json")));
});

test("Firebase allowlist excludes repository, private, generated, and cache files", async (t) => {
  const { prepareFirebase, PUBLIC_FILES } = await packager;
  const directory = temporaryDirectory(t);
  const source = path.join(directory, "source");
  seedSource(source, PUBLIC_FILES);
  const excluded = [
    ".env", ".firebaserc", ".git/config", "README.md", "MOBILE-READINESS.md",
    "data/private-roster.csv", "scripts/audit_match_accuracy.mjs",
    "scripts/__pycache__/serve_local.cpython-314.pyc", "tests/example.test.cjs",
    "outputs/old-package/index.html", "node_modules/example/index.js"
  ];
  for (const file of excluded) writeFixture(source, file);
  const output = path.join(directory, "release");
  prepareFirebase(output, source);
  assert.deepEqual(listFiles(output), ["firebase.json", ...PUBLIC_FILES.map((file) => `public/${file}`)].sort());
});

test("Firebase preparation refuses existing directories without changing their files", async (t) => {
  const { prepareFirebase } = await packager;
  const output = path.join(temporaryDirectory(t), "release");
  writeFixture(output, "keep.txt", "keep this content");
  assert.throws(() => prepareFirebase(output), /Refusing to overwrite existing destination/);
  assert.deepEqual(listFiles(output), ["keep.txt"]);
  assert.equal(fs.readFileSync(path.join(output, "keep.txt"), "utf8"), "keep this content");
});

test("Firebase preparation refuses an existing file without changing it", async (t) => {
  const { prepareFirebase } = await packager;
  const directory = temporaryDirectory(t);
  writeFixture(directory, "release", "keep this file");
  const output = path.join(directory, "release");
  assert.throws(() => prepareFirebase(output), /Refusing to overwrite existing destination/);
  assert.equal(fs.readFileSync(output, "utf8"), "keep this file");
});

test("Firebase source preflight fails before creating output parents when an asset is missing", async (t) => {
  const { prepareFirebase, PUBLIC_FILES } = await packager;
  const directory = temporaryDirectory(t);
  const source = path.join(directory, "source");
  seedSource(source, PUBLIC_FILES.slice(0, -1));
  const parent = path.join(directory, "not-created");
  assert.throws(() => prepareFirebase(path.join(parent, "release"), source), { code: "ENOENT" });
  assert.ok(!fs.existsSync(parent));
});

test("Firebase source preflight rejects a Hosting public directory outside the allowlisted payload", async (t) => {
  const { prepareFirebase, PUBLIC_FILES } = await packager;
  const directory = temporaryDirectory(t);
  const source = path.join(directory, "source");
  seedSource(source, PUBLIC_FILES);
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.hosting.public = ".";
  writeFixture(source, "deployment/firebase.json", JSON.stringify(config));
  const output = path.join(directory, "release");
  assert.throws(() => prepareFirebase(output, source), /public directory must be exactly "public"/);
  assert.ok(!fs.existsSync(output));
});

test("Firebase source preflight rejects directories in place of runtime files", async (t) => {
  const { prepareFirebase, PUBLIC_FILES } = await packager;
  const directory = temporaryDirectory(t);
  const source = path.join(directory, "source");
  seedSource(source, PUBLIC_FILES.filter((file) => file !== "index.html"));
  fs.mkdirSync(path.join(source, "index.html"));
  const output = path.join(directory, "release");
  assert.throws(() => prepareFirebase(output, source), /Source is not a regular file: index\.html/);
  assert.ok(!fs.existsSync(output));
});

test("Firebase source preflight rejects a directory link escaping the repository", async (t) => {
  const { prepareFirebase, PUBLIC_FILES } = await packager;
  const directory = temporaryDirectory(t);
  const source = path.join(directory, "source");
  seedSource(source, PUBLIC_FILES.filter((file) => !file.startsWith("data/")));
  const outside = path.join(directory, "outside-data");
  for (const file of PUBLIC_FILES.filter((file) => file.startsWith("data/"))) {
    writeFixture(outside, path.basename(file));
  }
  fs.symlinkSync(outside, path.join(source, "data"), process.platform === "win32" ? "junction" : "dir");
  const output = path.join(directory, "release");
  assert.throws(() => prepareFirebase(output, source), /Source escapes repository: data\//);
  assert.ok(!fs.existsSync(output));
});
