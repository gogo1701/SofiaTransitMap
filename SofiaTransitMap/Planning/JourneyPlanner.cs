using SofiaTransitMap.Gtfs;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;
using SofiaTransitMap.Realtime;

namespace SofiaTransitMap.Planning
{
    public sealed record PlanRequest(double FromLat, double FromLon, string? FromName, double ToLat, double ToLon, string? ToName,
        DateOnly Date, TimeOnly Time, bool ArriveBy, int MaxWalkMeters, int Count);

    /// <summary>
    /// Earliest-arrival journey planner over the GTFS timetable using the Connection Scan Algorithm,
    /// with walking access/egress and footpath transfers.
    /// </summary>
    public sealed class JourneyPlanner
    {
        private const int Inf = int.MaxValue / 2;
        private const int TransferSlackSec = 60;
        private const int SearchHorizonSec = 4 * 3600;

        private readonly GtfsStore _store;
        private readonly RealtimeState _realtime;
        private readonly object _cacheLock = new();
        private readonly LinkedList<(long Key, Conn[] Conns)> _cache = new();

        public JourneyPlanner(GtfsStore store, RealtimeState realtime)
        {
            _store = store;
            _realtime = realtime;
        }

        private readonly record struct Conn(int Dep, int Arr, int From, int To, int TripKey, int Row);

        private Conn[] Connections(GtfsFeed feed, DateOnly date)
        {
            var key = feed.LoadedAt.UtcTicks ^ ((long)SofiaClock.DateKey(date) << 1);
            lock (_cacheLock)
            {
                for (var node = _cache.First; node != null; node = node.Next)
                    if (node.Value.Key == key) { _cache.Remove(node); _cache.AddFirst(node); return node.Value.Conns; }
            }

            var today = feed.ActiveServices(date);
            var yesterday = feed.ActiveServices(date.AddDays(-1));
            var list = new List<Conn>(400_000);
            foreach (var trip in feed.Trips)
            {
                if (trip.StCount < 2) continue;
                var end = trip.StStart + trip.StCount - 1;
                if (today[trip.Service])
                {
                    for (var r = trip.StStart; r < end; r++)
                        list.Add(new Conn(feed.StDep[r], feed.StArr[r + 1], feed.StStop[r], feed.StStop[r + 1], trip.Index * 2, r));
                }
                if (yesterday[trip.Service] && feed.StArr[end] >= 86400)
                {
                    for (var r = trip.StStart; r < end; r++)
                    {
                        var dep = feed.StDep[r] - 86400;
                        if (dep < 0) continue;
                        list.Add(new Conn(dep, feed.StArr[r + 1] - 86400, feed.StStop[r], feed.StStop[r + 1], trip.Index * 2 + 1, r));
                    }
                }
            }
            var conns = list.ToArray();
            Array.Sort(conns, (a, b) => a.Dep != b.Dep ? a.Dep.CompareTo(b.Dep) : a.Arr.CompareTo(b.Arr));

            lock (_cacheLock)
            {
                _cache.AddFirst((key, conns));
                while (_cache.Count > 3) _cache.RemoveLast();
            }
            return conns;
        }

