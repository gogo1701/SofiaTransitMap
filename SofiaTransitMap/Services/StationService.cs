using SofiaTransitMap.Models;
using System.Formats.Asn1;
using System.Globalization;
using CsvHelper;
using CsvHelper.Configuration;

namespace SofiaTransitMap.Services
{
    public class StationService
    {
        private readonly List<Station> _stations;

        public StationService(IWebHostEnvironment env)
        {
            var filePath = Path.Combine(env.ContentRootPath, "Data", "stops.txt");
            _stations = LoadStations(filePath);
        }

        private List<Station> LoadStations(string path)
        {
            using var reader = new StreamReader(path);
            using var csv = new CsvReader(reader, new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                HeaderValidated = null,
                MissingFieldFound = null
            });

            return csv.GetRecords<dynamic>()
                .Select(r => new Station
                {
                    StopId = r.stop_id,
                    StopCode = r.stop_code,
                    StopName = r.stop_name,
                    Latitude = double.Parse(r.stop_lat),
                    Longitude = double.Parse(r.stop_lon),
                    TransitType = DetectType((string)r.stop_id)
                })
                .ToList();

        }
        public IEnumerable<Station> GetStations(
            TransitType? type = null,
            double? minLat = null,
            double? maxLat = null,
            double? minLon = null,
            double? maxLon = null,
            int limit = 500)
        {
            var query = _stations.AsQueryable();

            if (type.HasValue)
                query = query.Where(s => s.TransitType == type.Value);

            if (minLat.HasValue) query = query.Where(s => s.Latitude >= minLat.Value);
            if (maxLat.HasValue) query = query.Where(s => s.Latitude <= maxLat.Value);
            if (minLon.HasValue) query = query.Where(s => s.Longitude >= minLon.Value);
            if (maxLon.HasValue) query = query.Where(s => s.Longitude <= maxLon.Value);

            return query.Take(limit).ToList();
        }


        public IEnumerable<Station> GetAll() => _stations;

        private TransitType DetectType(string stopId)
        {
            if (string.IsNullOrWhiteSpace(stopId))
                return TransitType.Unknown;

            stopId = stopId.ToUpperInvariant();

            if (stopId.StartsWith("TM"))
                return TransitType.Tram;

            if (stopId.StartsWith("TB"))
                return TransitType.Trolleybus;

            if (stopId.StartsWith("M"))
                return TransitType.Metro;

            if (stopId.StartsWith("A"))
                return TransitType.Bus;

            return TransitType.Unknown;
        }

    }
}
