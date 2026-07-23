const test = require("node:test");
const assert = require("node:assert/strict");
const security = require("../js/security.js");

test("safeHttpUrl accepts HTTPS and rejects active or malformed schemes", () => {
  assert.equal(security.safeHttpUrl("https://example.org/a"), "https://example.org/a");
  assert.equal(security.safeHttpUrl("javascript:alert(1)"), null);
  assert.equal(security.safeHttpUrl("data:text/html,test"), null);
  assert.equal(security.safeHttpUrl("not a url"), null);
});

test("remote HTTP is rejected for APIs while local HTTP can be explicitly allowed", () => {
  assert.equal(security.safeHttpUrl("http://example.org/v1", { allowLocalHttp: true }), null);
  assert.equal(security.safeHttpUrl("http://localhost:11434/v1", { allowLocalHttp: true }), "http://localhost:11434/v1");
  assert.equal(security.safeHttpUrl("http://127.0.0.1:1234/v1", { allowLocalHttp: true }), "http://127.0.0.1:1234/v1");
  assert.equal(security.safeHttpUrl("http://[::1]:1234/v1", { allowLocalHttp: true }), "http://[::1]:1234/v1");
});

test("assistant base URLs reject embedded credentials and query-string secrets", () => {
  const options = { allowLocalHttp: true, rejectCredentials: true, rejectQuery: true };
  assert.equal(security.safeHttpUrl("https://user:secret@example.org/v1", options), null);
  assert.equal(security.safeHttpUrl("https://example.org/v1?api_key=secret", options), null);
  assert.equal(security.safeHttpUrl("https://example.org/v1#secret", options), null);
  assert.equal(security.safeHttpUrl("https://example.org/v1", options), "https://example.org/v1");
});

test("CSV cells with spreadsheet formulas are neutralized", () => {
  for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tformula"]) {
    assert.equal(security.neutralizeSpreadsheetCell(value), "'" + value);
  }
  assert.equal(security.neutralizeSpreadsheetCell("Library"), "Library");
});

test("private organizations are excluded unless explicitly included", () => {
  const rows = [{ id: "public" }, { id: "private", selected: true }];
  assert.deepEqual(security.filterAssistantOrganizations(rows, false).map((r) => r.id), ["public"]);
  assert.deepEqual(security.filterAssistantOrganizations(rows, true).map((r) => r.id), ["public", "private"]);
});

test("private organization storage is schema-validated instead of trusted", () => {
  assert.deepEqual(security.parsePrivateOrganizations("{}"), []);
  assert.deepEqual(security.parsePrivateOrganizations("not json"), []);
  const rows = security.parsePrivateOrganizations(JSON.stringify([
    { name: "Example", type: "Museum", country: "Canada", lat: 45, lon: -75, url: "https://user:secret@example.org/" },
    { name: "Bad country", country: "ZZ", lat: 40, lon: -80 },
    { name: "Bad coordinates", country: "US", lat: 999, lon: -80 },
  ]));
  assert.deepEqual(rows, [{
    name: "Example", type: "museum", city: "", region: "", country: "CA",
    lat: 45, lon: -75, url: "", fips: null,
  }]);
});
