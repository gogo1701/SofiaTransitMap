using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using SofiaTransitMap.Gtfs;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;
using SofiaTransitMap.Persistence;
using SofiaTransitMap.Realtime;

namespace SofiaTransitMap.Controllers
{
    /// <summary>
    /// Punctuality statistics. "live" is computed from the current realtime snapshot;
    /// everything else aggregates the snapshots stored in SQLite by <see cref="RealtimeService"/>.
    /// </summary>
    [Route("api/stats")]
    [ApiController]
    public class StatsController : ControllerBase
    {
        private readonly TransitDb _db;
        private readonly GtfsStore _store;
        private readonly RealtimeState _realtime;
        private readonly RealtimeOptions _options;

        public StatsController(TransitDb db, GtfsStore store, RealtimeState realtime, IOptions<RealtimeOptions> options)
        {
            _db = db;
            _store = store;
            _realtime = realtime;
            _options = options.Value;
        }

        private static DateTime Since(int hours) => DateTime.UtcNow.AddHours(-Math.Clamp(hours, 1, 24 * 90));

        [HttpGet("live")]
        public IActionResult Live([FromQuery] int top = 12)
        {
            var feed = _store.Require();
            var snap = _realtime.Snapshot;
            var (network, routes) = LiveStatsCalculator.Compute(snap, feed, _options);
            return Ok(new
            {
                fetchedAt = snap.FetchedAt == DateTimeOffset.MinValue ? (DateTimeOffset?)null : snap.FetchedAt,
                fresh = _realtime.IsFresh,
                thresholds = new { delayed = _options.DelayedThresholdSeconds, severe = _options.SevereThresholdSeconds, early = _options.EarlyThresholdSeconds },
                network,
                histogramEdgesMin = LiveStatsCalculator.HistogramEdgesMin,
                activeAlerts = _realtime.ActiveAlerts().Count(),
                worstLines = routes.Where(r => r.Tracked > 0)
                    .OrderByDescending(r => r.AvgDelaySec).ThenByDescending(r => r.Delayed)
                    .Take(Math.Clamp(top, 1, 50))
                    .Select(r => new { r.RouteId, r.ShortName, r.Mode, r.Color, r.Vehicles, r.Tracked, r.Delayed, avgDelaySec = Math.Round(r.AvgDelaySec), r.MaxDelaySec }),
            });
        }

        [HttpGet("summary")]
        public async Task<IActionResult> Summary([FromQuery] int hours = 24, CancellationToken ct = default)
        {
            var since = Since(hours);
            var rows = await _db.NetworkSnapshots.AsNoTracking().Where(s => s.TimestampUtc >= since)
                .Select(s => new { s.Vehicles, s.Tracked, s.Delayed, s.Severe, s.OnTime, s.AvgDelaySec, s.MaxDelaySec, s.P90DelaySec, s.TimestampUtc })
                .ToListAsync(ct);
            if (rows.Count == 0) return Ok(new { hours, samples = 0 });

            var tracked = rows.Sum(r => r.Tracked);
            var peak = rows.MaxBy(r => r.Delayed)!;
            return Ok(new
            {
                hours,
                samples = rows.Count,
                from = DateTime.SpecifyKind(rows.Min(r => r.TimestampUtc), DateTimeKind.Utc),
                to = DateTime.SpecifyKind(rows.Max(r => r.TimestampUtc), DateTimeKind.Utc),
                avgVehicles = Math.Round(rows.Average(r => r.Vehicles), 1),
                avgDelayed = Math.Round(rows.Average(r => r.Delayed), 1),
                avgDelaySec = tracked == 0 ? 0 : Math.Round(rows.Sum(r => r.AvgDelaySec * r.Tracked) / tracked, 1),
                delayedShare = tracked == 0 ? 0 : Math.Round((double)rows.Sum(r => r.Delayed) / tracked, 4),
                onTimeShare = tracked == 0 ? 0 : Math.Round((double)rows.Sum(r => r.OnTime) / tracked, 4),
                severeShare = tracked == 0 ? 0 : Math.Round((double)rows.Sum(r => r.Severe) / tracked, 4),
                avgP90Sec = Math.Round(rows.Average(r => r.P90DelaySec)),
                maxDelaySec = rows.Max(r => r.MaxDelaySec),
                peakDelayed = peak.Delayed,
                peakAt = DateTime.SpecifyKind(peak.TimestampUtc, DateTimeKind.Utc),
            });
        }

