using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;

namespace SofiaTransitMap.Infrastructure
{
    /// <summary>A search result. Google suggestions carry only a <see cref="PlaceId"/>; coordinates are resolved on pick.</summary>
    public sealed record GeoPlace(string Label, string? Detail, double? Lat, double? Lon, string Kind,
        string? StopId = null, string? PlaceId = null, string Source = "osm");

    /// <summary>
    /// Place search bounded to Sofia. Uses Google Places (autocomplete + details) when <c>Geocoding:GoogleApiKey</c> is set,
    /// otherwise OpenStreetMap: Photon for type-ahead (partial words, businesses) merged with Nominatim.
    /// Reverse geocoding always uses Nominatim. Nominatim's policy is respected: identifying User-Agent, max 1 request/s, caching.
    /// </summary>
    public sealed class GeocodingService
    {
        private const double MinLat = 42.55, MaxLat = 42.80, MinLon = 23.10, MaxLon = 23.60;
        private const string Viewbox = "23.10,42.80,23.60,42.55";
        private const int Limit = 7;

        private readonly IHttpClientFactory _http;
        private readonly ILogger<GeocodingService> _log;
        private readonly string? _googleKey;
        private readonly SemaphoreSlim _nominatimGate = new(1, 1);
        private readonly ConcurrentDictionary<string, (DateTimeOffset At, List<GeoPlace> Places)> _cache = new();
        private DateTimeOffset _lastNominatim = DateTimeOffset.MinValue;

        public GeocodingService(IHttpClientFactory http, ILogger<GeocodingService> log, IConfiguration config)
        {
            _http = http;
            _log = log;
            _googleKey = config["Geocoding:GoogleApiKey"] is { Length: > 0 } key ? key : null;
            _log.LogInformation("Place search provider: {Provider}", _googleKey != null ? "Google Places" : "OpenStreetMap (Photon + Nominatim)");
        }

        public bool UsesGoogle => _googleKey != null;

        public async Task<List<GeoPlace>> SearchAsync(string query, string lang, string? session, CancellationToken ct)
        {
            if (_googleKey != null)
            {
                var google = await Cached($"g|{lang}|{query}", TimeSpan.FromMinutes(10), () => GoogleAutocomplete(query, lang, session, ct), ct);
                if (google != null) return google;
            }
            return await OsmSearch(query, lang, ct);
        }

        /// <summary>Coordinates for a Google suggestion. Ends the autocomplete session, which makes its keystrokes free.</summary>
        public async Task<GeoPlace?> ResolveAsync(string placeId, string lang, string? session, CancellationToken ct)
        {
            if (_googleKey == null) return null;
            var list = await Cached($"gd|{lang}|{placeId}", TimeSpan.FromDays(7), async () =>
            {
                var url = $"v1/places/{Uri.EscapeDataString(placeId)}?languageCode={lang}" +
                          (string.IsNullOrEmpty(session) ? "" : $"&sessionToken={Uri.EscapeDataString(session)}");
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Add("X-Goog-Api-Key", _googleKey);
                req.Headers.Add("X-Goog-FieldMask", "id,displayName,formattedAddress,location");
                using var doc = await SendAsync("google", req, ct);
                var root = doc.RootElement;
                if (!root.TryGetProperty("location", out var loc)) return new List<GeoPlace>();
                return new List<GeoPlace>
                {
                    new(root.TryGetProperty("displayName", out var dn) ? dn.GetProperty("text").GetString() ?? "" : "",
                        root.TryGetProperty("formattedAddress", out var fa) ? ShortAddress(fa.GetString()) : null,
                        loc.GetProperty("latitude").GetDouble(), loc.GetProperty("longitude").GetDouble(), "place",
                        PlaceId: placeId, Source: "google"),
                };
            }, ct);
            return list?.FirstOrDefault();
        }

        public async Task<GeoPlace?> ReverseAsync(double lat, double lon, string lang, CancellationToken ct)
        {
            var url = FormattableString.Invariant($"reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language={lang}&lat={lat:F5}&lon={lon:F5}");
            var list = await Cached(url, TimeSpan.FromHours(12), () => Nominatim(url, doc =>
                doc.RootElement.TryGetProperty("lat", out _) ? new List<GeoPlace> { FromNominatim(doc.RootElement) } : new List<GeoPlace>(), ct), ct);
            return list?.FirstOrDefault();
        }

