using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Persistence;
using SofiaTransitMap.Planning;
using SofiaTransitMap.Realtime;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<GtfsOptions>(builder.Configuration.GetSection("Gtfs"));
builder.Services.Configure<RealtimeOptions>(builder.Configuration.GetSection("Realtime"));

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddOpenApi();
builder.Services.AddResponseCompression(o => o.EnableForHttps = true);

builder.Services.AddHttpClient("gtfs", c =>
{
    c.Timeout = TimeSpan.FromMinutes(3);
    c.DefaultRequestHeaders.UserAgent.ParseAdd("SofiaTransitMap/1.0");
});
builder.Services.AddHttpClient("nominatim", c =>
{
    c.BaseAddress = new Uri(builder.Configuration["Geocoding:BaseUrl"] ?? "https://nominatim.openstreetmap.org/");
    c.Timeout = TimeSpan.FromSeconds(10);
    c.DefaultRequestHeaders.UserAgent.ParseAdd(builder.Configuration["Geocoding:UserAgent"]
        ?? "SofiaTransitMap/1.0 (https://github.com/gogo1701/SofiaTransitMap)");
});

builder.Services.AddHttpClient("photon", c =>
{
    c.BaseAddress = new Uri(builder.Configuration["Geocoding:PhotonUrl"] ?? "https://photon.komoot.io/");
    c.Timeout = TimeSpan.FromSeconds(6);
    c.DefaultRequestHeaders.UserAgent.ParseAdd(builder.Configuration["Geocoding:UserAgent"]
        ?? "SofiaTransitMap/1.0 (https://github.com/gogo1701/SofiaTransitMap)");
});
builder.Services.AddHttpClient("google", c =>
{
    c.BaseAddress = new Uri("https://places.googleapis.com/");
    c.Timeout = TimeSpan.FromSeconds(6);
});
builder.Services.AddHttpClient("tiles", c =>
{
    c.BaseAddress = new Uri(builder.Configuration["Tiles:BaseUrl"] ?? "https://tile.openstreetmap.org/");
    c.Timeout = TimeSpan.FromSeconds(15);
    c.DefaultRequestHeaders.UserAgent.ParseAdd(builder.Configuration["Geocoding:UserAgent"]
        ?? "SofiaTransitMap/1.0 (https://github.com/gogo1701/SofiaTransitMap)");
});

var dataDir = Path.Combine(builder.Environment.ContentRootPath, "App_Data");
Directory.CreateDirectory(dataDir);
var connection = builder.Configuration.GetConnectionString("Transit") ?? "Data Source=App_Data/transit.db";
connection = connection.Replace("Data Source=App_Data/", $"Data Source={dataDir}{Path.DirectorySeparatorChar}");
builder.Services.AddDbContext<TransitDb>(o => o.UseSqlite(connection));

builder.Services.AddSingleton<GtfsStore>();
builder.Services.AddSingleton<RealtimeState>();
builder.Services.AddSingleton<JourneyPlanner>();
builder.Services.AddSingleton<GeocodingService>();
builder.Services.AddHostedService<GtfsSyncService>();
builder.Services.AddHostedService<RealtimeService>();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<TransitDb>().Database.EnsureCreated();
}

app.UseExceptionHandler(handler => handler.Run(async context =>
{
    var error = context.Features.Get<IExceptionHandlerFeature>()?.Error;
    if (error is FeedNotReadyException)
    {
        context.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
        context.Response.Headers.RetryAfter = "5";
        await context.Response.WriteAsJsonAsync(new { message = error.Message, code = "feed-loading" });
        return;
    }
    context.Response.StatusCode = StatusCodes.Status500InternalServerError;
    await context.Response.WriteAsJsonAsync(new { message = "Unexpected server error.", code = "server-error" });
}));

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseResponseCompression();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    // Unversioned ES modules: always revalidate (ETag) so deploys are picked up immediately.
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache"
});
app.MapControllers();

app.Run();