        [HttpGet("timeseries")]
        public async Task<IActionResult> Timeseries([FromQuery] int hours = 24, CancellationToken ct = default)
        {
            var since = Since(hours);
            var rows = await _db.NetworkSnapshots.AsNoTracking().Where(s => s.TimestampUtc >= since)
                .OrderBy(s => s.TimestampUtc).ToListAsync(ct);

            // Keep roughly 150 points regardless of the window.
            var bucketMin = Math.Max(_options.SnapshotSeconds / 60, (int)Math.Ceiling(hours * 60 / 150.0));
            var bucketTicks = TimeSpan.FromMinutes(bucketMin).Ticks;
            var points = rows
                .GroupBy(r => r.TimestampUtc.Ticks / bucketTicks)
                .Select(g =>
                {
                    var tracked = g.Sum(r => r.Tracked);
                    return new
                    {
                        t = DateTime.SpecifyKind(new DateTime(g.Key * bucketTicks), DateTimeKind.Utc),
                        vehicles = Math.Round(g.Average(r => r.Vehicles), 1),
                        tracked = Math.Round(g.Average(r => r.Tracked), 1),
                        delayed = Math.Round(g.Average(r => r.Delayed), 1),
                        severe = Math.Round(g.Average(r => r.Severe), 1),
                        avgDelaySec = tracked == 0 ? 0 : Math.Round(g.Sum(r => r.AvgDelaySec * r.Tracked) / tracked, 1),
                        p90DelaySec = Math.Round(g.Average(r => r.P90DelaySec)),
                        delayedShare = tracked == 0 ? 0 : Math.Round((double)g.Sum(r => r.Delayed) / tracked, 4),
                    };
                })
                .ToList();
            return Ok(new { hours, bucketMinutes = bucketMin, points });
        }

        [HttpGet("hourly")]
        public async Task<IActionResult> Hourly([FromQuery] int days = 7, CancellationToken ct = default)
        {
            var since = Since(days * 24);
            var rows = await _db.NetworkSnapshots.AsNoTracking().Where(s => s.TimestampUtc >= since)
                .GroupBy(s => s.LocalHour)
                .Select(g => new
                {
                    hour = g.Key,
                    samples = g.Count(),
                    vehicles = g.Average(r => r.Vehicles),
                    delayed = g.Average(r => r.Delayed),
                    tracked = g.Sum(r => r.Tracked),
                    weighted = g.Sum(r => r.AvgDelaySec * r.Tracked),
                    delayedSum = g.Sum(r => r.Delayed),
                })
                .ToListAsync(ct);
            var byHour = rows.ToDictionary(r => r.hour);
            return Ok(new
            {
                days,
                hours = Enumerable.Range(0, 24).Select(h => byHour.TryGetValue(h, out var r)
                    ? new
                    {
                        hour = h, r.samples,
                        vehicles = Math.Round(r.vehicles, 1),
                        delayed = Math.Round(r.delayed, 1),
                        avgDelaySec = r.tracked == 0 ? 0 : Math.Round(r.weighted / r.tracked, 1),
                        delayedShare = r.tracked == 0 ? 0 : Math.Round((double)r.delayedSum / r.tracked, 4),
                    }
                    : new { hour = h, samples = 0, vehicles = 0.0, delayed = 0.0, avgDelaySec = 0.0, delayedShare = 0.0 }),
            });
        }

        [HttpGet("weekday")]
        public async Task<IActionResult> Weekday([FromQuery] int days = 28, CancellationToken ct = default)
        {
            var since = Since(days * 24);
            var rows = await _db.NetworkSnapshots.AsNoTracking().Where(s => s.TimestampUtc >= since)
                .GroupBy(s => s.DayOfWeek)
                .Select(g => new
                {
                    day = g.Key,
                    samples = g.Count(),
                    delayed = g.Average(r => r.Delayed),
                    tracked = g.Sum(r => r.Tracked),
                    weighted = g.Sum(r => r.AvgDelaySec * r.Tracked),
                })
                .ToListAsync(ct);
            return Ok(rows.OrderBy(r => (r.day + 6) % 7).Select(r => new
            {
                r.day, r.samples,
                delayed = Math.Round(r.delayed, 1),
                avgDelaySec = r.tracked == 0 ? 0 : Math.Round(r.weighted / r.tracked, 1),
            }));
        }

