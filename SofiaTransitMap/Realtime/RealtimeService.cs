#pragma warning disable CS0612 // Alert.ActivePeriod is marked obsolete in the proto but is what Sofia publishes
using Google.Protobuf;
using Microsoft.Extensions.Options;
using SofiaTransitMap.Gtfs;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Persistence;
using TransitRealtime;

namespace SofiaTransitMap.Realtime
{
    /// <summary>
    /// Polls the GTFS-Realtime feeds, derives per-trip delays against the static schedule,
    /// and periodically persists punctuality snapshots to the database.
    /// </summary>
    public sealed class RealtimeService : BackgroundService
    {
        private readonly GtfsStore _gtfs;
        private readonly RealtimeState _state;
        private readonly IHttpClientFactory _http;
        private readonly IServiceScopeFactory _scopes;
        private readonly GtfsOptions _urls;
        private readonly RealtimeOptions _options;
        private readonly ILogger<RealtimeService> _log;
        private readonly Dictionary<string, (double Lat, double Lon, double? Bearing)> _lastPositions = new();
        private DateTimeOffset _lastAlerts = DateTimeOffset.MinValue;
        private DateTimeOffset _lastPurge = DateTimeOffset.MinValue;

        public RealtimeService(GtfsStore gtfs, RealtimeState state, IHttpClientFactory http, IServiceScopeFactory scopes,
            IOptions<GtfsOptions> urls, IOptions<RealtimeOptions> options, ILogger<RealtimeService> log)
        {
            _gtfs = gtfs; _state = state; _http = http; _scopes = scopes; _urls = urls.Value; _options = options.Value; _log = log;
        }

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            if (!_options.Enabled) return;
            while (!ct.IsCancellationRequested)
            {
                var feed = _gtfs.Current;
                if (feed != null)
                {
                    try
                    {
                        await PollAsync(feed, ct);
                        _state.LastError = null;
                    }
                    catch (Exception ex) when (!ct.IsCancellationRequested)
                    {
                        _state.LastError = ex.Message;
                        _log.LogWarning(ex, "Realtime poll failed");
                    }
                }

                try { await Task.Delay(TimeSpan.FromSeconds(feed == null ? 3 : _options.PollSeconds), ct); }
                catch (TaskCanceledException) { }
            }
        }

        private async Task<FeedMessage> FetchAsync(string url, CancellationToken ct)
        {
            var client = _http.CreateClient("gtfs");
            var bytes = await client.GetByteArrayAsync(url, ct);
            return FeedMessage.Parser.ParseFrom(bytes);
        }

        private async Task PollAsync(GtfsFeed feed, CancellationToken ct)
        {
            var vpTask = FetchAsync(_urls.VehiclePositionsUrl, ct);
            var tuTask = FetchAsync(_urls.TripUpdatesUrl, ct);
            await Task.WhenAll(vpTask, tuTask);

            var trips = BuildPredictions(feed, tuTask.Result);
            var vehicles = BuildVehicles(vpTask.Result, trips);
            _state.Snapshot = new LiveSnapshot
            {
                FetchedAt = DateTimeOffset.UtcNow,
                FeedTimestamp = (long)vpTask.Result.Header.Timestamp,
                Vehicles = vehicles,
                Trips = trips,
            };

            if (DateTimeOffset.UtcNow - _lastAlerts > TimeSpan.FromSeconds(_options.AlertsPollSeconds))
            {
                try
                {
                    _state.Alerts = BuildAlerts(await FetchAsync(_urls.AlertsUrl, ct));
                    _state.AlertsFetchedAt = DateTimeOffset.UtcNow;
                    _lastAlerts = DateTimeOffset.UtcNow;
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    _log.LogWarning(ex, "Alerts poll failed");
                }
            }

            var last = _state.LastSnapshotSaved ?? DateTimeOffset.MinValue;
            if (DateTimeOffset.UtcNow - last >= TimeSpan.FromSeconds(_options.SnapshotSeconds) && vehicles.Count > 0)
            {
                await SaveSnapshotAsync(feed, ct);
                _state.LastSnapshotSaved = DateTimeOffset.UtcNow;
            }
        }

