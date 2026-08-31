const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8").replace(/\r\n/g, "\n");
const chat = fs.readFileSync(path.join(root, "js", "chat.js"), "utf8").replace(/\r\n/g, "\n");

function objectSource(name) {
  const match = app.match(new RegExp(`var ${name} = \\{[\\s\\S]*?\\n  \\};`));
  assert.ok(match, `missing ${name}`);
  return match[0];
}

function facadeMethodSource(name) {
  const match = app.match(new RegExp(`${name}: function \\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`));
  assert.ok(match, `missing window.HW.${name}`);
  return match[0];
}

function createHarness() {
  const catalogStart = chat.indexOf("var TOOLS = [");
  const catalogEnd = chat.indexOf("/* ---------------- system prompt", catalogStart);
  assert.ok(catalogStart >= 0 && catalogEnd > catalogStart, "missing tool catalog boundaries");
  const context = {
    window: {},
    state: { layerOn: {} },
    setLayerFilter(group, on) { context.state.layerOn[group] = !!on; },
    fetch() { throw new Error("Network requests are disabled in the tool harness"); },
  };
  // Evaluate only metadata, facade methods, and tool dispatch. Rendering is stubbed;
  // app startup, private records, and provider request code are never evaluated.
  vm.runInNewContext(
    `${objectSource("CAT_META")}\n${objectSource("LAYER_GROUPS")}\n` +
    `Object.keys(LAYER_GROUPS).forEach(function (group) { state.layerOn[group] = true; });\n` +
    `window.HW = { ${facadeMethodSource("setHazardLayers")}, ${facadeMethodSource("layerGroups")} };\n` +
    chat.slice(catalogStart, catalogEnd),
    context
  );
  return context;
}

function advertisedIds(description, pattern) {
  const match = description.match(pattern);
  assert.ok(match, "missing advertised identifier list");
  return match[1].split(",").map((id) => id.trim());
}

function providerDescriptions(context, name) {
  return [
    context.TOOL_BY_NAME[name].description,
    context.anthropicTools().find((tool) => tool.name === name).description,
    context.openaiTools().find((tool) => tool.function.name === name).function.description,
  ];
}

test("list_events advertises every actual hazard category including air for both providers", () => {
  const context = createHarness();
  const actual = Object.keys(context.CAT_META).sort();
  assert.ok(actual.includes("air"));
  for (const description of providerDescriptions(context, "list_events")) {
    assert.deepEqual(advertisedIds(description, /category \(([^)]+)\)/).sort(), actual);
  }
});

test("set_hazard_layers advertises every actual layer group including air for both providers", () => {
  const context = createHarness();
  const actual = Array.from(context.window.HW.layerGroups(), (group) => group.id).sort();
  assert.ok(actual.includes("air"));
  for (const description of providerDescriptions(context, "set_hazard_layers")) {
    assert.deepEqual(advertisedIds(description, /Valid ids: ([^.]+)\./).sort(), actual);
  }
});

test("set_hazard_layers dispatch can enable air alone and disable the other layers", () => {
  const context = createHarness();
  const result = context.execTool("set_hazard_layers", { layers: ["air"] });
  assert.deepEqual(Array.from(result.activeLayers), ["air"]);
  for (const group of Object.keys(context.LAYER_GROUPS)) {
    assert.equal(context.state.layerOn[group], group === "air", group);
  }
});

test("set_hazard_layers dispatch restores every layer from the advertised full list", () => {
  const context = createHarness();
  const cleared = context.execTool("set_hazard_layers", { layers: [] });
  assert.deepEqual(Array.from(cleared.activeLayers), []);
  const layers = advertisedIds(context.TOOL_BY_NAME.set_hazard_layers.description, /Valid ids: ([^.]+)\./);
  const result = context.execTool("set_hazard_layers", { layers });
  const actual = Object.keys(context.LAYER_GROUPS).sort();
  assert.deepEqual(Array.from(result.activeLayers).sort(), actual);
  for (const group of actual) assert.equal(context.state.layerOn[group], true, group);
});
