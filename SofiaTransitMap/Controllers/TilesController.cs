using Microsoft.AspNetCore.Mvc;

namespace SofiaTransitMap.Controllers;

/// <summary>
/// Same-origin proxy for OpenStreetMap tiles. Browsers behind tunnels/proxies (e.g. dev tunnels) often get
/// "403 Access blocked" from tile.openstreetmap.org because of their Referer or shared IP; serving tiles from
/// our own origin avoids that, and the disk cache keeps load on the OSM servers low as their tile policy asks.
/// </summary>
[ApiController]
[Route("tiles")]
public sealed class TilesController(IHttpClientFactory httpFactory, IWebHostEnvironment env, ILogger<TilesController> log) : ControllerBase
{
    private static readonly TimeSpan MaxAge = TimeSpan.FromDays(7);

    [HttpGet("{z:int}/{x:int}/{y:int}.png")]
    public async Task<IActionResult> Get(int z, int x, int y, CancellationToken ct)
    {
        if (z is < 0 or > 19) return NotFound();
        var max = 1 << z;
        if (x < 0 || y < 0 || x >= max || y >= max) return NotFound();

        var path = Path.Combine(env.ContentRootPath, "App_Data", "tiles", z.ToString(), x.ToString(), $"{y}.png");
        var info = new FileInfo(path);
        if (info.Exists && DateTime.UtcNow - info.LastWriteTimeUtc < MaxAge) return Tile(path);

        try
        {
            var http = httpFactory.CreateClient("tiles");
            using var res = await http.GetAsync($"{z}/{x}/{y}.png", ct);
            if (!res.IsSuccessStatusCode)
            {
                log.LogWarning("Tile {Z}/{X}/{Y} upstream returned {Status}", z, x, y, (int)res.StatusCode);
                return info.Exists ? Tile(path) : StatusCode((int)res.StatusCode);
            }
            var bytes = await res.Content.ReadAsByteArrayAsync(ct);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var tmp = $"{path}.{Guid.NewGuid():N}.tmp";
            await System.IO.File.WriteAllBytesAsync(tmp, bytes, ct);
            System.IO.File.Move(tmp, path, overwrite: true);
            SetCacheHeaders();
            return File(bytes, "image/png");
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            log.LogWarning(e, "Tile {Z}/{X}/{Y} fetch failed", z, x, y);
            return info.Exists ? Tile(path) : StatusCode(StatusCodes.Status502BadGateway);
        }
    }

    private IActionResult Tile(string path)
    {
        SetCacheHeaders();
        return PhysicalFile(path, "image/png");
    }

    private void SetCacheHeaders() => Response.Headers.CacheControl = $"public, max-age={(int)TimeSpan.FromDays(1).TotalSeconds}";
}
