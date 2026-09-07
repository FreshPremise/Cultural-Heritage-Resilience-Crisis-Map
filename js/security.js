/* Cultural Heritage Resilience — shared trust-boundary helpers.
   Kept dependency-free so the same functions can be tested directly in Node. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HWSecurity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function safeHttpUrl(value, options) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw) return null;
    var parsed;
    try { parsed = new URL(raw); } catch (e) { return null; }
    options = options || {};
    if (options.rejectCredentials && (parsed.username || parsed.password)) return null;
    if (options.rejectQuery && (parsed.search || parsed.hash)) return null;
    if (parsed.protocol === "https:") return parsed.href;
    if (parsed.protocol !== "http:") return null;
    if (options.allowHttp) return parsed.href;
    var host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (options.allowLocalHttp && (host === "localhost" || host === "127.0.0.1" || host === "::1")) return parsed.href;
    return null;
  }

  // Credentials and private-data consent are capabilities for one exact network
  // recipient. Build that identity from the final provider endpoint, not from a
  // provider label, so authority cannot silently follow a recipient change.
  function assistantRecipient(kind, baseUrl) {
    var safe = safeHttpUrl(baseUrl, {
      allowLocalHttp: true,
      rejectCredentials: true,
      rejectQuery: true,
    });
    if (!safe) return null;
    var route = kind === "anthropic" ? "/v1/messages" : kind === "openai" ? "/chat/completions" : null;
    if (!route) return null;
    try { return new URL(safe.replace(/\/+$/, "") + route).href; }
    catch (e) { return null; }
  }

  function credentialForRecipient(secret, boundRecipient, currentRecipient) {
    return secret && boundRecipient && currentRecipient && boundRecipient === currentRecipient ? String(secret) : "";
  }

  function privateGrantAllows(grant, currentRecipient, currentGeneration) {
    return !!(
      grant &&
      grant.recipient &&
      grant.recipient === currentRecipient &&
      grant.generation === currentGeneration
    );
  }

  function neutralizeSpreadsheetCell(value) {
    var text = String(value == null ? "" : value);
    return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  }

  function filterAssistantOrganizations(organizations, includePrivate) {
    var list = Array.isArray(organizations) ? organizations : [];
    return includePrivate ? list.slice() : list.filter(function (org) { return !org.selected; });
  }

  function privateOrganizationRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var name = String(value.name == null ? "" : value.name).trim().slice(0, 500);
    var lat = Number(value.lat), lon = Number(value.lon);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < 5 || lat > 84 || lon < -172 || lon > -50) return null;

    var rawType = String(value.type == null ? "" : value.type).trim().toLowerCase();
    var type = /^lib/.test(rawType) ? "library" : /^(mus|gall)/.test(rawType) ? "museum" : /^(arch|rec|hist)/.test(rawType) ? "archive" : "library";
    var rawCountry = String(value.country == null ? "US" : value.country).trim().toUpperCase();
    var countryMap = { US: "US", USA: "US", "UNITED STATES": "US", CA: "CA", CANADA: "CA", MX: "MX", MEXICO: "MX" };
    var country = countryMap[rawCountry];
    if (!country) return null;
    var fips = String(value.fips == null ? "" : value.fips).trim().replace(/\D/g, "");
    if (fips.length === 4) fips = "0" + fips;

    return {
      name: name,
      type: type,
      city: String(value.city == null ? "" : value.city).trim().slice(0, 300),
      region: String(value.region == null ? "" : value.region).trim().slice(0, 100),
      country: country,
      lat: lat,
      lon: lon,
      url: safeHttpUrl(value.url, { allowHttp: true, rejectCredentials: true }) || "",
      fips: fips.length === 5 ? fips : null,
    };
  }

  function parsePrivateOrganizations(raw, maxRecords) {
    var parsed;
    try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return []; }
    if (!Array.isArray(parsed)) return [];
    var limit = Number.isFinite(maxRecords) && maxRecords > 0 ? Math.floor(maxRecords) : 10000;
    return parsed.slice(0, limit).map(privateOrganizationRecord).filter(Boolean);
  }

  return {
    safeHttpUrl: safeHttpUrl,
    assistantRecipient: assistantRecipient,
    credentialForRecipient: credentialForRecipient,
    privateGrantAllows: privateGrantAllows,
    neutralizeSpreadsheetCell: neutralizeSpreadsheetCell,
    filterAssistantOrganizations: filterAssistantOrganizations,
    privateOrganizationRecord: privateOrganizationRecord,
    parsePrivateOrganizations: parsePrivateOrganizations,
  };
});