        // ---------- Google Places (New) ----------

        private async Task<List<GeoPlace>> GoogleAutocomplete(string query, string lang, string? session, CancellationToken ct)
        {
            var body = new Dictionary<string, object?>
            {
                ["input"] = query,
                ["languageCode"] = lang,
                ["regionCode"] = "bg",
                ["includedRegionCodes"] = new[] { "bg" },
                ["locationRestriction"] = new
                {
                    rectangle = new { low = new { latitude = MinLat, longitude = MinLon }, high = new { latitude = MaxLat, longitude = MaxLon } },
                },
            };
            if (!string.IsNullOrEmpty(session)) body["sessionToken"] = session;
            using var req = new HttpRequestMessage(HttpMethod.Post, "v1/places:autocomplete") { Content = JsonContent.Create(body) };
            req.Headers.Add("X-Goog-Api-Key", _googleKey);
            using var doc = await SendAsync("google", req, ct);

            var list = new List<GeoPlace>();
            if (!doc.RootElement.TryGetProperty("suggestions", out var suggestions)) return list;
            foreach (var s in suggestions.EnumerateArray())
            {
                if (!s.TryGetProperty("placePrediction", out var p)) continue;
                var fmt = p.TryGetProperty("structuredFormat", out var sf) ? sf : default;
                string? Text(JsonElement e, string name) =>
                    e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.TryGetProperty("text", out var tx) ? tx.GetString() : null;
                var main = Text(fmt, "mainText") ?? Text(p, "text") ?? "";
                var kind = p.TryGetProperty("types", out var types) && types.GetArrayLength() > 0 ? types[0].GetString() ?? "place" : "place";
                list.Add(new GeoPlace(main, ShortAddress(Text(fmt, "secondaryText")), null, null, kind,
                    PlaceId: p.GetProperty("placeId").GetString(), Source: "google"));
            }
            return list;
        }

        // Google appends ", София, България" and postcodes; inside a Sofia-only app they are noise.
        private static string? ShortAddress(string? address)
        {
            if (string.IsNullOrWhiteSpace(address)) return null;
            var parts = address.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Where(p => !p.Equals("България", StringComparison.OrdinalIgnoreCase) && !p.Equals("Bulgaria", StringComparison.OrdinalIgnoreCase))
                .Select(p => System.Text.RegularExpressions.Regex.Replace(p, @"^\d{4}\s+", ""))
                .Where(p => p.Length > 0 && !p.Equals("София", StringComparison.OrdinalIgnoreCase) && !p.Equals("Sofia", StringComparison.OrdinalIgnoreCase))
                .ToList();
            return parts.Count == 0 ? null : string.Join(", ", parts);
        }

        // ---------- OpenStreetMap ----------

        private async Task<List<GeoPlace>> OsmSearch(string query, string lang, CancellationToken ct)
        {
            var photonTask = Cached($"p|{lang}|{query}", TimeSpan.FromHours(12), () => Photon(query, lang, ct), ct);

            // Nominatim is strictly rate limited; don't let a queue of keystrokes hold up Photon's answer.
            using var nomCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            nomCts.CancelAfter(TimeSpan.FromSeconds(2.5));
            var url = "search?format=jsonv2&addressdetails=1&limit=6&bounded=1&countrycodes=bg" +
                      $"&viewbox={Viewbox}&accept-language={lang}&q={Uri.EscapeDataString(query)}";
            var nominatimTask = Cached(url, TimeSpan.FromHours(12),
                () => Nominatim(url, doc => doc.RootElement.EnumerateArray().Select(FromNominatim).ToList(), nomCts.Token), nomCts.Token);

            List<GeoPlace>? photon = null, nominatim = null;
            try { photon = await photonTask; } catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }
            try { nominatim = await nominatimTask; } catch (OperationCanceledException) when (!ct.IsCancellationRequested) { }

