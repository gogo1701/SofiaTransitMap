using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;

namespace SofiaTransitMap.Infrastructure
{
    public sealed record GeoPlace(string Label, string? Detail, double Lat, double Lon, string Kind, string? StopId = null);

    /// <summary>
    /// Address search through OpenStreetMap Nominatim, bounded to Sofia.
    /// Respects the public usage policy: identifying User-Agent, max one request per second, cached answers.
    /// </summary>
    public sealed class GeocodingService
    {
        private const string Viewbox = "23.10,42.80,23.60,42.55";
        private readonly IHttpClientFactory _http;
        private readonly ILogger<GeocodingService> _log;
        private readonly SemaphoreSlim _gate = new(1, 1);
        private readonly ConcurrentDictionary<string, (DateTimeOffset At, List<GeoPlace> Places)> _cache = new();
        private DateTimeOffset _lastCall = DateTimeOffset.MinValue;

        public GeocodingService(IHttpClientFactory http, ILogger<GeocodingService> log)
        {
            _http = http;
            _log = log;
        }

        public async Task<List<GeoPlace>> SearchAsync(string query, string lang, CancellationToken ct)
        {
            var url = "search?format=jsonv2&addressdetails=1&limit=6&bounded=1&countrycodes=bg" +
                      $"&viewbox={Viewbox}&accept-language={lang}&q={Uri.EscapeDataString(query)}";
            return await CachedAsync(url, async doc =>
            {
                var list = new List<GeoPlace>();
                foreach (var item in doc.RootElement.EnumerateArray())
                    list.Add(ToPlace(item));
                return list;
            }, ct);
        }

        public async Task<GeoPlace?> ReverseAsync(double lat, double lon, string lang, CancellationToken ct)
        {
            var url = FormattableString.Invariant($"reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language={lang}&lat={lat:F5}&lon={lon:F5}");
            var list = await CachedAsync(url, doc => Task.FromResult(
                doc.RootElement.TryGetProperty("lat", out _) ? new List<GeoPlace> { ToPlace(doc.RootElement) } : new List<GeoPlace>()), ct);
            return list.FirstOrDefault();
        }

        private async Task<List<GeoPlace>> CachedAsync(string url, Func<JsonDocument, Task<List<GeoPlace>>> map, CancellationToken ct)
        {
            if (_cache.TryGetValue(url, out var hit) && DateTimeOffset.UtcNow - hit.At < TimeSpan.FromHours(12))
                return hit.Places;

            await _gate.WaitAsync(ct);
            try
            {
                var wait = TimeSpan.FromSeconds(1.05) - (DateTimeOffset.UtcNow - _lastCall);
                if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
                _lastCall = DateTimeOffset.UtcNow;

                var client = _http.CreateClient("nominatim");
                using var response = await client.GetAsync(url, ct);
                response.EnsureSuccessStatusCode();
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
                var places = await map(doc);
                _cache[url] = (DateTimeOffset.UtcNow, places);
                if (_cache.Count > 2000)
                    foreach (var old in _cache.OrderBy(x => x.Value.At).Take(500)) _cache.TryRemove(old.Key, out _);
                return places;
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException && !ct.IsCancellationRequested)
            {
                _log.LogWarning(ex, "Geocoding request failed");
                return new List<GeoPlace>();
            }
            finally
            {
                _gate.Release();
            }
        }

        private static GeoPlace ToPlace(JsonElement item)
        {
            var lat = double.Parse(item.GetProperty("lat").GetString()!, CultureInfo.InvariantCulture);
            var lon = double.Parse(item.GetProperty("lon").GetString()!, CultureInfo.InvariantCulture);
            var display = item.TryGetProperty("display_name", out var dn) ? dn.GetString() ?? "" : "";
            string label = display;
            string? detail = null;

            if (item.TryGetProperty("address", out var addr))
            {
                string? Get(string key) => addr.TryGetProperty(key, out var v) ? v.GetString() : null;
                var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
                var road = Get("road") ?? Get("pedestrian") ?? Get("square");
                var number = Get("house_number");
                var street = road == null ? null : number == null ? road : $"{road} {number}";
                label = !string.IsNullOrWhiteSpace(name) ? name! : street ?? display.Split(',')[0];
                var area = Get("suburb") ?? Get("quarter") ?? Get("neighbourhood") ?? Get("city_district") ?? Get("village") ?? Get("city");
                detail = string.Join(", ", new[] { street != label ? street : null, area }.Where(s => !string.IsNullOrWhiteSpace(s)));
                if (string.IsNullOrWhiteSpace(detail)) detail = null;
            }
            var kind = item.TryGetProperty("category", out var cat) ? cat.GetString() ?? "place" : "place";
            return new GeoPlace(label, detail, lat, lon, kind);
        }
    }
}
