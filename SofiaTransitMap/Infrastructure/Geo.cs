namespace SofiaTransitMap.Infrastructure
{
    public static class Geo
    {
        public const double WalkSpeedMps = 1.25;
        public const double WalkDetourFactor = 1.3;

        public static double DistanceMeters(double lat1, double lon1, double lat2, double lon2)
        {
            const double r = 6371000;
            var dLat = ToRad(lat2 - lat1);
            var dLon = ToRad(lon2 - lon1);
            var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) +
                    Math.Cos(ToRad(lat1)) * Math.Cos(ToRad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
            return 2 * r * Math.Asin(Math.Min(1, Math.Sqrt(a)));
        }

        /// <summary>Street walking estimate from a straight-line distance.</summary>
        public static int WalkSeconds(double straightMeters) =>
            (int)Math.Ceiling(straightMeters * WalkDetourFactor / WalkSpeedMps);

        public static double Bearing(double lat1, double lon1, double lat2, double lon2)
        {
            var y = Math.Sin(ToRad(lon2 - lon1)) * Math.Cos(ToRad(lat2));
            var x = Math.Cos(ToRad(lat1)) * Math.Sin(ToRad(lat2)) -
                    Math.Sin(ToRad(lat1)) * Math.Cos(ToRad(lat2)) * Math.Cos(ToRad(lon2 - lon1));
            return (Math.Atan2(y, x) * 180 / Math.PI + 360) % 360;
        }

        private static double ToRad(double deg) => deg * Math.PI / 180;
    }

    /// <summary>Converts between GTFS service-day seconds and wall-clock time in Sofia.</summary>
    public static class SofiaClock
    {
        public static readonly TimeZoneInfo Zone = ResolveZone();

        private static TimeZoneInfo ResolveZone()
        {
            foreach (var id in new[] { "Europe/Sofia", "FLE Standard Time" })
            {
                try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch { }
            }
            return TimeZoneInfo.Local;
        }

        public static DateTimeOffset Now => TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, Zone);

        public static DateOnly Today => DateOnly.FromDateTime(Now.DateTime);

        public static DateTimeOffset ToLocal(DateTimeOffset value) => TimeZoneInfo.ConvertTime(value, Zone);

        /// <summary>GTFS: service-day time is measured from "noon minus 12h", which equals local midnight except on DST days.</summary>
        public static DateTimeOffset ServiceDayOrigin(DateOnly date)
        {
            var noon = date.ToDateTime(new TimeOnly(12, 0));
            var offset = Zone.GetUtcOffset(noon);
            return new DateTimeOffset(noon, offset).AddHours(-12);
        }

        public static DateTimeOffset At(DateOnly date, int serviceSeconds) =>
            ToLocal(ServiceDayOrigin(date).AddSeconds(serviceSeconds));

        public static int ToServiceSeconds(DateOnly date, DateTimeOffset instant) =>
            (int)Math.Round((instant - ServiceDayOrigin(date)).TotalSeconds);

        public static int DateKey(DateOnly date) => date.Year * 10000 + date.Month * 100 + date.Day;
    }
}