        private static Dictionary<string, TripPrediction> BuildPredictions(GtfsFeed feed, FeedMessage message)
        {
            var result = new Dictionary<string, TripPrediction>();
            foreach (var entity in message.Entity)
            {
                if (entity.TripUpdate == null || entity.IsDeleted) continue;
                var tu = entity.TripUpdate;
                var tripId = tu.Trip?.TripId;
                if (string.IsNullOrEmpty(tripId)) continue;

                var prediction = new TripPrediction { TripId = tripId };
                long? firstTime = null;
                string? firstStop = null;
                foreach (var stu in tu.StopTimeUpdate)
                {
                    var ev = stu.Arrival ?? stu.Departure;
                    if (ev == null || !ev.HasTime || string.IsNullOrEmpty(stu.StopId)) continue;
                    prediction.Stops[stu.StopId] = ev.Time;
                    if (firstTime == null) { firstTime = ev.Time; firstStop = stu.StopId; }
                    if (ev.HasDelay && prediction.DelaySec == null) prediction.DelaySec = ev.Delay;
                }

                var trip = feed.FindTrip(tripId);
                if (trip != null && firstTime != null && firstStop != null)
                {
                    var (delay, date) = DelayAt(feed, trip, firstStop, firstTime.Value);
                    prediction.DelaySec ??= delay;
                    prediction.ServiceDate = date;
                }
                result[tripId] = prediction;
            }
            return result;
        }

        /// <summary>Delay = predicted − scheduled, choosing the service day (today or yesterday) that fits best.</summary>
        public static (int? Delay, DateOnly? Date) DelayAt(GtfsFeed feed, GtfsTrip trip, string stopId, long predictedUnix)
        {
            if (!feed.StopIndex.TryGetValue(stopId, out var stopIdx)) return (null, null);
            var predicted = DateTimeOffset.FromUnixTimeSeconds(predictedUnix);
            var localDate = DateOnly.FromDateTime(SofiaClock.ToLocal(predicted).DateTime);
            int? best = null;
            DateOnly? bestDate = null;
            for (var k = 0; k < trip.StCount; k++)
            {
                var row = trip.StStart + k;
                if (feed.StStop[row] != stopIdx) continue;
                foreach (var date in new[] { localDate, localDate.AddDays(-1) })
                {
                    if (!feed.IsTripActive(trip.Index, date)) continue;
                    var delay = SofiaClock.ToServiceSeconds(date, predicted) - feed.StArr[row];
                    if (best == null || Math.Abs(delay) < Math.Abs(best.Value)) { best = delay; bestDate = date; }
                }
            }
            if (best is int b && Math.Abs(b) > 3 * 3600) return (null, null);
            return (best, bestDate);
        }

        private List<LiveVehicle> BuildVehicles(FeedMessage message, Dictionary<string, TripPrediction> trips)
        {
            var list = new List<LiveVehicle>();
            var seen = new HashSet<string>();
            foreach (var entity in message.Entity)
            {
                var vp = entity.Vehicle;
                if (vp?.Position == null) continue;
                var vehicleId = vp.Vehicle?.Id ?? entity.Id;
                var tripId = vp.Trip?.TripId ?? "";
                var lat = vp.Position.Latitude;
                var lon = vp.Position.Longitude;

                double? bearing = vp.Position.HasBearing ? vp.Position.Bearing : null;
                if (_lastPositions.TryGetValue(vehicleId, out var prev))
                {
                    if (bearing == null)
                    {
                        bearing = Geo.DistanceMeters(prev.Lat, prev.Lon, lat, lon) > 12
                            ? Geo.Bearing(prev.Lat, prev.Lon, lat, lon)
                            : prev.Bearing;
                    }
                }
                _lastPositions[vehicleId] = (lat, lon, bearing);
                seen.Add(vehicleId);

                trips.TryGetValue(tripId, out var prediction);
                list.Add(new LiveVehicle
                {
                    VehicleId = vehicleId,
                    TripId = tripId,
                    RouteId = vp.Trip?.RouteId ?? "",
                    Lat = Math.Round(lat, 6),
                    Lon = Math.Round(lon, 6),
                    Bearing = bearing == null ? null : Math.Round(bearing.Value),
                    Speed = vp.Position.HasSpeed ? vp.Position.Speed : null,
                    DelaySec = prediction?.DelaySec,
                    NextStopId = string.IsNullOrEmpty(vp.StopId) ? null : vp.StopId,
                    Status = vp.HasCurrentStatus ? vp.CurrentStatus.ToString() : null,
                    Occupancy = vp.HasOccupancyStatus ? vp.OccupancyStatus.ToString() : null,
                    Timestamp = (long)vp.Timestamp,
                });
            }
            foreach (var stale in _lastPositions.Keys.Where(k => !seen.Contains(k)).ToList())
                _lastPositions.Remove(stale);
            return list;
        }

