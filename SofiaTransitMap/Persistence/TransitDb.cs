using Microsoft.EntityFrameworkCore;
using SofiaTransitMap.Models;

namespace SofiaTransitMap.Persistence
{
    /// <summary>Network-wide punctuality sample, written every few minutes by the realtime collector.</summary>
    public class NetworkSnapshot
    {
        public long Id { get; set; }
        public DateTime TimestampUtc { get; set; }
        public string LocalDate { get; set; } = "";
        public int LocalHour { get; set; }
        public int DayOfWeek { get; set; }
        public int Vehicles { get; set; }
        public int Tracked { get; set; }
        public int Delayed { get; set; }
        public int Severe { get; set; }
        public int Early { get; set; }
        public int OnTime { get; set; }
        public double AvgDelaySec { get; set; }
        public int MedianDelaySec { get; set; }
        public int P90DelaySec { get; set; }
        public int MaxDelaySec { get; set; }
        public int ActiveAlerts { get; set; }
    }

    /// <summary>Per-line punctuality sample taken at the same instant as a <see cref="NetworkSnapshot"/>.</summary>
    public class RouteSnapshot
    {
        public long Id { get; set; }
        public DateTime TimestampUtc { get; set; }
        public int LocalHour { get; set; }
        public string RouteId { get; set; } = "";
        public string ShortName { get; set; } = "";
        public TransitType Mode { get; set; }
        public int Vehicles { get; set; }
        public int Tracked { get; set; }
        public int Delayed { get; set; }
        public double SumDelaySec { get; set; }
        public int MaxDelaySec { get; set; }
    }

    public class TransitDb : DbContext
    {
        public TransitDb(DbContextOptions<TransitDb> options) : base(options) { }

        public DbSet<NetworkSnapshot> NetworkSnapshots => Set<NetworkSnapshot>();
        public DbSet<RouteSnapshot> RouteSnapshots => Set<RouteSnapshot>();

        protected override void OnModelCreating(ModelBuilder b)
        {
            b.Entity<NetworkSnapshot>().HasIndex(x => x.TimestampUtc);
            b.Entity<RouteSnapshot>().HasIndex(x => x.TimestampUtc);
            b.Entity<RouteSnapshot>().HasIndex(x => new { x.RouteId, x.TimestampUtc });
            b.Entity<RouteSnapshot>().Property(x => x.Mode).HasConversion<string>();
        }
    }
}
