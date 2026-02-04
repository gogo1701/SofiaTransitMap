using System.Globalization;
using SofiaTransitMap.Models;

namespace SofiaTransitMap.Services
{
    public class RouteService
    {
        private readonly Dictionary<string, List<double[]>> _shapes = new();
        private readonly Dictionary<string, Route> _routes = new();
        private readonly Dictionary<string, List<Trip>> _tripsByRoute = new();
        private readonly Dictionary<string, List<StopTime>> _stopTimesByTrip = new();
        private readonly StationService _stationService;

        public RouteService(StationService stationService)
        {
            _stationService = stationService;
            LoadShapes();
            LoadRoutes();
            LoadTrips();
            LoadStopTimes();
        }

        private void LoadShapes()
        {
            var lines = File.ReadAllLines("Data/shapes.txt").Skip(1);

            foreach (var group in lines
                         .Select(l => l.Split(','))
                         .GroupBy(parts => parts[0])) // group by shape_id
            {
                var shapeId = group.Key;
                var points = group
                    .OrderBy(p => int.Parse(p[3]))
                    .Select(p => new double[]
                    {
                        double.Parse(p[1], CultureInfo.InvariantCulture),
                        double.Parse(p[2], CultureInfo.InvariantCulture)
                    })
                    .ToList();

                _shapes[shapeId] = points;
            }
        }

        private void LoadRoutes()
        {
            if (!File.Exists("Data/routes.txt"))
                return;

            var lines = File.ReadAllLines("Data/routes.txt").Skip(1);

            foreach (var line in lines)
            {
                var parts = line.Split(',');
                if (parts.Length < 6)
                    continue;

                var route = new Route
                {
                    RouteId = parts[0],
                    AgencyId = parts[1],
                    RouteShortName = parts[2],
                    RouteLongName = parts[3],
                    RouteType = int.TryParse(parts[5], out var type) ? type : 0,
                    RouteColor = parts.Length > 7 ? parts[7] : string.Empty,
                    RouteTextColor = parts.Length > 8 ? parts[8] : string.Empty
                };

                _routes[route.RouteId] = route;
            }
        }

        private void LoadTrips()
        {
            if (!File.Exists("Data/trips.txt"))
                return;

            var lines = File.ReadAllLines("Data/trips.txt").Skip(1);

            foreach (var line in lines)
            {
                var parts = line.Split(',');
                if (parts.Length < 8)
                    continue;

                // trips.txt format: trip_id,route_id,service_id,trip_headsign,trip_short_name,direction_id,block_id,shape_id,...
                var trip = new Trip
                {
                    TripId = parts[0],
                    RouteId = parts[1],
                    ServiceId = parts[2],
                    TripHeadsign = parts[3],
                    DirectionId = int.TryParse(parts[5], out var direction) ? direction : 0,
                    ShapeId = parts[7]
                };

                if (!_tripsByRoute.ContainsKey(trip.RouteId))
                    _tripsByRoute[trip.RouteId] = new List<Trip>();

                _tripsByRoute[trip.RouteId].Add(trip);
            }
        }

        private void LoadStopTimes()
        {
            if (!File.Exists("Data/stop_times.txt"))
                return;

            var lines = File.ReadAllLines("Data/stop_times.txt").Skip(1);

            foreach (var line in lines)
            {
                var parts = line.Split(',');
                if (parts.Length < 5)
                    continue;

                // stop_times.txt format: trip_id,arrival_time,departure_time,stop_id,stop_sequence,...
                var stopTime = new StopTime
                {
                    TripId = parts[0],
                    ArrivalTime = parts[1],
                    DepartureTime = parts[2],
                    StopId = parts[3],
                    StopSequence = int.TryParse(parts[4], out var seq) ? seq : 0
                };

                if (!_stopTimesByTrip.ContainsKey(stopTime.TripId))
                    _stopTimesByTrip[stopTime.TripId] = new List<StopTime>();

                _stopTimesByTrip[stopTime.TripId].Add(stopTime);
            }
        }

        public List<double[]> GetShape(string shapeId)
        {
            return _shapes.ContainsKey(shapeId) ? _shapes[shapeId] : new List<double[]>();
        }