        private static List<LiveAlert> BuildAlerts(FeedMessage message)
        {
            static string? Text(TranslatedString? ts, string lang)
            {
                if (ts == null) return null;
                var t = ts.Translation.FirstOrDefault(x => x.Language == lang) ?? ts.Translation.FirstOrDefault();
                return string.IsNullOrWhiteSpace(t?.Text) ? null : t!.Text;
            }

            return message.Entity.Where(e => e.Alert != null).Select(e => new LiveAlert
            {
                Id = e.Id,
                HeaderBg = Text(e.Alert.HeaderText, "bg"),
                HeaderEn = Text(e.Alert.HeaderText, "en"),
                DescriptionBg = Text(e.Alert.DescriptionText, "bg"),
                DescriptionEn = Text(e.Alert.DescriptionText, "en"),
                Cause = e.Alert.HasCause ? e.Alert.Cause.ToString() : "UnknownCause",
                Effect = e.Alert.HasEffect ? e.Alert.Effect.ToString() : "UnknownEffect",
                Start = e.Alert.ActivePeriod.Select(p => p.HasStart ? (long?)p.Start : null).Min(),
                End = e.Alert.ActivePeriod.Select(p => p.HasEnd ? (long?)p.End : null).Max(),
                Url = Text(e.Alert.Url, "bg"),
                RouteIds = e.Alert.InformedEntity.Where(i => !string.IsNullOrEmpty(i.RouteId)).Select(i => i.RouteId).Distinct().ToList(),
                StopIds = e.Alert.InformedEntity.Where(i => !string.IsNullOrEmpty(i.StopId)).Select(i => i.StopId).Distinct().ToList(),
            }).ToList();
        }

        private async Task SaveSnapshotAsync(GtfsFeed feed, CancellationToken ct)
        {
            var (network, routes) = LiveStatsCalculator.Compute(_state.Snapshot, feed, _options);
            var now = DateTime.UtcNow;
            var local = SofiaClock.ToLocal(DateTimeOffset.UtcNow);

            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<TransitDb>();
            db.NetworkSnapshots.Add(new NetworkSnapshot
            {
                TimestampUtc = now,
                LocalDate = local.ToString("yyyy-MM-dd"),
                LocalHour = local.Hour,
                DayOfWeek = (int)local.DayOfWeek,
                Vehicles = network.Vehicles,
                Tracked = network.Tracked,
                Delayed = network.Delayed,
                Severe = network.Severe,
                Early = network.Early,
                OnTime = network.OnTime,
                AvgDelaySec = Math.Round(network.AvgDelaySec, 1),
                MedianDelaySec = network.MedianDelaySec,
                P90DelaySec = network.P90DelaySec,
                MaxDelaySec = network.MaxDelaySec,
                ActiveAlerts = _state.ActiveAlerts().Count(),
            });
            db.RouteSnapshots.AddRange(routes.Select(r => new RouteSnapshot
            {
                TimestampUtc = now,
                LocalHour = local.Hour,
                RouteId = r.RouteId,
                ShortName = r.ShortName,
                Mode = r.Mode,
                Vehicles = r.Vehicles,
                Tracked = r.Tracked,
                Delayed = r.Delayed,
                SumDelaySec = r.SumDelaySec,
                MaxDelaySec = r.MaxDelaySec,
            }));
            await db.SaveChangesAsync(ct);

            if (DateTimeOffset.UtcNow - _lastPurge > TimeSpan.FromHours(6))
            {
                var cutoff = now.AddDays(-_options.RetentionDays);
                await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ExecuteDeleteAsync(
                    db.RouteSnapshots.Where(x => x.TimestampUtc < cutoff), ct);
                await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions.ExecuteDeleteAsync(
                    db.NetworkSnapshots.Where(x => x.TimestampUtc < cutoff), ct);
                _lastPurge = DateTimeOffset.UtcNow;
            }
        }
    }
}