            var merged = new List<GeoPlace>();
            foreach (var p in (photon ?? new()).Concat(nominatim ?? new()))
            {
                if (merged.Any(m => string.Equals(m.Label, p.Label, StringComparison.OrdinalIgnoreCase)
                                    && Geo.DistanceMeters(m.Lat!.Value, m.Lon!.Value, p.Lat!.Value, p.Lon!.Value) < 80)) continue;
                merged.Add(p);
                if (merged.Count == Limit) break;
            }
            return merged;
        }

        private async Task<List<GeoPlace>> Photon(string query, string lang, CancellationToken ct)
        {
            var url = FormattableString.Invariant(
                $"api/?q={Uri.EscapeDataString(query)}&lat=42.6977&lon=23.3219&limit=8&lang={(lang == "en" ? "en" : "default")}&bbox={MinLon},{MinLat},{MaxLon},{MaxLat}");
            using var doc = await SendAsync("photon", new HttpRequestMessage(HttpMethod.Get, url), ct);
            var list = new List<GeoPlace>();
            foreach (var f in doc.RootElement.GetProperty("features").EnumerateArray())
            {
                var c = f.GetProperty("geometry").GetProperty("coordinates");
                var pr = f.GetProperty("properties");
                string? Get(string key) => pr.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
                var street = Get("street") is { } st ? (Get("housenumber") is { } hn ? $"{st} {hn}" : st) : null;
                var name = Get("name");
                var label = name ?? street;
                if (string.IsNullOrWhiteSpace(label)) continue;
                var area = Get("district") ?? Get("locality") ?? (Get("city") is { } city && city != "София" && city != "Sofia" ? city : null);
                var detail = string.Join(", ", new[] { street != label ? street : null, area }.Where(s => !string.IsNullOrWhiteSpace(s)));
                list.Add(new GeoPlace(label, detail.Length > 0 ? detail : null, c[1].GetDouble(), c[0].GetDouble(), Get("osm_key") ?? "place"));
            }
            return list;
        }

        private async Task<List<GeoPlace>> Nominatim(string url, Func<JsonDocument, List<GeoPlace>> map, CancellationToken ct)
        {
            await _nominatimGate.WaitAsync(ct);
            try
            {
                var wait = TimeSpan.FromSeconds(1.05) - (DateTimeOffset.UtcNow - _lastNominatim);
                if (wait > TimeSpan.Zero) await Task.Delay(wait, ct);
                _lastNominatim = DateTimeOffset.UtcNow;
                using var doc = await SendAsync("nominatim", new HttpRequestMessage(HttpMethod.Get, url), ct);
                return map(doc);
            }
            finally
            {
                _nominatimGate.Release();
            }
        }

        private static GeoPlace FromNominatim(JsonElement item)
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

        // ---------- Plumbing ----------

        private async Task<JsonDocument> SendAsync(string client, HttpRequestMessage req, CancellationToken ct)
        {
            using (req)
            {
                using var response = await _http.CreateClient(client).SendAsync(req, ct);
                if (!response.IsSuccessStatusCode)
                {
                    var text = await response.Content.ReadAsStringAsync(ct);
                    throw new HttpRequestException($"{client} {(int)response.StatusCode}: {text[..Math.Min(300, text.Length)]}");
                }
                await using var stream = await response.Content.ReadAsStreamAsync(ct);
                return await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            }
        }

        /// <summary>Cached call; returns null (and logs) when the provider fails, so callers can fall back.</summary>
        private async Task<List<GeoPlace>?> Cached(string key, TimeSpan ttl, Func<Task<List<GeoPlace>>> load, CancellationToken ct)
        {
            if (_cache.TryGetValue(key, out var hit) && DateTimeOffset.UtcNow - hit.At < ttl) return hit.Places;
            try
            {
                var places = await load();
                _cache[key] = (DateTimeOffset.UtcNow, places);
                if (_cache.Count > 3000)
                    foreach (var old in _cache.OrderBy(x => x.Value.At).Take(800)) _cache.TryRemove(old.Key, out _);
                return places;
            }
            catch (Exception ex) when (ex is HttpRequestException or JsonException or KeyNotFoundException or InvalidOperationException
                                       || ex is TaskCanceledException && !ct.IsCancellationRequested)
            {
                _log.LogWarning("Place search failed for {Key}: {Message}", key, ex.Message);
                return null;
            }
        }
    }
}
