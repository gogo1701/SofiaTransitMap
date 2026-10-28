using Microsoft.AspNetCore.Mvc;
using SofiaTransitMap.Gtfs;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;
using SofiaTransitMap.Realtime;

namespace SofiaTransitMap.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class RoutesController : ControllerBase
    {
        private readonly GtfsStore _store;
        private readonly RealtimeState _realtime;

        public RoutesController(GtfsStore store, RealtimeState realtime)
        {
            _store = store;
            _realtime = realtime;
        }

        internal static (int Num, string Text) SortKey(string shortName)
        {
            var digits = new string(shortName.Where(char.IsDigit).ToArray());
            return (int.TryParse(digits, out var n) ? n : 9999, shortName);
        }

        internal static IEnumerable<GtfsRoute> Sorted(IEnumerable<GtfsRoute> routes) =>
            routes.OrderBy(r => GtfsLoader.ModePriority(r.Mode)).ThenBy(r => SortKey(r.ShortName).Num).ThenBy(r => r.ShortName);

        [HttpGet]
        public IActionResult Get([FromQuery] TransitType? type)
        {
            var feed = _store.Require();
            var live = _realtime.Snapshot.Vehicles.GroupBy(v => v.RouteId).ToDictionary(g => g.Key, g => g.Count());
            foreach (var g in ScheduledVehicles.Compute(feed, SofiaClock.Now, live.Keys.ToHashSet()).GroupBy(s => s.Route.Id))
                live[g.Key] = g.Count();
            var routes = feed.Routes.Where(r => r.Trips.Count > 0);
            if (type.HasValue) routes = routes.Where(r => r.Mode == type.Value);
            return Ok(Sorted(routes).Select(r => new
            {
                r.Id, r.ShortName, r.LongName, r.LongNameEn, r.Mode, r.Color, r.TextColor,
                liveVehicles = live.GetValueOrDefault(r.Id),
            }));
        }

        [HttpGet("{id}")]
        public IActionResult GetRoute(string id)
        {
            var feed = _store.Require();
            var route = feed.FindRoute(id)
                ?? feed.Routes.FirstOrDefault(r => string.Equals(r.ShortName, id, StringComparison.OrdinalIgnoreCase));
            if (route == null) return NotFound(new { message = $"Route '{id}' not found" });

            var today = SofiaClock.Today;
            var active = route.Trips.Where(t => feed.IsTripActive(t, today)).ToList();
            var source = active.Count > 0 ? active : route.Trips;

            var directions = source
                .Select(t => feed.Trips[t])
                .GroupBy(t => t.Direction)
                .OrderBy(g => g.Key)
                .Select(g =>
                {
                    // The most common pattern, preferring the longest, represents the direction.
                    var trip = g.GroupBy(t => (t.StCount, t.ShapeId))
                        .OrderByDescending(p => p.Count() * 1000 + p.Key.StCount)
                        .First().First();
                    var stops = Enumerable.Range(trip.StStart, trip.StCount)
                        .Select(row => feed.Stops[feed.StStop[row]])
                        .Select(StopDto.From)
                        .ToList();
                    var tripsToday = active.Count(t => feed.Trips[t].Direction == g.Key);
                    var firstLast = active.Where(t => feed.Trips[t].Direction == g.Key)
                        .Select(t => feed.StDep[feed.Trips[t].StStart]).DefaultIfEmpty().ToList();
                    return new
                    {
                        direction = g.Key,
                        headsign = trip.Headsign,
                        headsignEn = trip.HeadsignEn,
                        stops,
                        shape = string.IsNullOrEmpty(trip.ShapeId)
                            ? stops.Select(s => new[] { s.Lat, s.Lon }).ToList()
                            : feed.ShapePoints(trip.ShapeId),
                        tripsToday,
                        firstDeparture = tripsToday > 0 ? SofiaClock.At(today, firstLast.Min()) : (DateTimeOffset?)null,
                        lastDeparture = tripsToday > 0 ? SofiaClock.At(today, firstLast.Max()) : (DateTimeOffset?)null,
                    };
                })
                .ToList();

            return Ok(new { route = RouteDto.From(route), directions });
        }
    }

    [Route("api/plan")]
    [ApiController]
    public class PlanController : ControllerBase
    {
        private readonly Planning.JourneyPlanner _planner;

        public PlanController(Planning.JourneyPlanner planner) => _planner = planner;

        [HttpGet]
        public IActionResult Get(
            [FromQuery] double fromLat, [FromQuery] double fromLon,
            [FromQuery] double toLat, [FromQuery] double toLon,
            [FromQuery] string? fromName = null, [FromQuery] string? toName = null,
            [FromQuery] string? date = null, [FromQuery] string? time = null,
            [FromQuery] bool arriveBy = false, [FromQuery] int maxWalk = 900, [FromQuery] int count = 4)
        {
            if (!InSofia(fromLat, fromLon) || !InSofia(toLat, toLon))
                return BadRequest(new { message = "Start and destination must be inside the Sofia area." });

            var now = SofiaClock.Now;
            var d = DateOnly.TryParse(date, System.Globalization.CultureInfo.InvariantCulture, out var pd) ? pd : DateOnly.FromDateTime(now.DateTime);
            var t = TimeOnly.TryParse(time, System.Globalization.CultureInfo.InvariantCulture, out var pt) ? pt : TimeOnly.FromDateTime(now.DateTime);

            var result = _planner.Plan(new Planning.PlanRequest(fromLat, fromLon, fromName, toLat, toLon, toName,
                d, t, arriveBy, Math.Clamp(maxWalk, 200, 2500), Math.Clamp(count, 1, 6)));
            return Ok(result);
        }

        private static bool InSofia(double lat, double lon) => lat is > 42.4 and < 43.0 && lon is > 22.9 and < 23.7;
    }

    [Route("api/geocode")]
    [ApiController]
    public class GeocodeController : ControllerBase
    {
        private readonly GeocodingService _geo;
        private readonly GtfsStore _store;

        public GeocodeController(GeocodingService geo, GtfsStore store)
        {
            _geo = geo;
            _store = store;
        }

        [HttpGet]
        public async Task<IActionResult> Search([FromQuery] string q, [FromQuery] string lang = "bg", CancellationToken ct = default)
        {
            q = (q ?? "").Trim();
            if (q.Length < 2) return Ok(Array.Empty<GeoPlace>());

            var results = new List<GeoPlace>();
            if (_store.Current is { } feed)
            {
                results.AddRange(StationsController.SearchStops(feed, q, 4).Select(s => new GeoPlace(
                    lang == "en" && s.NameEn != null ? s.NameEn : s.Name,
                    $"#{s.Code}", s.Lat, s.Lon, "stop", s.Id)));
            }
            if (!q.All(char.IsDigit))
                results.AddRange(await _geo.SearchAsync(q, lang, ct));
            return Ok(results.Take(10));
        }

        [HttpGet("reverse")]
        public async Task<IActionResult> Reverse([FromQuery] double lat, [FromQuery] double lon, [FromQuery] string lang = "bg", CancellationToken ct = default)
        {
            var place = await _geo.ReverseAsync(lat, lon, lang, ct);
            return Ok(place ?? new GeoPlace($"{lat:F5}, {lon:F5}", null, lat, lon, "point"));
        }
    }

    [Route("api/live")]
    [ApiController]
    public class LiveController : ControllerBase
    {
        private readonly GtfsStore _store;
        private readonly RealtimeState _realtime;

        public LiveController(GtfsStore store, RealtimeState realtime)
        {
            _store = store;
            _realtime = realtime;
        }

        [HttpGet("vehicles")]
        public IActionResult Vehicles([FromQuery] string? routeId = null, [FromQuery] TransitType? type = null)
        {
            var feed = _store.Require();
            var snap = _realtime.Snapshot;
            var items = new List<object>();
            foreach (var v in snap.Vehicles)
            {
                var route = feed.FindRoute(v.RouteId);
                if (route == null) continue;
                if (routeId != null && route.Id != routeId) continue;
                if (type.HasValue && route.Mode != type.Value) continue;
                var trip = feed.FindTrip(v.TripId);
                var next = v.NextStopId != null ? feed.FindStop(v.NextStopId) : null;
                items.Add(new
                {
                    id = v.VehicleId,
                    v.TripId,
                    routeId = route.Id,
                    route = route.ShortName,
                    mode = route.Mode,
                    color = route.Color,
                    textColor = route.TextColor,
                    lat = Math.Round(v.Lat, 6),
                    lon = Math.Round(v.Lon, 6),
                    bearing = v.Bearing is double b ? Math.Round(b) : (double?)null,
                    speedKmh = v.Speed is double s ? Math.Round(s) : (double?)null,
                    delaySec = v.DelaySec,
                    headsign = trip?.Headsign,
                    headsignEn = trip?.HeadsignEn,
                    nextStop = next?.Name,
                    nextStopEn = next?.NameEn,
                    status = v.Status,
                    occupancy = v.Occupancy,
                    wheelchair = trip?.Wheelchair ?? false,
                    timestamp = v.Timestamp,
                    scheduled = false,
                });
            }
            var liveRoutes = snap.Vehicles.Select(v => v.RouteId).ToHashSet();
            foreach (var s in ScheduledVehicles.Compute(feed, SofiaClock.Now, liveRoutes))
            {
                if (routeId != null && s.Route.Id != routeId) continue;
                if (type.HasValue && s.Route.Mode != type.Value) continue;
                items.Add(new
                {
                    id = s.Id,
                    tripId = s.Trip.Id,
                    routeId = s.Route.Id,
                    route = s.Route.ShortName,
                    mode = s.Route.Mode,
                    color = s.Route.Color,
                    textColor = s.Route.TextColor,
                    lat = Math.Round(s.Lat, 6),
                    lon = Math.Round(s.Lon, 6),
                    bearing = s.Bearing is double b ? Math.Round(b) : (double?)null,
                    speedKmh = (double?)null,
                    delaySec = (int?)null,
                    headsign = s.Trip.Headsign,
                    headsignEn = s.Trip.HeadsignEn,
                    nextStop = s.NextStop?.Name,
                    nextStopEn = s.NextStop?.NameEn,
                    status = (string?)null,
                    occupancy = (string?)null,
                    wheelchair = s.Trip.Wheelchair,
                    timestamp = s.Timestamp,
                    scheduled = true,
                });
            }
            return Ok(new { fetchedAt = snap.FetchedAt == DateTimeOffset.MinValue ? (DateTimeOffset?)null : snap.FetchedAt, fresh = _realtime.IsFresh, vehicles = items });
        }

        [HttpGet("alerts")]
        public IActionResult Alerts()
        {
            var feed = _store.Current;
            var alerts = _realtime.ActiveAlerts().Select(a => new
            {
                a.Id, a.HeaderBg, a.HeaderEn, a.DescriptionBg, a.DescriptionEn, a.Cause, a.Effect, a.Url,
                start = a.Start is long s ? DateTimeOffset.FromUnixTimeSeconds(s) : (DateTimeOffset?)null,
                end = a.End is long e ? DateTimeOffset.FromUnixTimeSeconds(e) : (DateTimeOffset?)null,
                routes = feed == null ? new List<RouteDto>() : RoutesController.Sorted(a.RouteIds.Select(feed.FindRoute).OfType<GtfsRoute>().Distinct()).Select(RouteDto.From).ToList(),
                stops = a.StopIds.Count,
            }).ToList();
            return Ok(new { fetchedAt = _realtime.AlertsFetchedAt, alerts });
        }
    }

    [Route("api/status")]
    [ApiController]
    public class StatusController : ControllerBase
    {
        private readonly GtfsStore _store;
        private readonly RealtimeState _realtime;
        private readonly Persistence.TransitDb _db;

        public StatusController(GtfsStore store, RealtimeState realtime, Persistence.TransitDb db)
        {
            _store = store;
            _realtime = realtime;
            _db = db;
        }

        [HttpGet]
        public async Task<IActionResult> Get(CancellationToken ct)
        {
            var feed = _store.Current;
            var count = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.CountAsync(_db.NetworkSnapshots, ct);
            var first = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.MinAsync(
                _db.NetworkSnapshots.Select(s => (DateTime?)s.TimestampUtc), ct);
            return Ok(new
            {
                feed = new
                {
                    state = _store.State,
                    error = _store.LastError,
                    version = feed?.FeedVersion,
                    validFrom = feed?.FeedStart,
                    validTo = feed?.FeedEnd,
                    source = feed?.Source,
                    loadedAt = feed?.LoadedAt,
                    stops = feed?.Stops.Count(s => s.IsServed && s.LocationType == 0),
                    routes = feed?.Routes.Count(r => r.Trips.Count > 0),
                    trips = feed?.Trips.Count,
                },
                realtime = new
                {
                    fresh = _realtime.IsFresh,
                    fetchedAt = _realtime.Snapshot.FetchedAt == DateTimeOffset.MinValue ? (DateTimeOffset?)null : _realtime.Snapshot.FetchedAt,
                    vehicles = _realtime.Snapshot.Vehicles.Count,
                    error = _realtime.LastError,
                },
                history = new
                {
                    snapshots = count,
                    since = first is DateTime f ? DateTime.SpecifyKind(f, DateTimeKind.Utc) : (DateTime?)null,
                    lastSaved = _realtime.LastSnapshotSaved,
                },
                now = SofiaClock.Now,
            });
        }
    }
}
