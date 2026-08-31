const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const vendor = fs.readFileSync(path.join(root, "vendor", "maplibre-gl", "maplibre-gl.js"), "utf8");

test("map construction keeps bundled container resize tracking enabled", () => {
  const construction = app.match(/map\s*=\s*new maplibregl\.Map\(\{[\s\S]*?\n\s*\}\);/);
  assert.ok(construction, "map constructor call is missing");
  let options;
  vm.runInNewContext(construction[0], {
    maplibregl: { Map: class { constructor(value) { options = value; } } },
    DEFAULT_VIEW: { center: [0, 0], zoom: 4 },
    currentTheme: () => "light",
    basemapStyle: () => "test-style",
  });

  assert.equal(Object.hasOwn(options, "trackResize") ? options.trackResize : true, true,
    "map construction must not disable built-in resize tracking");
  assert.ok(/\btrackResize\s*:\s*(?:true|!0)\s*[,}]/.test(vendor),
    "bundled MapLibre must enable resize tracking by default");
  assert.ok(/new ResizeObserver\s*\(/.test(vendor),
    "bundled MapLibre must observe container size changes");
  assert.ok(/_resizeObserver\.observe\(this\._container\)/.test(vendor),
    "resize observation must target the map container");
});

test("the app does not duplicate MapLibre tracking with a window resize handler", () => {
  const extraHandlers = app.match(/window\s*\.\s*(?:addEventListener\(\s*["']resize["']|onresize\s*=)/g) || [];
  assert.deepEqual(extraHandlers, []);
});
