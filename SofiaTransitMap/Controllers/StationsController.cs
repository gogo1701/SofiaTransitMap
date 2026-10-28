using Microsoft.AspNetCore.Mvc;
using SofiaTransitMap.Gtfs;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;
using SofiaTransitMap.Realtime;

namespace SofiaTransitMap.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class StationsController : ControllerBase
    {
        private readonly GtfsStore _store;
        private readonly RealtimeState _realtime;

        public StationsController(GtfsStore store, RealtimeState realtime)
        {
            _store = store;
            _realtime = realtime;
        }

        /// <summary>Stops inside a bounding box, optionally filtered by mode.</summary>
        [HttpGet]
        public IActionResult Get(
            [FromQuery] TransitType? type,
            [FromQuery] double? minLat = null,
            [FromQuery] double? maxLat = null,
            [FromQuery] double? minLon = null,
            [FromQuery] double? maxLon = null,
            [FromQuery] int limit = 1500)
        {
            var feed = _store.Require();
            var query = feed.Stops.Where(s => s.IsServed && s.LocationType == 0);
            if (type.HasValue) query = query.Where(s => s.Modes.Contains(type.Value));
            if (minLat.HasValue) query = query.Where(s => s.Lat >= minLat.Value);
            if (maxLat.HasValue) query = query.Where(s => s.Lat <= maxLat.Value);
            if (minLon.HasValue) query = query.Where(s => s.Lon >= minLon.Value);
            if (maxLon.HasValue) query = query.Where(s => s.Lon <= maxLon.Value);
            return Ok(query.Take(Math.Clamp(limit, 1, 5000)).Select(StopDto.From));
        }

        [HttpGet("search")]
        public IActionResult Search([FromQuery] string q, [FromQuery] int limit = 8)
        {
            var feed = _store.Require();
            return Ok(SearchStops(feed, q, limit).Select(StopDto.From));
        }

        internal static IEnumerable<GtfsStop> SearchStops(GtfsFeed feed, string? q, int limit)
        {
            q = q?.Trim();
            if (string.IsNullOrEmpty(q)) return Enumerable.Empty<GtfsStop>();
            return feed.Stops
                .Where(s => s.IsServed && s.LocationType == 0)
                .Select(s => (Stop: s, Score: Score(s, q)))
                .Where(x => x.Score > 0)
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.Stop.Name)
                .Select(x => x.Stop)
                .Take(Math.Clamp(limit, 1, 30));
        }

        private static int Score(GtfsStop s, string q)
        {
            if (s.Code == q || q.All(char.IsDigit) && s.Code.TrimStart('0') == q.TrimStart('0')) return 100;
            var cmp = StringComparison.OrdinalIgnoreCase;
            if (s.Name.StartsWith(q, cmp) || s.NameEn?.StartsWith(q, cmp) == true) return 60;
            if (s.Name.Contains(q, cmp) || s.NameEn?.Contains(q, cmp) == true) return 30;
            return 0;
        }

        [HttpGet("{id}")]
        public IActionResult GetStop(string id)
        {
            var feed = _store.Require();
            var stop = feed.FindStop(id);
            if (stop == null) return NotFound(new { message = $"Stop '{id}' not found" });
            var routes = stop.Routes.Select(r => feed.Routes[r])
                .OrderBy(r => GtfsLoader.ModePriority(r.Mode)).ThenBy(r => RoutesController.SortKey(r.ShortName))
                .Select(RouteDto.From)
                .ToList();
            return Ok(new { stop = StopDto.From(stop), routes });
        }

        /// <summary>Upcoming departures, merging the timetable with live predictions.</summary>
        [HttpGet("{id}/departures")]
        public IActionResult Departures(string id, [FromQuery] int minutes = 90, [FromQuery] int limit = 30)
        {
            var feed = _store.Require();
            var stop = feed.FindStop(id);
            if (stop == null) return NotFound(new { message = $"Stop '{id}' not found" });

            var stopIndexes = new HashSet<int> { stop.Index };
            if (stop.LocationType == 1)
                foreach (var child in feed.Stops.Where(s => s.ParentId == stop.Id)) stopIndexes.Add(child.Index);

            var now = SofiaClock.Now;
            var today = DateOnly.FromDateTime(now.DateTime);
            var nowSec = SofiaClock.ToServiceSeconds(today, now);
            var window = Math.Clamp(minutes, 10, 360) * 60;
            var snapshot = _realtime.Snapshot;
            var running = snapshot.Vehicles.Where(v => v.TripId.Length > 0).Select(v => v.TripId).ToHashSet();
            var result = new List<(DateTimeOffset Sort, object Item)>();

            foreach (var si in stopIndexes)
            {
                for (var k = feed.ByStopOffsets[si]; k < feed.ByStopOffsets[si + 1]; k++)
                {
                    var row = feed.ByStopRows[k];
                    var trip = feed.Trips[feed.RowTrip[row]];
                    if (row == trip.StStart + trip.StCount - 1) continue;

                    foreach (var (date, shift) in new[] { (today, 0), (today.AddDays(-1), -86400) })
                    {
                        var sec = feed.StDep[row] + shift;
                        if (sec < nowSec - 600 || sec > nowSec + window) continue;
                        if (!feed.IsTripActive(trip.Index, date)) continue;

                        var scheduled = SofiaClock.At(date, feed.StDep[row]);
                        DateTimeOffset? predicted = null;
                        int? delay = null;
                        if (running.Contains(trip.Id) && snapshot.Trips.TryGetValue(trip.Id, out var p) && p.ServiceDate == date)
                        {
                            delay = p.DelaySec;
                            if (p.Stops.TryGetValue(feed.Stops[si].Id, out var unix))
                                predicted = SofiaClock.ToLocal(DateTimeOffset.FromUnixTimeSeconds(unix));
                            else if (delay is int d)
                                predicted = scheduled.AddSeconds(d);
                        }
                        var effective = predicted ?? scheduled;
                        if (effective < now.AddSeconds(-30) || effective > now.AddSeconds(window)) continue;

                        var route = feed.Routes[trip.Route];
                        result.Add((effective, new
                        {
                            route = RouteDto.From(route),
                            headsign = trip.Headsign,
                            headsignEn = trip.HeadsignEn,
                            tripId = trip.Id,
                            stopId = feed.Stops[si].Id,
                            scheduled,
                            predicted,
                            delaySec = delay,
                            wheelchair = trip.Wheelchair,
                            live = predicted != null,
                        }));
                    }
                }
            }

            return Ok(new
            {
                stop = StopDto.From(stop),
                generatedAt = now,
                realtime = _realtime.IsFresh,
                departures = result.OrderBy(x => x.Sort).Take(Math.Clamp(limit, 1, 100)).Select(x => x.Item),
            });
        }
    }
}
