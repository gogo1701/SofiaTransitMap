using System.Collections;
using System.Collections.Concurrent;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;

namespace SofiaTransitMap.Gtfs
{
    public sealed class GtfsStop
    {
        public int Index;
        public string Id = "";
        public string Code = "";
        public string Name = "";
        public string? NameEn;
        public double Lat;
        public double Lon;
        public int LocationType;
        public string? ParentId;
        public TransitType Mode;
        public readonly HashSet<TransitType> Modes = new();
        public readonly HashSet<int> Routes = new();
        public bool IsServed;
    }

    public sealed class GtfsRoute
    {
        public int Index;
        public string Id = "";
        public string ShortName = "";
        public string LongName = "";
        public string? LongNameEn;
        public int RouteType;
        public string Color = "";
        public string TextColor = "";
        public TransitType Mode;
        public readonly List<int> Trips = new();
    }

    public sealed class GtfsTrip
    {
        public int Index;
        public string Id = "";
        public int Route;
        public int Service;
        public string Headsign = "";
        public string? HeadsignEn;
        public int Direction;
        public string ShapeId = "";
        public bool Wheelchair;
        public int StStart;
        public int StCount;
    }

    public readonly record struct Footpath(int To, int Seconds);

    public sealed class GtfsFeed
    {
        public required List<GtfsStop> Stops { get; init; }
        public required Dictionary<string, int> StopIndex { get; init; }
        public required List<GtfsRoute> Routes { get; init; }
        public required Dictionary<string, int> RouteIndex { get; init; }
        public required List<GtfsTrip> Trips { get; init; }
        public required Dictionary<string, int> TripIndex { get; init; }

        /// <summary>Stop times grouped by trip and ordered by stop_sequence; a trip owns [StStart, StStart + StCount).</summary>
        public required int[] StStop { get; init; }
        public required int[] StArr { get; init; }
        public required int[] StDep { get; init; }

        /// <summary>CSR index from stop to the stop-time rows that serve it.</summary>
        public required int[] ByStopOffsets { get; init; }
        public required int[] ByStopRows { get; init; }
        public required int[] RowTrip { get; init; }

        public required Dictionary<string, float[]> Shapes { get; init; }
        public required List<string> ServiceIds { get; init; }
        public required Dictionary<int, List<(int Service, int Type)>> CalendarExceptions { get; init; }
        public required List<(int Service, int Start, int End, bool[] Weekdays)> Calendar { get; init; }
        public required List<Footpath>[] Footpaths { get; init; }
        public required Dictionary<long, List<int>> Grid { get; init; }

        public string FeedVersion { get; set; } = "";
        public string FeedStart { get; set; } = "";
        public string FeedEnd { get; set; } = "";
        public string Source { get; init; } = "";
        public DateTimeOffset LoadedAt { get; init; } = DateTimeOffset.UtcNow;

        private readonly ConcurrentDictionary<int, BitArray> _activeCache = new();

        internal const double CellLat = 0.005;
        internal const double CellLon = 0.007;

        internal static long CellKey(int la, int lo) => ((long)la << 32) | (uint)lo;

        public BitArray ActiveServices(DateOnly date)
        {
            var key = SofiaClock.DateKey(date);
            return _activeCache.GetOrAdd(key, k =>
            {
                var bits = new BitArray(ServiceIds.Count);
                var dow = (int)date.DayOfWeek;
                foreach (var c in Calendar)
                    if (k >= c.Start && k <= c.End && c.Weekdays[dow]) bits[c.Service] = true;
                if (CalendarExceptions.TryGetValue(k, out var list))
                    foreach (var (svc, type) in list) bits[svc] = type == 1;
                return bits;
            });
        }

        public bool IsTripActive(int trip, DateOnly date) => ActiveServices(date)[Trips[trip].Service];

        public IEnumerable<(int Stop, double Meters)> NearbyStops(double lat, double lon, double radiusMeters, bool servedOnly = true)
        {
            var dLat = radiusMeters / 111_000.0;
            var dLon = radiusMeters / (111_000.0 * Math.Cos(lat * Math.PI / 180));
            var la0 = (int)Math.Floor((lat - dLat) / CellLat);
            var la1 = (int)Math.Floor((lat + dLat) / CellLat);
            var lo0 = (int)Math.Floor((lon - dLon) / CellLon);
            var lo1 = (int)Math.Floor((lon + dLon) / CellLon);
            for (var a = la0; a <= la1; a++)
            for (var o = lo0; o <= lo1; o++)
            {
                if (!Grid.TryGetValue(CellKey(a, o), out var cell)) continue;
                foreach (var s in cell)
                {
                    var stop = Stops[s];
                    if (servedOnly && !stop.IsServed) continue;
                    var d = Geo.DistanceMeters(lat, lon, stop.Lat, stop.Lon);
                    if (d <= radiusMeters) yield return (s, d);
                }
            }
        }

