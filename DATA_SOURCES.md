# Data sources and methodology

## Organizations

| Dataset | Use in this beta | Source |
|---|---|---|
| Curated North American demonstration set | Libraries, museums, and archives in the US, Canada, and Mexico | Project-maintained research; coordinates may be institution- or city-level |
| IMLS Public Libraries Survey FY2023 | Reproducible sample of 1,000 US central public-library outlets | [IMLS Public Libraries Survey](https://www.imls.gov/research-evaluation/surveys/public-libraries-survey-pls) |
| NCES IPEDS FY2023 | Reproducible sample of 1,000 US academic-library institutions, joined to main-campus coordinates | [NCES IPEDS data files](https://nces.ed.gov/ipeds/datacenter/DataFiles.aspx?rtid=7&surveyNumber=-1&year=2023) |
| OpenStreetMap | Website URLs for imported public libraries when a nearby library feature has a compatible name | [OpenStreetMap](https://www.openstreetmap.org/copyright) |
| Official website search | 401 public-library URLs accepted only when a targeted search returned a clear official library or government page | Project-maintained review in `data/official-library-websites.json` |

The generated records identify their source and source ID. Selection, normalization,
deduplication, and county-FIPS logic are documented in
`scripts/build_library_expansion.mjs`. Coordinates support regional situational
awareness; they are not suitable for navigation or dispatch.

The IMLS FY2023 public-use files do not include organization website URLs. The optional
`scripts/enrich_library_websites.mjs` step supplements those records from OpenStreetMap,
using conservative distance-and-name matching and leaving ambiguous records blank. In
the current 1,000-record public-library sample, 183 websites were verified this way and
an additional 401 were verified through an official-site search review. In total, 584
public-library records now have websites and 416 remain blank. Each accepted URL carries
its source in `websiteSource`. OpenStreetMap data is © OpenStreetMap contributors and
available under the ODbL.

## Live hazards and map services

| Service | Selection used by this project | Match input |
|---|---|---|
| [National Weather Service API](https://www.weather.gov/documentation/services-web-api) | Actual US alerts with provider severity Moderate, Severe, or Extreme. Title filters exclude test, small craft, marine, gale, hazardous seas, rip current, surf, beach, lakeshore, and low-water alerts. | A published polygon when available; otherwise official warned-zone outlines, with county FIPS as a labeled temporary approximation. |
| [Environment and Climate Change Canada](https://api.weather.gc.ca) | Active watches and warnings plus alerts with an orange or red published risk colour. Ended and cancelled alerts are excluded. | Published polygon when usable. |
| [USGS earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | Earthquakes of magnitude 3.0 or greater from the weekly feed, limited to the project's North America bounds. | Epicentre with a project-estimated radius. |
| [NIFC WFIGS](https://data-nifc.opendata.arcgis.com) | Current US wildfire incidents in the wildfire category with a reported size of at least 100 acres. | Incident point with a project-estimated radius based on reported size. |
| [Natural Resources Canada CWFIS](https://cwfis.cfs.nrcan.gc.ca) | Satellite-derived Canadian FireM3 perimeter estimates larger than 500 hectares. These national monitoring polygons are not operational incident perimeters and do not consistently name individual fires. | Provider-published perimeter estimate. |
| [NASA EONET](https://eonet.gsfc.nasa.gov) | Up to 300 open wildfire, severe-storm, volcano, and flood events within the project bounds. US fires and floods and Canadian fires are excluded to reduce overlap with WFIGS, NWS, and CWFIS. | Latest event position with a project-estimated radius. |
| [RainViewer](https://www.rainviewer.com/api.html) | Optional latest precipitation-radar tiles. A frame more than 30 minutes old is labeled stale. | Display only; radar does not determine organization matches. |
| [OpenFreeMap](https://openfreemap.org/) / OpenStreetMap | Basemap tiles and labels. | Display only. |

Feed data is fetched in the browser approximately every five minutes. A failed refresh
retains the last successful response for that source for no more than one hour and marks
it stale. Expired alerts are removed from retained responses. If one or more sources are
unavailable, the interface identifies the result as partial because counts, exports,
briefs, and trends may otherwise be incomplete. A partial refresh is not a complete trend
observation. The trend uses only the public demonstration dataset, regardless of the
current filters or a private uploaded list, and the current sample is revised when an NWS
county approximation is replaced by an official warned-zone outline.

Paginated sources are loaded before impact matching, subject to a 5,000-feature boundary.
JSON responses are subject to a 64 MB per-response boundary. EONET separately requests no
more than 300 open events. These limits avoid silently preferring a provider's first page
while bounding browser work; they also mean that provider results can be incomplete if a
limit is reached.

### Match methods

Each reportable organization-event match uses one of four methods. Events without usable
match geometry retain an internal `unknown` method and cannot establish an organization
match:

- **Published polygon:** point-in-polygon against a usable boundary supplied with the
  event. A provider-published boundary may itself be an estimate, as with CWFIS FireM3.
- **Official zone:** point-in-polygon against the NWS warned-zone outlines referenced by
  an alert and fetched from `api.weather.gov`. To prevent a private uploaded list from
  influencing outbound requests, the app schedules these fetches only for alerts that
  match an organization in the public demonstration dataset. A private-only county match
  may therefore remain a labeled county approximation.
- **County approximation:** a temporary FIPS match while an NWS warned-zone outline is
  unavailable. The interface labels this result as approximate.
- **Estimated radius:** a project-created screening circle around a point event. It is not
  an official impact, evacuation, or damage boundary.

Estimated radii are calculated as follows:

| Source | Estimated screening radius |
|---|---|
| USGS | 30 km for M3.0-4.49; 70 km for M4.5-5.49; 150 km for M5.5-6.49; 300 km for M6.5+ |
| WFIGS | The radius of a circle with the reported incident area, plus an 8 km buffer, with an 8 km minimum |
| NASA EONET | 300 km for severe storms; 50 km for volcanoes and floods; 25 km for wildfires |

### Project screening priority

The application preserves provider severity when available and separately normalizes
events to a project screening priority of Minor, Moderate, Severe, or Extreme. This label
supports cross-source sorting; it is not an official provider rating or an assessment of
damage to a specific organization.

| Source | Project screening-priority rule |
|---|---|
| NWS | Provider Extreme, Severe, and Moderate map to the corresponding project priority; Minor and Unknown alerts are not included. |
| Environment Canada | Red risk is Extreme; warnings and orange risk are Severe; watches are Moderate. Lower-priority alerts are not included. |
| USGS | M6.5+ Extreme; M5.5-6.49 Severe; M4.5-5.49 Moderate; M3.0-4.49 Minor. |
| WFIGS | 50,000+ acres Extreme; 10,000-49,999 Severe; 1,000-9,999 Moderate; 100-999 Minor. |
| CWFIS | 20,000+ hectares Extreme; 5,000-19,999 Severe; more than 500 and less than 5,000 Moderate. |
| NASA EONET | Severe storms and volcanoes are Severe; wildfires and floods are Moderate. |

### Time fields

Event time labels distinguish the provider's event meaning from retrieval time. NWS onset
or effective time, Environment Canada validity time, USGS event time, WFIGS discovery
time, and CWFIS first date describe when an event started or was first reported. The
latest EONET geometry date and CWFIS last date are observation times. **Feeds checked** is
the browser's retrieval time and does not imply that each
provider changed its record then.

Source providers retain their own rights, terms, availability, and accuracy. The project
does not warrant completeness or timeliness.

## License boundaries for data

The project's MIT license covers project-authored software and documentation. It does
not replace the terms attached to third-party data. In particular:

- `data/libraries-expanded.js` combines IMLS and NCES public-use records with normalized
  project fields. Records identify their upstream source and source ID.
- Website values marked `websiteSource: "OpenStreetMap"` are derived from OpenStreetMap
  and remain subject to the Open Database License (ODbL). Anyone redistributing or
  adapting the compiled database should review the ODbL share-alike requirements.
- Website values marked `websiteSource: "Official website search"` are factual links
  selected through a project-maintained review; the linked organizations retain rights
  in their own sites and content.
- Live hazard responses, basemap resources, and optional radar tiles are fetched from
  their providers and are not redistributed under the project's MIT license.

See `LICENSE` and `THIRD_PARTY_NOTICES.md` for the corresponding software and service
notices.