        [HttpGet("modes")]
        public async Task<IActionResult> Modes([FromQuery] int hours = 24, CancellationToken ct = default)
        {
            var since = Since(hours);
            var samples = Math.Max(1, await _db.NetworkSnapshots.CountAsync(s => s.TimestampUtc >= since, ct));
            var rows = await _db.RouteSnapshots.AsNoTracking().Where(s => s.TimestampUtc >= since)
                .GroupBy(s => s.Mode)
                .Select(g => new
                {
                    mode = g.Key,
                    vehicles = g.Sum(r => r.Vehicles),
                    tracked = g.Sum(r => r.Tracked),
                    delayed = g.Sum(r => r.Delayed),
                    sumDelay = g.Sum(r => r.SumDelaySec),
                })
                .ToListAsync(ct);
            return Ok(rows.OrderBy(r => GtfsLoader.ModePriority(r.mode)).Select(r => new
            {
                r.mode,
                avgVehicles = Math.Round((double)r.vehicles / samples, 1),
                avgDelayed = Math.Round((double)r.delayed / samples, 1),
                avgDelaySec = r.tracked == 0 ? 0 : Math.Round(r.sumDelay / r.tracked, 1),
                delayedShare = r.tracked == 0 ? 0 : Math.Round((double)r.delayed / r.tracked, 4),
            }));
        }

        [HttpGet("mode-lines")]
        public async Task<IActionResult> ModeLines([FromQuery] int hours = 24, CancellationToken ct = default)
        {
            var since = Since(hours);
            var samples = Math.Max(1, await _db.NetworkSnapshots.CountAsync(s => s.TimestampUtc >= since, ct));
            var routeStats = await _db.RouteSnapshots.AsNoTracking()
                .Where(s => s.TimestampUtc >= since)
                .GroupBy(s => new { s.Mode, s.RouteId })
                .Select(g => new
                {
                    mode = g.Key.Mode,
                    routeId = g.Key.RouteId,
                    samples = g.Count(),
                    vehicles = g.Sum(r => r.Vehicles),
                    tracked = g.Sum(r => r.Tracked),
                    delayed = g.Sum(r => r.Delayed),
                    sumDelay = g.Sum(r => r.SumDelaySec),
                    maxDelay = g.Max(r => r.MaxDelaySec),
                })
                .ToListAsync(ct);

            var modes = routeStats.GroupBy(r => r.mode)
                .OrderBy(g => GtfsLoader.ModePriority(g.Key))
                .Select(g =>
                {
                    var tracked = g.Sum(r => r.tracked);
                    var delayed = g.Sum(r => r.delayed);
                    return new
                    {
                        mode = g.Key,
                        avgVehicles = Math.Round((double)g.Sum(r => r.vehicles) / samples, 1),
                        avgDelayed = Math.Round((double)delayed / samples, 1),
                        avgDelaySec = tracked == 0 ? 0 : Math.Round(g.Sum(r => r.sumDelay) / tracked, 1),
                        delayedShare = tracked == 0 ? 0 : Math.Round((double)delayed / tracked, 4),
                    };
                })
                .ToList();

            var feed = _store.Current;
            var lines = routeStats.Select(r =>
                {
                    var route = feed?.FindRoute(r.routeId);
                    return new
                    {
                        r.routeId,
                        shortName = route?.ShortName ?? r.routeId,
                        mode = route?.Mode ?? r.mode,
                        color = route?.Color ?? "6B7280",
                        textColor = route?.TextColor ?? "FFFFFF",
                        r.samples,
                        avgVehicles = Math.Round((double)r.vehicles / r.samples, 1),
                        avgDelaySec = r.tracked == 0 ? 0 : Math.Round(r.sumDelay / r.tracked, 1),
                        delayedShare = r.tracked == 0 ? 0 : Math.Round((double)r.delayed / r.tracked, 4),
                        maxDelaySec = r.maxDelay,
                        tracked = r.tracked,
                    };
                })
                .OrderByDescending(r => r.avgDelaySec)
                .ToList();

            return Ok(new { modes, lines });
        }

