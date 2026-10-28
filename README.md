# Sofia Transit Map

A live public transport map, journey planner and punctuality dashboard for Sofia, built on the
official open GTFS feeds of the Urban Mobility Center (ЦГМ / sofiatraffic.bg).

- **Map**: every bus, tram, trolleybus and metro stop, plus all vehicles on the network gliding in real time
  (refreshed every 20 s) with their delay, next stop, speed and occupancy.
- **Stops**: upcoming departures with live predictions and delays.
- **Journey planner**: address-to-address (or stop / map click / “my location”) routing for *now*,
  *depart at* or *arrive by* any date and time. Uses the timetable plus live delays, walking legs and transfers.
- **Lines**: every line with its route, stops, trips per day, first/last departure and vehicles approaching each stop.
- **Statistics**: network punctuality stored in a SQLite database every couple of minutes. Includes average and 90th-percentile
  delay, delayed vehicles over time, delay distribution, by hour of day, by weekday, by transport mode, the
  most delayed lines and a sortable per-line table with per-line charts.
- **Alerts**: current service notices (detours, closures) linked to the affected lines.
- Bulgarian interface with an English toggle; responsive (bottom sheet on mobile); keyboard and screen-reader friendly.
- Installable PWA with an offline-cached application shell and install prompt in supported browsers.
- Metro (M1–M4) timetables come from the static GTFS feed. The realtime feed carries no metro trains, so their
  map positions are estimated from the timetable, drawn as dashed markers and excluded from delay statistics.
- Trip directions are inferred from stop geometry because the feed omits `direction_id`.

The app shell and interface assets can be opened offline after installation. Live vehicles,
departures, routing, geocoding, map tiles and statistics still require a network connection; API responses
are deliberately not cached to avoid presenting stale transit data as current.

## Run

Requires the .NET 9 SDK.

```bash
cd SofiaTransitMap
dotnet run
```

Open the printed URL (e.g. `http://localhost:5000`). On first start the static GTFS feed (~10 MB) is
downloaded and cached in `App_Data/`; the UI shows a loading state until it is ready (~20 s).
Statistics start collecting immediately and grow over time.

## Data sources

| Data | Source |
| --- | --- |
| Timetable (GTFS static) | `https://gtfs.sofiatraffic.bg/api/v1/static` (refreshed every 12 h) |
| Vehicle positions, trip updates, alerts (GTFS-realtime) | `https://gtfs.sofiatraffic.bg/api/v1/{vehicle-positions,trip-updates,alerts}` |
| Address search | OpenStreetMap Nominatim (bounded to Sofia) + GTFS stops |
| Base map | © OpenStreetMap contributors |

GTFS data © Urban Mobility Center Sofia, licensed CC BY 4.0.

## Configuration (`appsettings.json`)

| Key | Default | Meaning |
| --- | --- | --- |
| `ConnectionStrings:Transit` | `Data Source=App_Data/transit.db` | SQLite statistics database |
| `Gtfs:StaticRefreshHours` | `12` | How often the timetable is re-downloaded |
| `Realtime:PollSeconds` | `20` | Realtime feed polling interval |
| `Realtime:SnapshotSeconds` | `120` | How often a statistics snapshot is saved |
| `Realtime:DelayedThresholdSeconds` | `180` | A vehicle counts as “delayed” above this |
| `Realtime:SevereThresholdSeconds` | `600` | A vehicle counts as “severely delayed” above this |
| `Realtime:RetentionDays` | `90` | Snapshots older than this are pruned |

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/status` | Feed / realtime / history status |
| `GET /api/stations?lat&lon&radius` · `/api/stations/search?q` · `/api/stations/{id}` | Stops |
| `GET /api/stations/{id}/departures` | Upcoming departures with live predictions |
| `GET /api/routes` · `/api/routes/{id}` | Lines, directions, shapes and stops |
| `GET /api/plan?fromLat&fromLon&toLat&toLon&date&time&arriveBy&maxWalk&count` | Journey planner (Connection Scan Algorithm) |
| `GET /api/geocode?q` · `/api/geocode/reverse?lat&lon` | Address and stop search |
| `GET /api/live/vehicles` · `/api/live/alerts` | Realtime vehicles and alerts |
| `GET /api/stats/live` | Current network punctuality |
| `GET /api/stats/{summary,timeseries,hourly,weekday,modes,lines}?hours=` | Aggregated history |
| `GET /api/stats/lines/{routeId}?hours=` | History for one line |

## Project layout

```
SofiaTransitMap/
  Gtfs/           static feed download, parsing and indexed in-memory store
  Realtime/       GTFS-realtime polling, delay computation, statistics snapshots
  Planning/       journey planner (CSA) and geocoding
  Persistence/    EF Core SQLite context for statistics
  Controllers/    REST API
  Models/, Data/, Infrastructure/, Protos/   DTOs, helpers, GTFS-realtime protobuf
  wwwroot/        no-build front end (ES modules, Leaflet, Chart.js, Sofia Sans)
```

See [DESIGN.md](DESIGN.md) for the visual system and [PRODUCT.md](PRODUCT.md) for product intent.
