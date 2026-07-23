# Security

This project is a beta situational-awareness tool, not an emergency alerting system.
Use a current, supported browser and always follow authoritative emergency guidance.

## Reporting a vulnerability

Do not post vulnerability details in a public issue. Use the repository's
[private vulnerability reporting form](https://github.com/FreshPremise/Cultural-Heritage-Resilience-Crisis-Map/security/advisories/new)
so the project owner can review the report before any public disclosure. If that form is
temporarily unavailable, contact the project owner privately through the
[FreshPremise GitHub profile](https://github.com/FreshPremise).

Never include API keys, private organization lists, or personal information in a report.

## Security boundaries

- The site is static and contains no authentication or application database.
- Uploaded organization lists remain in browser storage unless the user explicitly
  permits the experimental assistant to share relevant records with an AI provider.
- Assistant API keys are kept in memory, not persistent browser storage.
- URLs imported from data or spreadsheets are restricted to HTTP(S); remote assistant
  endpoints require HTTPS, with HTTP allowed only for loopback development servers.
  Assistant endpoint URLs cannot contain credentials, query strings, or fragments.
- Live-feed and assistant responses have byte limits and timeouts; geometries and feature
  counts are bounded before impact matching.
- The Windows launcher uses `scripts/serve_local.py`, which binds to loopback, exposes only
  runtime assets, disables directory listings and mutating methods, and supplies security
  headers. Do not replace it with a network-exposed generic file server.
- Vendored MapLibre files have pinned SHA-256 values checked in CI, and repository files
  are scanned for common private-key and provider-token formats.

These measures reduce risk but do not make a browser-entered API key equivalent to a
server-held secret. Browser-key use remains explicitly experimental.
