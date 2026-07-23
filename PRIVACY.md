# Privacy

Cultural Heritage Resilience is a static browser application. It has no application
server, user accounts, analytics, advertising, or tracking cookies. Hosting providers
may retain ordinary access logs under their own policies.

## Data the browser contacts

The page requests public hazard feeds, OpenFreeMap/OpenStreetMap basemap resources, and
optional RainViewer radar tiles. Those services receive normal web-request information
such as the visitor's IP address and browser headers. See `DATA_SOURCES.md` for the
services.

## Private organization overlays

An uploaded CSV or TSV is parsed in the browser and stored in that browser's local
storage so it can be restored on the same device. It is displayed, matched against
hazards, and included in local exports. The application does not upload the file to its
host. Imports are limited to 5 MB and 10,000 data rows. The list remains active in that
browser until the user chooses **Remove my list** or clears the site's browser data.

The experimental assistant cannot see private overlay records by default. A user must
enable the private-list option in Assistant settings for the current page session. If
enabled, relevant private records may be included in requests sent to the selected AI
provider. Consent resets when the page is reloaded or closed.

## Experimental assistant

The assistant is optional and off until a user configures it. Requests go directly from
the browser to the provider or local endpoint the user selects. Provider, model, and
base-URL preferences are stored locally. API keys are held only in page memory and are
forgotten on reload, close, or when the user selects **Forget key**. Do not use a primary
or unrestricted key; use a restricted, low-spend key and review the provider's privacy
and retention terms. Assistant messages, request context, response size, and request time
are bounded to reduce accidental data exposure and runaway resource use.

## Browser storage

The app uses local storage for theme and view preferences, recent impact trend history,
the optional organization overlay, and non-secret assistant preferences. Clearing site
data removes these values.