        [HttpGet("lines")]
        public async Task<IActionResult> Lines([FromQuery] int hours = 24, [FromQuery] TransitType? mode = null, CancellationToken ct = default)
        {
            var since = Since(hours);
            var query = _db.RouteSnapshots.AsNoTracking().Where(s => s.TimestampUtc >= since);
            if (mode.HasValue) query = query.Where(s => s.Mode == mode.Value);
            var rows = await query
                .GroupBy(s => s.RouteId)
                .Select(g => new
                {
                    routeId = g.Key,
                    samples = g.Count(),
                    vehicles = g.Sum(r => r.Vehicles),
                    tracked = g.Sum(r => r.Tracked),
                    delayed = g.Sum(r => r.Delayed),
                    sumDelay = g.Sum(r => r.SumDelaySec),
                    maxDelay = g.Max(r => r.MaxDelaySec),
                })
                .ToListAsync(ct);

            var feed = _store.Current;
            return Ok(rows
                .Select(r =>
                {
                    var route = feed?.FindRoute(r.routeId);
                    return new
                    {
                        r.routeId,
                        shortName = route?.ShortName ?? r.routeId,
                        mode = route?.Mode ?? TransitType.Unknown,
                        color = route?.Color ?? "6B7280",
                        textColor = route?.TextColor ?? "FFFFFF",
                        r.samples,
                        avgVehicles = Math.Round((double)r.vehicles / r.samples, 1),
                        avgDelaySec = r.tracked == 0 ? 0 : Math.Round(r.sumDelay / r.tracked, 1),
                        delayedShare = r.tracked == 0 ? 0 : Math.Round((double)r.delayed / r.tracked, 4),
                        maxDelaySec = r.maxDelay,
                        tracked = r.tracked,
                    };
                })
                .OrderByDescending(r => r.avgDelaySec));
        }

        [HttpGet("lines/{routeId}")]
        public async Task<IActionResult> Line(string routeId, [FromQuery] int hours = 24, CancellationToken ct = default)
        {
            var since = Since(hours);
            var rows = await _db.RouteSnapshots.AsNoTracking()
                .Where(s => s.RouteId == routeId && s.TimestampUtc >= since)
                .OrderBy(s => s.TimestampUtc)
                .Select(s => new { s.TimestampUtc, s.LocalHour, s.Vehicles, s.Tracked, s.Delayed, s.SumDelaySec, s.MaxDelaySec })
                .ToListAsync(ct);

            var bucketMin = Math.Max(_options.SnapshotSeconds / 60, (int)Math.Ceiling(hours * 60 / 120.0));
            var bucketTicks = TimeSpan.FromMinutes(bucketMin).Ticks;
            var route = _store.Current?.FindRoute(routeId);
            var tracked = rows.Sum(r => r.Tracked);
            return Ok(new
            {
                route = route == null ? null : RouteDto.From(route),
                hours,
                samples = rows.Count,
                avgDelaySec = tracked == 0 ? 0 : Math.Round(rows.Sum(r => r.SumDelaySec) / tracked, 1),
                delayedShare = tracked == 0 ? 0 : Math.Round((double)rows.Sum(r => r.Delayed) / tracked, 4),
                maxDelaySec = rows.Count == 0 ? 0 : rows.Max(r => r.MaxDelaySec),
                points = rows.GroupBy(r => r.TimestampUtc.Ticks / bucketTicks).Select(g =>
                {
                    var t = g.Sum(r => r.Tracked);
                    return new
                    {
                        t = DateTime.SpecifyKind(new DateTime(g.Key * bucketTicks), DateTimeKind.Utc),
                        vehicles = Math.Round(g.Average(r => r.Vehicles), 1),
                        delayed = Math.Round(g.Average(r => r.Delayed), 1),
                        avgDelaySec = t == 0 ? 0 : Math.Round(g.Sum(r => r.SumDelaySec) / t, 1),
                    };
                }),
                hourly = rows.GroupBy(r => r.LocalHour).OrderBy(g => g.Key).Select(g =>
                {
                    var t = g.Sum(r => r.Tracked);
                    return new { hour = g.Key, avgDelaySec = t == 0 ? 0 : Math.Round(g.Sum(r => r.SumDelaySec) / t, 1) };
                }),
            });
        }
    }
}
