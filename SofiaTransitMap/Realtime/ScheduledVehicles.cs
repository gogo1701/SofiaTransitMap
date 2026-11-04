using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using SofiaTransitMap.Gtfs;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;

namespace SofiaTransitMap.Realtime
{
    public sealed record ScheduledVehicle(
        string Id, GtfsTrip Trip, GtfsRoute Route, double Lat, double Lon, double? Bearing, GtfsStop? NextStop, long Timestamp);

    /// <summary>
    /// Sofia Metro publishes a timetable in the static GTFS feed but no GTFS-Realtime data, so trains are placed
    /// on the map from the timetable: each running trip is interpolated along its shape between the stops it is
    /// travelling between. These positions are estimates and never enter delay statistics.
    /// </summary>
    public static class ScheduledVehicles
    {
        private static readonly ConditionalWeakTable<GtfsFeed, ConcurrentDictionary<int, (int[] Vertex, double[] Cum)>> Geometry = new();

        public static IReadOnlyList<ScheduledVehicle> Compute(GtfsFeed feed, DateTimeOffset now, IReadOnlySet<string> liveRouteIds)
        {
            var result = new List<ScheduledVehicle>();
            var today = DateOnly.FromDateTime(now.DateTime);
            var stamp = now.ToUnixTimeSeconds();
            var routes = feed.Routes.Where(r => r.Mode == TransitType.Metro && !liveRouteIds.Contains(r.Id)).ToList();
            if (routes.Count == 0) return result;

            // Trips after midnight belong to the previous service day with times past 24:00.
            foreach (var day in new[] { today.AddDays(-1), today })
            {
                var active = feed.ActiveServices(day);
                var secs = SofiaClock.ToServiceSeconds(day, now);
                foreach (var route in routes)
                foreach (var ti in route.Trips)
                {
                    var trip = feed.Trips[ti];
                    if (trip.StCount < 2 || !active[trip.Service]) continue;
                    var s0 = trip.StStart;
                    var s1 = trip.StStart + trip.StCount - 1;
                    if (secs < feed.StDep[s0] || secs >= feed.StArr[s1]) continue;
                    var v = Locate(feed, trip, secs, route, stamp);
                    if (v != null) result.Add(v);
                }
            }
            return result;
        }

        private static ScheduledVehicle? Locate(GtfsFeed feed, GtfsTrip trip, int secs, GtfsRoute route, long stamp)
        {
            var first = trip.StStart;
            var last = trip.StStart + trip.StCount - 1;
            var k = first;
            while (k < last && feed.StArr[k + 1] <= secs) k++;
            if (k >= last) return null;

            var from = feed.Stops[feed.StStop[k]];
            var to = feed.Stops[feed.StStop[k + 1]];
            var id = $"sched-{trip.Id}";

            // Dwelling at a station.
            if (secs < feed.StDep[k])
                return new ScheduledVehicle(id, trip, route, from.Lat, from.Lon, Geo.Bearing(from.Lat, from.Lon, to.Lat, to.Lon), from, stamp);

            var span = Math.Max(1, feed.StArr[k + 1] - feed.StDep[k]);
            var f = Math.Clamp((secs - feed.StDep[k]) / (double)span, 0, 1);

            if (feed.Shapes.TryGetValue(trip.ShapeId, out var pts) && pts.Length >= 4)
            {
                var (vertex, cum) = StopGeometry(feed, trip, pts);
                var a = vertex[k - first];
                var b = vertex[k + 1 - first];
                if (b > a)
                {
                    var target = cum[a] + (cum[b] - cum[a]) * f;
                    var i = a;
                    while (i < b - 1 && cum[i + 1] < target) i++;
                    var seg = cum[i + 1] - cum[i];
                    var g = seg > 0 ? (target - cum[i]) / seg : 0;
                    double lat1 = pts[i * 2], lon1 = pts[i * 2 + 1], lat2 = pts[(i + 1) * 2], lon2 = pts[(i + 1) * 2 + 1];
                    return new ScheduledVehicle(id, trip, route, lat1 + (lat2 - lat1) * g, lon1 + (lon2 - lon1) * g,
                        Geo.Bearing(lat1, lon1, lat2, lon2), to, stamp);
                }
            }

            return new ScheduledVehicle(id, trip, route, from.Lat + (to.Lat - from.Lat) * f, from.Lon + (to.Lon - from.Lon) * f,
                Geo.Bearing(from.Lat, from.Lon, to.Lat, to.Lon), to, stamp);
        }

        /// <summary>Shape vertex of each stop of the trip, plus cumulative metres along the shape; cached per trip.</summary>
        private static (int[] Vertex, double[] Cum) StopGeometry(GtfsFeed feed, GtfsTrip trip, float[] pts) =>
            Geometry.GetOrCreateValue(feed).GetOrAdd(trip.Index, _ =>
            {
                var n = pts.Length / 2;
                var cum = new double[n];
                for (var i = 1; i < n; i++)
                    cum[i] = cum[i - 1] + Geo.DistanceMeters(pts[(i - 1) * 2], pts[(i - 1) * 2 + 1], pts[i * 2], pts[i * 2 + 1]);
                var vertex = new int[trip.StCount];
                var start = 0;
                for (var s = 0; s < trip.StCount; s++)
                {
                    var stop = feed.Stops[feed.StStop[trip.StStart + s]];
                    var v = feed.NearestShapeIndex(trip.ShapeId, stop.Lat, stop.Lon, start);
                    vertex[s] = v < 0 ? start : v;
                    start = vertex[s];
                }
                return (vertex, cum);
            });
    }
}