        public PlanResult Plan(PlanRequest req)
        {
            var feed = _store.Require();
            var date = req.Date;
            var t0 = req.Time.Hour * 3600 + req.Time.Minute * 60;
            var requested = SofiaClock.At(date, t0);
            var maxWalk = Math.Clamp(req.MaxWalkMeters, 200, 2000);

            var access = NearestStops(feed, req.FromLat, req.FromLon, maxWalk);
            var egress = NearestStops(feed, req.ToLat, req.ToLon, maxWalk);
            var directMeters = Geo.DistanceMeters(req.FromLat, req.FromLon, req.ToLat, req.ToLon);
            var directWalk = Geo.WalkSeconds(directMeters);

            var origin = new PlanPlace(req.FromName ?? "", null, req.FromLat, req.FromLon);
            var destination = new PlanPlace(req.ToName ?? "", null, req.ToLat, req.ToLon);

            var journeys = new List<PlanJourney>();
            var conns = Connections(feed, date);
            var count = Math.Clamp(req.Count, 1, 6);

            if (access.Count > 0 && egress.Count > 0)
            {
                if (!req.ArriveBy)
                {
                    var start = t0;
                    for (var attempt = 0; attempt < count * 2 && journeys.Count < count; attempt++)
                    {
                        var j = Scan(feed, conns, date, start, access, egress, origin, destination);
                        if (j == null) break;
                        if (!journeys.Any(x => Same(x, j.Value.Journey))) journeys.Add(j.Value.Journey);
                        start = j.Value.FirstBoardDep - j.Value.AccessSec + 60;
                    }
                }
                else
                {
                    var found = new List<PlanJourney>();
                    // Find the latest coarse start that still makes it in time, then walk forward through departures.
                    var start = Math.Max(0, t0 - 180 * 60);
                    foreach (var offsetMin in new[] { 30, 50, 75, 105, 140 })
                    {
                        var probe = Math.Max(0, t0 - offsetMin * 60);
                        var pj = Scan(feed, conns, date, probe, access, egress, origin, destination);
                        if (pj != null && pj.Value.Journey.Arrival <= requested) { start = probe; break; }
                    }
                    for (var attempt = 0; attempt < 60; attempt++)
                    {
                        var j = Scan(feed, conns, date, start, access, egress, origin, destination);
                        if (j == null || j.Value.Journey.Arrival > requested) break;
                        if (!found.Any(x => Same(x, j.Value.Journey))) found.Add(j.Value.Journey);
                        start = j.Value.FirstBoardDep - j.Value.AccessSec + 60;
                    }
                    journeys.AddRange(found.OrderByDescending(x => x.Departure).Take(count));
                }
            }

            // Walking is a first-class answer for short distances, and the fallback when nothing runs.
            if (directMeters <= 2500 || journeys.Count == 0 && directMeters <= 6000)
            {
                var dep = req.ArriveBy ? requested.AddSeconds(-directWalk) : requested;
                var walkLeg = WalkLeg(origin, destination, dep, directMeters);
                var walk = new PlanJourney(dep, walkLeg.Arrival, directWalk, (int)(directMeters * Geo.WalkDetourFactor), 0, new List<PlanLeg> { walkLeg });
                if (journeys.Count == 0 || journeys.Min(x => x.Arrival) > walk.Arrival || directMeters <= 1200)
                    journeys.Add(walk);
            }

            var ordered = req.ArriveBy
                ? journeys.OrderByDescending(x => x.Departure).ToList()
                : journeys.OrderBy(x => x.Arrival).ThenBy(x => x.Transfers).ToList();

            string? message = null;
            if (ordered.Count == 0)
            {
                message = access.Count == 0 || egress.Count == 0
                    ? "no-stops-nearby"
                    : feed.ActiveServices(date).Cast<bool>().Any(b => b) ? "no-connection" : "no-service";
            }
            return new PlanResult(requested, req.ArriveBy, ordered, message);
        }

        private static bool Same(PlanJourney a, PlanJourney b) =>
            a.Departure == b.Departure && a.Arrival == b.Arrival && a.Legs.Count == b.Legs.Count;

        private readonly record struct Walk(int Seconds, double Meters, int Entrance);

        private static Dictionary<int, Walk> NearestStops(GtfsFeed feed, double lat, double lon, int maxWalk)
        {
            var result = new Dictionary<int, Walk>();
            foreach (var radius in new[] { maxWalk, maxWalk * 2 })
            {
                foreach (var (stop, _) in feed.NearbyStops(lat, lon, radius))
                {
                    if (feed.Stops[stop].LocationType != 0) continue;
                    var (meters, entrance) = feed.WalkTo(stop, lat, lon);
                    result[stop] = new Walk(Geo.WalkSeconds(meters), meters, entrance);
                }
                if (result.Count > 0) break;
            }
            return result;
        }