        /// <summary>Street entrances (location_type 2) by station index. Platforms reach them through their parent station.</summary>
        public Dictionary<int, List<int>> StationEntrances { get; } = new();

        /// <summary>Extra walking for stairs/escalators between street level and a metro platform.</summary>
        private const double VerticalMeters = 40;

        public List<int>? EntrancesOf(int stop)
        {
            var s = Stops[stop];
            var station = s.LocationType == 1 ? s.Index : s.ParentId != null && StopIndex.TryGetValue(s.ParentId, out var p) ? p : -1;
            return station >= 0 && StationEntrances.TryGetValue(station, out var list) && list.Count > 0 ? list : null;
        }

        /// <summary>Walking distance from a street point to a stop, through the best station entrance when it has any.</summary>
        public (double Meters, int Entrance) WalkTo(int stop, double lat, double lon)
        {
            var s = Stops[stop];
            var entrances = EntrancesOf(stop);
            if (entrances == null) return (Geo.DistanceMeters(lat, lon, s.Lat, s.Lon), -1);
            var best = (Meters: double.MaxValue, Entrance: -1);
            foreach (var e in entrances)
            {
                var en = Stops[e];
                var m = Geo.DistanceMeters(lat, lon, en.Lat, en.Lon) + Geo.DistanceMeters(en.Lat, en.Lon, s.Lat, s.Lon) + VerticalMeters;
                if (m < best.Meters) best = (m, e);
            }
            return best;
        }

        /// <summary>Walking between two stops. A metro platform is left/entered through a street entrance unless
        /// both stops are underground (same or linked stations), where the passage is direct.</summary>
        public (double Meters, int Entrance) WalkBetween(int a, int b)
        {
            var sa = Stops[a];
            var sb = Stops[b];
            var ea = EntrancesOf(a) != null;
            var eb = EntrancesOf(b) != null;
            if (ea && !eb) return WalkTo(a, sb.Lat, sb.Lon);
            if (eb && !ea) return WalkTo(b, sa.Lat, sa.Lon);
            return (Geo.DistanceMeters(sa.Lat, sa.Lon, sb.Lat, sb.Lon), -1);
        }

        public GtfsStop? FindStop(string id) => StopIndex.TryGetValue(id, out var i) ? Stops[i] : null;
        public GtfsRoute? FindRoute(string id) => RouteIndex.TryGetValue(id, out var i) ? Routes[i] : null;
        public GtfsTrip? FindTrip(string id) => TripIndex.TryGetValue(id, out var i) ? Trips[i] : null;

        /// <summary>Returns the shape polyline as [lat, lon] pairs.</summary>
        public List<double[]> ShapePoints(string shapeId, int from = 0, int to = int.MaxValue)
        {
            var result = new List<double[]>();
            if (!Shapes.TryGetValue(shapeId, out var pts)) return result;
            var n = pts.Length / 2;
            to = Math.Min(to, n - 1);
            for (var i = Math.Max(0, from); i <= to; i++)
                result.Add(new[] { Math.Round(pts[i * 2], 6), Math.Round((double)pts[i * 2 + 1], 6) });
            return result;
        }

        /// <summary>Index of the shape vertex nearest to a point, searching forward from <paramref name="start"/>.</summary>
        public int NearestShapeIndex(string shapeId, double lat, double lon, int start = 0)
        {
            if (!Shapes.TryGetValue(shapeId, out var pts)) return -1;
            var best = -1;
            var bestD = double.MaxValue;
            for (var i = Math.Max(0, start); i < pts.Length / 2; i++)
            {
                var dLat = pts[i * 2] - lat;
                var dLon = (pts[i * 2 + 1] - lon) * 0.74;
                var d = dLat * dLat + dLon * dLon;
                if (d < bestD) { bestD = d; best = i; }
            }
            return best;
        }
    }
}