        public Route? GetRouteByLineNumber(string lineNumber)
        {
            return _routes.Values.FirstOrDefault(r =>
                r.RouteId.Equals(lineNumber, StringComparison.OrdinalIgnoreCase));
        }

        public IEnumerable<Route> SearchRoutes(string searchTerm)
        {
            if (string.IsNullOrWhiteSpace(searchTerm))
                return _routes.Values;

            return _routes.Values.Where(r =>
                r.RouteShortName.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ||
                r.RouteLongName.Contains(searchTerm, StringComparison.OrdinalIgnoreCase));
        }

        public IEnumerable<Route> GetAllRoutes()
        {
            return _routes.Values;
        }

        public RouteDetails? GetRouteDetails(string lineNumber)
        {
            // Step 1: Find the route by line number
            var route = GetRouteByLineNumber(lineNumber);
            if (route == null)
                return null;

            // Step 2: Get all trips for this route_id
            var trips = _tripsByRoute.ContainsKey(route.RouteId)
                ? _tripsByRoute[route.RouteId]
                : new List<Trip>();

            // Step 3: Extract unique shape_ids from trips and get their shapes
            var shapes = trips
                .Where(t => !string.IsNullOrWhiteSpace(t.ShapeId))
                .Select(t => t.ShapeId)
                .Distinct()
                .Where(shapeId => _shapes.ContainsKey(shapeId))
                .Select(shapeId => new RouteShape
                {
                    ShapeId = shapeId,
                    Points = _shapes[shapeId]
                })
                .ToList();

            // Step 4: Get all unique stops for this route (from all trips)
            var stopIds = trips
                .Where(t => _stopTimesByTrip.ContainsKey(t.TripId))
                .SelectMany(t => _stopTimesByTrip[t.TripId])
                .Select(st => st.StopId)
                .Distinct()
                .ToList();

            // Step 5: Get station details for these stops
            var allStations = _stationService.GetAll();
            var routeStations = allStations
                .Where(s => stopIds.Contains(s.StopId))
                .OrderBy(s => stopIds.IndexOf(s.StopId)) // Maintain stop order
                .ToList();

            return new RouteDetails
            {
                Route = route,
                Trips = trips,
                Shapes = shapes,
                Stations = routeStations,
                TransitType = GetTransitTypeFromRouteType(route.RouteType)
            };
        }

        private TransitType GetTransitTypeFromRouteType(int routeType)
        {
            return routeType switch
            {
                0 => TransitType.Tram,
                1 => TransitType.Metro,
                3 => TransitType.Bus,
                11 => TransitType.Trolleybus,
                _ => TransitType.Unknown
            };
        }
    }

    public class Route
    {
        public string RouteId { get; set; } = string.Empty;
        public string AgencyId { get; set; } = string.Empty;
        public string RouteShortName { get; set; } = string.Empty;
        public string RouteLongName { get; set; } = string.Empty;
        public int RouteType { get; set; }
        public string RouteColor { get; set; } = string.Empty;
        public string RouteTextColor { get; set; } = string.Empty;
    }

    public class Trip
    {
        public string RouteId { get; set; } = string.Empty;
        public string ServiceId { get; set; } = string.Empty;
        public string TripId { get; set; } = string.Empty;
        public string TripHeadsign { get; set; } = string.Empty;
        public int DirectionId { get; set; }
        public string ShapeId { get; set; } = string.Empty;
    }

    public class StopTime
    {
        public string TripId { get; set; } = string.Empty;
        public string ArrivalTime { get; set; } = string.Empty;
        public string DepartureTime { get; set; } = string.Empty;
        public string StopId { get; set; } = string.Empty;
        public int StopSequence { get; set; }
    }

    public class RouteShape
    {
        public string ShapeId { get; set; } = string.Empty;
        public List<double[]> Points { get; set; } = new();
    }

    public class RouteDetails
    {
        public Route Route { get; set; } = new();
        public List<Trip> Trips { get; set; } = new();
        public List<RouteShape> Shapes { get; set; } = new();
        public List<Station> Stations { get; set; } = new();
        public TransitType TransitType { get; set; }
    }
}