using SofiaTransitMap.Gtfs;

namespace SofiaTransitMap.Infrastructure
{
    public sealed class GtfsOptions
    {
        public string StaticUrl { get; set; } = "https://gtfs.sofiatraffic.bg/api/v1/static";
        public string VehiclePositionsUrl { get; set; } = "https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions";
        public string TripUpdatesUrl { get; set; } = "https://gtfs.sofiatraffic.bg/api/v1/trip-updates";
        public string AlertsUrl { get; set; } = "https://gtfs.sofiatraffic.bg/api/v1/alerts";
        public double StaticRefreshHours { get; set; } = 12;
        public string CacheDirectory { get; set; } = "App_Data/gtfs";
        public string BundledDirectory { get; set; } = "Data";
    }

    public sealed class FeedNotReadyException : Exception
    {
        public FeedNotReadyException() : base("The GTFS schedule is still loading. Try again in a few seconds.") { }
    }

    /// <summary>Holds the active static GTFS feed; swapped atomically when a fresher feed is downloaded.</summary>
    public sealed class GtfsStore
    {
        private volatile GtfsFeed? _feed;

        public GtfsFeed? Current => _feed;
        public string State { get; private set; } = "starting";
        public string? LastError { get; private set; }
        public DateTimeOffset? LastDownload { get; set; }

        public GtfsFeed Require() => _feed ?? throw new FeedNotReadyException();

        public void Publish(GtfsFeed feed)
        {
            _feed = feed;
            State = "ready";
        }

        public void SetState(string state, string? error = null)
        {
            State = _feed == null ? state : "ready";
            LastError = error;
        }
    }

    /// <summary>Downloads the static feed from the Sofia Urban Mobility Centre API and keeps it fresh.</summary>
    public sealed class GtfsSyncService : BackgroundService
    {
        private readonly GtfsStore _store;
        private readonly IHttpClientFactory _http;
        private readonly GtfsOptions _options;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<GtfsSyncService> _log;

        public GtfsSyncService(GtfsStore store, IHttpClientFactory http, Microsoft.Extensions.Options.IOptions<GtfsOptions> options,
            IWebHostEnvironment env, ILogger<GtfsSyncService> log)
        {
            _store = store; _http = http; _options = options.Value; _env = env; _log = log;
        }

        private string CacheZip => Path.Combine(_env.ContentRootPath, _options.CacheDirectory, "gtfs-static.zip");

        protected override async Task ExecuteAsync(CancellationToken ct)
        {
            await Task.Yield();
            _store.SetState("loading");
            try
            {
                if (File.Exists(CacheZip))
                {
                    Publish(() => GtfsLoader.LoadZip(CacheZip, "api-cache"));
                    _store.LastDownload = File.GetLastWriteTimeUtc(CacheZip);
                }
                else
                {
                    var bundled = Path.Combine(_env.ContentRootPath, _options.BundledDirectory);
                    if (File.Exists(Path.Combine(bundled, "stops.txt")))
                        Publish(() => GtfsLoader.LoadDirectory(bundled, "bundled"));
                }
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Failed to load cached GTFS feed");
            }

            while (!ct.IsCancellationRequested)
            {
                var age = File.Exists(CacheZip) ? DateTime.UtcNow - File.GetLastWriteTimeUtc(CacheZip) : TimeSpan.MaxValue;
                if (age.TotalHours >= _options.StaticRefreshHours || _store.Current == null)
                {
                    try
                    {
                        await DownloadAsync(ct);
                        Publish(() => GtfsLoader.LoadZip(CacheZip, "api"));
                        _store.LastDownload = DateTimeOffset.UtcNow;
                    }
                    catch (Exception ex) when (!ct.IsCancellationRequested)
                    {
                        _log.LogWarning(ex, "GTFS static download failed");
                        _store.SetState(_store.Current == null ? "error" : "ready", ex.Message);
                    }
                }

                try { await Task.Delay(TimeSpan.FromMinutes(_store.Current == null ? 1 : 30), ct); }
                catch (TaskCanceledException) { }
            }
        }

        private void Publish(Func<GtfsFeed> load)
        {
            var sw = System.Diagnostics.Stopwatch.StartNew();
            var feed = load();
            _store.Publish(feed);
            _log.LogInformation("GTFS feed {Version} loaded from {Source}: {Stops} stops, {Routes} routes, {Trips} trips in {Ms} ms",
                feed.FeedVersion, feed.Source, feed.Stops.Count, feed.Routes.Count, feed.Trips.Count, sw.ElapsedMilliseconds);
            GC.Collect(2, GCCollectionMode.Optimized, false);
        }

        private async Task DownloadAsync(CancellationToken ct)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(CacheZip)!);
            var tmp = CacheZip + ".download";
            var client = _http.CreateClient("gtfs");
            client.Timeout = TimeSpan.FromMinutes(5);
            _log.LogInformation("Downloading GTFS static feed from {Url}", _options.StaticUrl);
            using (var response = await client.GetAsync(_options.StaticUrl, HttpCompletionOption.ResponseHeadersRead, ct))
            {
                response.EnsureSuccessStatusCode();
                await using var fs = File.Create(tmp);
                await response.Content.CopyToAsync(fs, ct);
            }
            using (System.IO.Compression.ZipFile.OpenRead(tmp)) { }
            File.Move(tmp, CacheZip, overwrite: true);
        }
    }
}
