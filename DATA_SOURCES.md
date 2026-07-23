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

| Service | Purpose |
|---|---|
| [National Weather Service API](https://www.weather.gov/documentation/services-web-api) | US alerts and county codes |
| [Environment and Climate Change Canada](https://api.weather.gc.ca) | Canadian weather alerts |
| [USGS earthquake feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php) | North American earthquakes |
| [NIFC WFIGS](https://data-nifc.opendata.arcgis.com) | US active wildfire incidents |
| [Natural Resources Canada CWFIS](https://cwfis.cfs.nrcan.gc.ca) | Canadian active wildfire perimeters |
| [NASA EONET](https://eonet.gsfc.nasa.gov) | Additional continent-wide natural events |
| [RainViewer](https://www.rainviewer.com/api.html) | Optional precipitation-radar tiles |
| [OpenFreeMap](https://openfreemap.org/) / OpenStreetMap | Basemap tiles and labels |

Feed data is fetched in the browser approximately every five minutes. Polygon events use
point-in-polygon matching, county alerts use exact FIPS matching, and point events use a
severity-scaled radius. A failed refresh retains the last successful response for that
source for no more than one hour and marks it stale in the interface. Expired alerts are
removed from cached responses. Paginated sources are loaded before impact matching,
subject to a 5,000-feature and 64 MB per-response safety boundary; this avoids silently
preferring the provider's first page.

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
