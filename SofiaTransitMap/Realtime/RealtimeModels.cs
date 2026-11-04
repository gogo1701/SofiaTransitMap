using SofiaTransitMap.Gtfs;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;

namespace SofiaTransitMap.Realtime
{
    public sealed class RealtimeOptions
    {
        public int PollSeconds { get; set; } = 20;
        public int AlertsPollSeconds { get; set; } = 300;
        public int SnapshotSeconds { get; set; } = 120;
        public int DelayedThresholdSeconds { get; set; } = 180;
        public int SevereThresholdSeconds { get; set; } = 600;
        public int EarlyThresholdSeconds { get; set; } = -60;
        public int RetentionDays { get; set; } = 90;
        public bool Enabled { get; set; } = true;
    }

    public sealed class LiveVehicle
    {
        public string VehicleId { get; init; } = "";
        public string TripId { get; init; } = "";
        public string RouteId { get; init; } = "";
        public double Lat { get; init; }
        public double Lon { get; init; }
        public double? Bearing { get; set; }
        public double? Speed { get; init; }
        public int? DelaySec { get; set; }
        public string? NextStopId { get; init; }
        public string? Status { get; init; }
        public string? Occupancy { get; init; }
        public long Timestamp { get; init; }
    }

    public sealed class TripPrediction
    {
        public string TripId { get; init; } = "";
        public int? DelaySec { get; set; }
        public DateOnly? ServiceDate { get; set; }
        /// <summary>stop_id → predicted arrival (unix seconds).</summary>
        public Dictionary<string, long> Stops { get; } = new();
    }

    public sealed class LiveAlert
    {
        public string Id { get; init; } = "";
        public string? HeaderBg { get; init; }
        public string? HeaderEn { get; init; }
        public string? DescriptionBg { get; init; }
        public string? DescriptionEn { get; init; }
        public string Cause { get; init; } = "";
        public string Effect { get; init; } = "";
        public long? Start { get; init; }
        public long? End { get; init; }
        public string? Url { get; init; }
        public List<string> RouteIds { get; init; } = new();
        public List<string> StopIds { get; init; } = new();
    }

    public sealed class LiveSnapshot
    {
        public DateTimeOffset FetchedAt { get; init; }
        public long FeedTimestamp { get; init; }
        public List<LiveVehicle> Vehicles { get; init; } = new();
        public Dictionary<string, TripPrediction> Trips { get; init; } = new();

        public static readonly LiveSnapshot Empty = new() { FetchedAt = DateTimeOffset.MinValue };
    }

    public sealed class RealtimeState
    {
        private volatile LiveSnapshot _snapshot = LiveSnapshot.Empty;
        private volatile List<LiveAlert> _alerts = new();

        public LiveSnapshot Snapshot { get => _snapshot; set => _snapshot = value; }
        public List<LiveAlert> Alerts { get => _alerts; set => _alerts = value; }
        public DateTimeOffset? AlertsFetchedAt { get; set; }
        public string? LastError { get; set; }
        public DateTimeOffset? LastSnapshotSaved { get; set; }

        public bool IsFresh => DateTimeOffset.UtcNow - _snapshot.FetchedAt < TimeSpan.FromMinutes(3);

        public IEnumerable<LiveAlert> ActiveAlerts()
        {
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            return _alerts.Where(a => (a.Start == null || a.Start <= now) && (a.End == null || a.End >= now));
        }
    }

    public sealed record NetworkStats(
        int Vehicles, int Tracked, int Delayed, int Severe, int Early, int OnTime,
        double AvgDelaySec, int MedianDelaySec, int P90DelaySec, int MaxDelaySec,
        Dictionary<TransitType, ModeStats> Modes, int[] Histogram);

    public sealed record ModeStats(int Vehicles, int Tracked, int Delayed, double AvgDelaySec);

    public sealed record RouteStats(
        string RouteId, string ShortName, TransitType Mode, string Color,
        int Vehicles, int Tracked, int Delayed, double SumDelaySec, int MaxDelaySec)
    {
        public double AvgDelaySec => Tracked == 0 ? 0 : SumDelaySec / Tracked;
    }

    public static class LiveStatsCalculator
    {
        /// <summary>Histogram bucket edges in minutes; values are counts of vehicles whose delay falls in [edge_i, edge_i+1).</summary>
        public static readonly int[] HistogramEdgesMin = { -5, -1, 1, 3, 5, 10, 15, 20 };

        public static (NetworkStats Network, List<RouteStats> Routes) Compute(LiveSnapshot snap, GtfsFeed feed, RealtimeOptions o)
        {
            var vehicles = snap.Vehicles
                .Where(v => feed.RouteIndex.ContainsKey(v.RouteId))
                .GroupBy(v => string.IsNullOrEmpty(v.TripId) ? v.VehicleId : v.TripId)
                .Select(g => g.First())
                .ToList();

            var delays = new List<int>();
            int delayed = 0, severe = 0, early = 0, onTime = 0;
            var hist = new int[HistogramEdgesMin.Length + 1];
            var modes = new Dictionary<TransitType, (int V, int T, int D, double S)>();
            var routes = new Dictionary<string, (int V, int T, int D, double S, int M)>();

            foreach (var v in vehicles)
            {
                var route = feed.FindRoute(v.RouteId)!;
                modes.TryGetValue(route.Mode, out var m);
                routes.TryGetValue(route.Id, out var r);
                m.V++; r.V++;
                if (v.DelaySec is int d)
                {
                    delays.Add(d);
                    var late = Math.Max(0, d);
                    m.T++; r.T++;
                    m.S += late; r.S += late;
                    r.M = Math.Max(r.M, d);
                    if (d >= o.DelayedThresholdSeconds) { delayed++; m.D++; r.D++; }
                    if (d >= o.SevereThresholdSeconds) severe++;
                    if (d <= o.EarlyThresholdSeconds) early++;
                    if (d > o.EarlyThresholdSeconds && d < o.DelayedThresholdSeconds) onTime++;
                    var bucket = 0;
                    while (bucket < HistogramEdgesMin.Length && d >= HistogramEdgesMin[bucket] * 60) bucket++;
                    hist[bucket]++;
                }
                modes[route.Mode] = m;
                routes[route.Id] = r;
            }

            delays.Sort();
            int Pct(double p) => delays.Count == 0 ? 0 : delays[Math.Min(delays.Count - 1, (int)(p * delays.Count))];

            var network = new NetworkStats(
                vehicles.Count, delays.Count, delayed, severe, early, onTime,
                delays.Count == 0 ? 0 : delays.Average(d => Math.Max(0, d)),
                Pct(0.5), Pct(0.9), delays.Count == 0 ? 0 : delays[^1],
                modes.ToDictionary(k => k.Key, k => new ModeStats(k.Value.V, k.Value.T, k.Value.D, k.Value.T == 0 ? 0 : k.Value.S / k.Value.T)),
                hist);

            var routeStats = routes.Select(kv =>
            {
                var route = feed.FindRoute(kv.Key)!;
                return new RouteStats(route.Id, route.ShortName, route.Mode, route.Color,
                    kv.Value.V, kv.Value.T, kv.Value.D, kv.Value.S, kv.Value.M);
            }).ToList();

            return (network, routeStats);
        }
    }
}
