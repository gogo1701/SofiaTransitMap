using SofiaTransitMap.Gtfs;

namespace SofiaTransitMap.Models
{
    public sealed record RouteDto(string Id, string ShortName, string LongName, string? LongNameEn, TransitType Mode, string Color, string TextColor)
    {
        public static RouteDto From(GtfsRoute r) => new(r.Id, r.ShortName, r.LongName, r.LongNameEn, r.Mode, r.Color, r.TextColor);
    }

    public sealed record StopDto(string Id, string Code, string Name, string? NameEn, double Lat, double Lon, TransitType Mode, IReadOnlyList<TransitType> Modes)
    {
        public static StopDto From(GtfsStop s) => new(s.Id, s.Code, s.Name, s.NameEn, Math.Round(s.Lat, 6), Math.Round(s.Lon, 6), s.Mode,
            s.Modes.OrderBy(GtfsLoader.ModePriority).ToList());
    }

    public sealed record PlanPlace(string Name, string? NameEn, double Lat, double Lon, string? StopId = null, string? StopCode = null);

    public sealed record PlanStopCall(string StopId, string Name, string? NameEn, double Lat, double Lon, DateTimeOffset Time);

    public sealed class PlanLeg
    {
        public string Type { get; init; } = "walk";
        public required PlanPlace From { get; init; }
        public required PlanPlace To { get; init; }
        public DateTimeOffset Departure { get; init; }
        public DateTimeOffset Arrival { get; init; }
        public int DurationSec { get; init; }
        public int DistanceM { get; init; }
        public RouteDto? Route { get; init; }
        public string? Headsign { get; init; }
        public string? HeadsignEn { get; init; }
        public string? TripId { get; init; }
        public bool Wheelchair { get; init; }
        public List<PlanStopCall>? Stops { get; init; }
        public List<double[]> Geometry { get; init; } = new();
        public int? DelaySec { get; init; }
    }

    public sealed record PlanJourney(DateTimeOffset Departure, DateTimeOffset Arrival, int DurationSec, int WalkMeters, int Transfers, List<PlanLeg> Legs);

    public sealed record PlanResult(DateTimeOffset RequestedTime, bool ArriveBy, List<PlanJourney> Journeys, string? Message);
}