        private (PlanJourney Journey, int FirstBoardDep, int AccessSec)? Scan(
            GtfsFeed feed, Conn[] conns, DateOnly date, int start,
            Dictionary<int, Walk> access, Dictionary<int, Walk> egress,
            PlanPlace origin, PlanPlace destination)
        {
            var nStops = feed.Stops.Count;
            var ready = new int[nStops];
            Array.Fill(ready, Inf);
            var viaConn = new int[nStops];
            Array.Fill(viaConn, -1);
            var viaFoot = new int[nStops];
            Array.Fill(viaFoot, -1);
            var tripBoard = new int[feed.Trips.Count * 2];
            Array.Fill(tripBoard, -1);

            foreach (var (stop, a) in access) ready[stop] = start + a.Seconds;

            var bestArr = Inf;
            var bestConn = -1;
            var bestStop = -1;

            var lo = 0;
            var hi = conns.Length;
            while (lo < hi) { var mid = (lo + hi) >> 1; if (conns[mid].Dep < start) lo = mid + 1; else hi = mid; }

            for (var i = lo; i < conns.Length; i++)
            {
                ref readonly var c = ref conns[i];
                if (c.Dep >= bestArr || c.Dep > start + SearchHorizonSec) break;

                if (tripBoard[c.TripKey] < 0)
                {
                    if (ready[c.From] > c.Dep) continue;
                    tripBoard[c.TripKey] = i;
                }

                if (egress.TryGetValue(c.To, out var eg) && c.Arr + eg.Seconds < bestArr)
                {
                    bestArr = c.Arr + eg.Seconds;
                    bestConn = i;
                    bestStop = c.To;
                }

                var tReady = c.Arr + TransferSlackSec;
                if (tReady < ready[c.To])
                {
                    ready[c.To] = tReady;
                    viaConn[c.To] = i;
                    viaFoot[c.To] = -1;
                }
                foreach (var fp in feed.Footpaths[c.To])
                {
                    var t = c.Arr + Math.Max(fp.Seconds, TransferSlackSec);
                    if (t < ready[fp.To])
                    {
                        ready[fp.To] = t;
                        viaConn[fp.To] = i;
                        viaFoot[fp.To] = c.To;
                    }
                }
            }

            if (bestConn < 0) return null;

            // Walk the pointers back from the destination.
            var rides = new List<(int Board, int Alight, int WalkFrom)>();
            var exit = bestConn;
            var guard = 0;
            int boardStop;
            while (true)
            {
                var board = tripBoard[conns[exit].TripKey];
                boardStop = conns[board].From;
                var walkFrom = viaFoot[boardStop];
                rides.Add((board, exit, walkFrom));
                if (viaConn[boardStop] < 0 || access.ContainsKey(boardStop) && ready[boardStop] == start + access[boardStop].Seconds) break;
                exit = viaConn[boardStop];
                if (++guard > 12) return null;
            }
            rides.Reverse();

            var legs = new List<PlanLeg>();
            var firstBoard = conns[rides[0].Board];
            var accessSec = access[firstBoard.From].Seconds;
            var departure = SofiaClock.At(date, firstBoard.Dep - accessSec);
            var acc = access[firstBoard.From];
            if (acc.Meters > 30)
                legs.Add(WalkLeg(origin, StopPlace(feed, firstBoard.From), departure, acc.Meters, EntrancePlace(feed, acc.Entrance), enters: true));

            for (var k = 0; k < rides.Count; k++)
            {
                var (b, a, _) = rides[k];
                if (k > 0)
                {
                    var prevAlight = conns[rides[k - 1].Alight];
                    var thisBoard = conns[b];
                    if (prevAlight.To != thisBoard.From)
                    {
                        var (meters, entrance) = feed.WalkBetween(prevAlight.To, thisBoard.From);
                        legs.Add(WalkLeg(StopPlace(feed, prevAlight.To), StopPlace(feed, thisBoard.From),
                            SofiaClock.At(date, prevAlight.Arr), meters, EntrancePlace(feed, entrance),
                            enters: entrance >= 0 && feed.EntrancesOf(thisBoard.From) != null));
                    }
                }
                legs.Add(RideLeg(feed, date, conns[b], conns[a]));
            }

            var last = conns[bestConn];
            var egw = egress[bestStop];
            if (egw.Meters > 30)
                legs.Add(WalkLeg(StopPlace(feed, bestStop), destination, SofiaClock.At(date, last.Arr), egw.Meters, EntrancePlace(feed, egw.Entrance), enters: false));

            var arrival = SofiaClock.At(date, bestArr);
            var walkMeters = (int)legs.Where(l => l.Type == "walk").Sum(l => l.DistanceM);
            var journey = new PlanJourney(departure, arrival, (int)(arrival - departure).TotalSeconds, walkMeters, rides.Count - 1, legs);
            return (journey, firstBoard.Dep, accessSec);
        }

        private static PlanPlace StopPlace(GtfsFeed feed, int stop)
        {
            var s = feed.Stops[stop];
            return new PlanPlace(s.Name, s.NameEn, s.Lat, s.Lon, s.Id, s.Code);
        }

        private static PlanPlace? EntrancePlace(GtfsFeed feed, int entrance)
        {
            if (entrance < 0) return null;
            var e = feed.Stops[entrance];
            return new PlanPlace(e.Name, e.NameEn, e.Lat, e.Lon, e.Id);
        }

        private static PlanLeg WalkLeg(PlanPlace from, PlanPlace to, DateTimeOffset departure, double straightMeters, PlanPlace? entrance = null, bool enters = false)
        {
            var secs = Geo.WalkSeconds(straightMeters);
            return new PlanLeg
            {
                Type = "walk",
                From = from,
                To = to,
                Departure = departure,
                Arrival = departure.AddSeconds(secs),
                DurationSec = secs,
                DistanceM = (int)(straightMeters * Geo.WalkDetourFactor),
                Geometry = entrance == null
                    ? new List<double[]> { new[] { from.Lat, from.Lon }, new[] { to.Lat, to.Lon } }
                    : new List<double[]> { new[] { from.Lat, from.Lon }, new[] { entrance.Lat, entrance.Lon }, new[] { to.Lat, to.Lon } },
                Entrance = entrance,
                EntersMetro = entrance == null ? null : enters,
            };
        }

        private PlanLeg RideLeg(GtfsFeed feed, DateOnly date, Conn board, Conn alight)
        {
            var trip = feed.Trips[board.TripKey / 2];
            var route = feed.Routes[trip.Route];
            var shift = board.TripKey % 2 == 1 ? -86400 : 0;
            var stops = new List<PlanStopCall>();
            for (var r = board.Row; r <= alight.Row + 1; r++)
            {
                var s = feed.Stops[feed.StStop[r]];
                var t = r == board.Row ? feed.StDep[r] : feed.StArr[r];
                stops.Add(new PlanStopCall(s.Id, s.Name, s.NameEn, s.Lat, s.Lon, SofiaClock.At(date, t + shift)));
            }

            var geometry = new List<double[]>();
            if (!string.IsNullOrEmpty(trip.ShapeId) && feed.Shapes.ContainsKey(trip.ShapeId))
            {
                var first = stops[0];
                var lastStop = stops[^1];
                var i0 = feed.NearestShapeIndex(trip.ShapeId, first.Lat, first.Lon);
                var i1 = feed.NearestShapeIndex(trip.ShapeId, lastStop.Lat, lastStop.Lon, i0);
                if (i0 >= 0 && i1 > i0) geometry = feed.ShapePoints(trip.ShapeId, i0, i1);
            }
            if (geometry.Count < 2) geometry = stops.Select(s => new[] { s.Lat, s.Lon }).ToList();

            int? delay = null;
            if (_realtime.Snapshot.Trips.TryGetValue(trip.Id, out var p) && p.ServiceDate == (shift == 0 ? date : date.AddDays(-1)))
                delay = p.DelaySec;

            return new PlanLeg
            {
                Type = "ride",
                From = StopPlace(feed, board.From),
                To = StopPlace(feed, alight.To),
                Departure = SofiaClock.At(date, board.Dep),
                Arrival = SofiaClock.At(date, alight.Arr),
                DurationSec = alight.Arr - board.Dep,
                Route = RouteDto.From(route),
                Headsign = trip.Headsign,
                HeadsignEn = trip.HeadsignEn,
                TripId = trip.Id,
                Wheelchair = trip.Wheelchair,
                Stops = stops,
                Geometry = geometry,
                DelaySec = delay,
            };
        }
    }
}
