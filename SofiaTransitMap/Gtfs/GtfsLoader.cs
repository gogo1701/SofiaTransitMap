using System.IO.Compression;
using System.Text;
using SofiaTransitMap.Infrastructure;
using SofiaTransitMap.Models;

namespace SofiaTransitMap.Gtfs
{
    /// <summary>Parses a GTFS static feed from a zip archive or a directory of .txt files.</summary>
    public static class GtfsLoader
    {
        public static GtfsFeed LoadZip(string zipPath, string sourceLabel)
        {
            using var zip = ZipFile.OpenRead(zipPath);
            return Load(name =>
            {
                var entry = zip.Entries.FirstOrDefault(e => e.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
                return entry == null ? null : new StreamReader(entry.Open(), Encoding.UTF8);
            }, sourceLabel);
        }

        public static GtfsFeed LoadDirectory(string dir, string sourceLabel) =>
            Load(name =>
            {
                var path = Path.Combine(dir, name);
                return File.Exists(path) ? new StreamReader(path, Encoding.UTF8) : null;
            }, sourceLabel);

        private static GtfsFeed Load(Func<string, TextReader?> open, string source)
        {
            var translations = LoadTranslations(open);
            string? En(string table, string field, string value) =>
                translations.TryGetValue($"{table}|{field}|{value}", out var t) && !string.IsNullOrWhiteSpace(t) ? t : null;

            // stops
            var stops = new List<GtfsStop>();
            var stopIndex = new Dictionary<string, int>();
            using (var r = Require(open, "stops.txt"))
            {
                var t = new CsvTable(r);
                int cId = t.Column("stop_id"), cCode = t.Column("stop_code"), cName = t.Column("stop_name"),
                    cLat = t.Column("stop_lat"), cLon = t.Column("stop_lon"), cType = t.Column("location_type"),
                    cParent = t.Column("parent_station");
                while (t.Read())
                {
                    if (!double.TryParse(t.Get(cLat), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var lat) ||
                        !double.TryParse(t.Get(cLon), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var lon))
                        continue;
                    var name = t.Get(cName).Trim();
                    var stop = new GtfsStop
                    {
                        Index = stops.Count,
                        Id = t.Get(cId),
                        Code = t.Get(cCode),
                        Name = name,
                        NameEn = En("stops", "stop_name", name),
                        Lat = lat,
                        Lon = lon,
                        LocationType = int.TryParse(t.Get(cType), out var lt) ? lt : 0,
                        ParentId = NullIfEmpty(t.Get(cParent)),
                    };
                    stopIndex[stop.Id] = stop.Index;
                    stops.Add(stop);
                }
            }

            // routes
            var routes = new List<GtfsRoute>();
            var routeIndex = new Dictionary<string, int>();
            using (var r = Require(open, "routes.txt"))
            {
                var t = new CsvTable(r);
                int cId = t.Column("route_id"), cShort = t.Column("route_short_name"), cLong = t.Column("route_long_name"),
                    cType = t.Column("route_type"), cColor = t.Column("route_color"), cText = t.Column("route_text_color");
                while (t.Read())
                {
                    var longName = t.Get(cLong).Trim();
                    var type = int.TryParse(t.Get(cType), out var rt) ? rt : 3;
                    var route = new GtfsRoute
                    {
                        Index = routes.Count,
                        Id = t.Get(cId),
                        ShortName = t.Get(cShort).Trim(),
                        LongName = longName,
                        LongNameEn = En("routes", "long_name", longName) ?? En("routes", "route_long_name", longName),
                        RouteType = type,
                        Mode = ModeFromRouteType(type),
                    };
                    route.Color = NormalizeColor(t.Get(cColor), DefaultColor(route.Mode));
                    route.TextColor = NormalizeColor(t.Get(cText), "FFFFFF");
                    routeIndex[route.Id] = route.Index;
                    routes.Add(route);
                }
            }

            // trips
            var serviceIds = new List<string>();
            var serviceIndex = new Dictionary<string, int>();
            int Svc(string id)
            {
                if (!serviceIndex.TryGetValue(id, out var i)) { i = serviceIds.Count; serviceIds.Add(id); serviceIndex[id] = i; }
                return i;
            }

            var trips = new List<GtfsTrip>();
            var tripIndex = new Dictionary<string, int>();
            using (var r = Require(open, "trips.txt"))
            {
                var t = new CsvTable(r);
                int cId = t.Column("trip_id"), cRoute = t.Column("route_id"), cSvc = t.Column("service_id"),
                    cHead = t.Column("trip_headsign"), cDir = t.Column("direction_id"), cShape = t.Column("shape_id"),
                    cWc = t.Column("wheelchair_accessible");
                while (t.Read())
                {
                    if (!routeIndex.TryGetValue(t.Get(cRoute), out var ri)) continue;
                    var head = t.Get(cHead).Trim();
                    var trip = new GtfsTrip
                    {
                        Index = trips.Count,
                        Id = t.Get(cId),
                        Route = ri,
                        Service = Svc(t.Get(cSvc)),
                        Headsign = head,
                        HeadsignEn = En("trips", "trip_headsign", head),
                        Direction = int.TryParse(t.Get(cDir), out var d) ? d : -1,
                        ShapeId = t.Get(cShape),
                        Wheelchair = t.Get(cWc) == "1",
                    };
                    tripIndex[trip.Id] = trip.Index;
                    trips.Add(trip);
                    routes[ri].Trips.Add(trip.Index);
                }
            }

            // stop_times â€” collected then sorted by (trip, sequence)
            var rowTrip = new List<int>(700_000);
            var rowSeq = new List<int>(700_000);
            var rowStop = new List<int>(700_000);
            var rowArr = new List<int>(700_000);
            var rowDep = new List<int>(700_000);
            using (var r = Require(open, "stop_times.txt"))
            {
                var t = new CsvTable(r);
                int cTrip = t.Column("trip_id"), cArr = t.Column("arrival_time"), cDep = t.Column("departure_time"),
                    cStop = t.Column("stop_id"), cSeq = t.Column("stop_sequence");
                while (t.Read())
                {
                    if (!tripIndex.TryGetValue(t.Get(cTrip), out var ti)) continue;
                    if (!stopIndex.TryGetValue(t.Get(cStop), out var si)) continue;
                    var arr = CsvTable.ParseTime(t.Get(cArr));
                    var dep = CsvTable.ParseTime(t.Get(cDep));
                    if (arr < 0 && dep < 0) continue;
                    if (arr < 0) arr = dep;
                    if (dep < 0) dep = arr;
                    rowTrip.Add(ti);
                    rowSeq.Add(int.TryParse(t.Get(cSeq), out var seq) ? seq : 0);
                    rowStop.Add(si);
                    rowArr.Add(arr);
                    rowDep.Add(dep);
                }
            }

            var n = rowTrip.Count;
            var order = new int[n];
            var keys = new long[n];
            for (var i = 0; i < n; i++) { order[i] = i; keys[i] = ((long)rowTrip[i] << 24) | (uint)rowSeq[i]; }
            Array.Sort(keys, order);
            var stStop = new int[n];
            var stArr = new int[n];
            var stDep = new int[n];
            var stTrip = new int[n];
            for (var i = 0; i < n; i++)
            {
                var o = order[i];
                stStop[i] = rowStop[o]; stArr[i] = rowArr[o]; stDep[i] = rowDep[o]; stTrip[i] = rowTrip[o];
            }
            for (var i = 0; i < n; i++)
            {
                var trip = trips[stTrip[i]];
                if (trip.StCount == 0) trip.StStart = i;
                trip.StCount++;
                var stop = stops[stStop[i]];
                var route = routes[trip.Route];
                stop.IsServed = true;
                stop.Modes.Add(route.Mode);
                stop.Routes.Add(route.Index);
            }

            InferDirections(routes, trips, stops, stStop);

            // CSR stop -> rows
            var counts = new int[stops.Count + 1];
            for (var i = 0; i < n; i++) counts[stStop[i] + 1]++;
            for (var i = 0; i < stops.Count; i++) counts[i + 1] += counts[i];
            var byStop = new int[n];
            var fill = (int[])counts.Clone();
            for (var i = 0; i < n; i++) byStop[fill[stStop[i]]++] = i;

            foreach (var stop in stops)
            {
                stop.Mode = stop.Modes.Count == 0
                    ? ModeFromStopId(stop.Id)
                    : stop.Modes.OrderBy(ModePriority).First();
            }
            // parent stations inherit their platforms' modes
            foreach (var stop in stops.Where(s => s.ParentId != null))
            {
                if (!stopIndex.TryGetValue(stop.ParentId!, out var pi)) continue;
                var parent = stops[pi];
                foreach (var m in stop.Modes) parent.Modes.Add(m);
                foreach (var rt in stop.Routes) parent.Routes.Add(rt);
                if (parent.Modes.Count > 0) parent.Mode = parent.Modes.OrderBy(ModePriority).First();
            }

            // calendars
            var calendar = new List<(int, int, int, bool[])>();
            using (var r = open("calendar.txt"))
            {
                if (r != null)
                {
                    var t = new CsvTable(r);
                    var days = new[] { "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday" }.Select(t.Column).ToArray();
                    int cSvc = t.Column("service_id"), cStart = t.Column("start_date"), cEnd = t.Column("end_date");
                    while (t.Read())
                    {
                        calendar.Add((Svc(t.Get(cSvc)), int.Parse(t.Get(cStart)), int.Parse(t.Get(cEnd)),
                            days.Select(c => t.Get(c) == "1").ToArray()));
                    }
                }
            }

            var exceptions = new Dictionary<int, List<(int, int)>>();
            using (var r = open("calendar_dates.txt"))
            {
                if (r != null)
                {
                    var t = new CsvTable(r);
                    int cSvc = t.Column("service_id"), cDate = t.Column("date"), cType = t.Column("exception_type");
                    while (t.Read())
                    {
                        if (!int.TryParse(t.Get(cDate), out var date)) continue;
                        if (!exceptions.TryGetValue(date, out var list)) exceptions[date] = list = new List<(int, int)>();
                        list.Add((Svc(t.Get(cSvc)), t.Get(cType) == "2" ? 2 : 1));
                    }
                }
            }

            // shapes
            var shapeBuild = new Dictionary<string, List<(int Seq, float Lat, float Lon)>>();
            using (var r = open("shapes.txt"))
            {
                if (r != null)
                {
                    var t = new CsvTable(r);
                    int cId = t.Column("shape_id"), cLat = t.Column("shape_pt_lat"), cLon = t.Column("shape_pt_lon"), cSeq = t.Column("shape_pt_sequence");
                    while (t.Read())
                    {
                        var id = t.Get(cId);
                        if (!shapeBuild.TryGetValue(id, out var list)) shapeBuild[id] = list = new();
                        list.Add((int.Parse(t.Get(cSeq)),
                            float.Parse(t.Get(cLat), System.Globalization.CultureInfo.InvariantCulture),
                            float.Parse(t.Get(cLon), System.Globalization.CultureInfo.InvariantCulture)));
                    }
                }
            }
            var shapes = new Dictionary<string, float[]>(shapeBuild.Count);
            foreach (var (id, list) in shapeBuild)
            {
                list.Sort((a, b) => a.Seq.CompareTo(b.Seq));
                var arr = new float[list.Count * 2];
                for (var i = 0; i < list.Count; i++) { arr[i * 2] = list[i].Lat; arr[i * 2 + 1] = list[i].Lon; }
                shapes[id] = arr;
            }

            // spatial grid
            var grid = new Dictionary<long, List<int>>();
            foreach (var s in stops)
            {
                var key = GtfsFeed.CellKey((int)Math.Floor(s.Lat / GtfsFeed.CellLat), (int)Math.Floor(s.Lon / GtfsFeed.CellLon));
                if (!grid.TryGetValue(key, out var cell)) grid[key] = cell = new List<int>();
                cell.Add(s.Index);
            }

            var feed = new GtfsFeed
            {
                Stops = stops,
                StopIndex = stopIndex,
                Routes = routes,
                RouteIndex = routeIndex,
                Trips = trips,
                TripIndex = tripIndex,
                StStop = stStop,
                StArr = stArr,
                StDep = stDep,
                ByStopOffsets = counts,
                ByStopRows = byStop,
                RowTrip = stTrip,
                Shapes = shapes,
                ServiceIds = serviceIds,
                CalendarExceptions = exceptions,
                Calendar = calendar,
                Footpaths = new List<Footpath>[stops.Count],
                Grid = grid,
                Source = source,
                LoadedAt = DateTimeOffset.UtcNow,
            };

            BuildFootpaths(feed, open);
            return ReadFeedInfo(feed, open);
        }

        /// <summary>
        /// The Sofia feed omits direction_id, so every trip of a line would fall into one direction.
        /// Trips are classified against the line's most common stop pattern: a trip whose early part lies
        /// nearer the start of that pattern than its late part runs the same way (0), otherwise the opposite way (1).
        /// Geometry is used rather than stop ids because opposite directions usually stop on opposite kerbs.
        /// </summary>
        private static void InferDirections(List<GtfsRoute> routes, List<GtfsTrip> trips, List<GtfsStop> stops, int[] stStop)
        {
            foreach (var route in routes)
            {
                var routeTrips = route.Trips.Select(i => trips[i]).Where(t => t.StCount >= 2).ToList();
                if (routeTrips.Count == 0 || routeTrips.Any(t => t.Direction >= 0)) continue;

                var reference = routeTrips
                    .GroupBy(t => (First: stStop[t.StStart], Last: stStop[t.StStart + t.StCount - 1], t.StCount))
                    .OrderByDescending(g => g.Count()).ThenByDescending(g => g.Key.StCount)
                    .First().First();
                var refStops = Enumerable.Range(reference.StStart, reference.StCount).Select(r => stops[stStop[r]]).ToArray();

                int Nearest(GtfsStop s)
                {
                    var best = 0;
                    var bestD = double.MaxValue;
                    for (var i = 0; i < refStops.Length; i++)
                    {
                        var d = Geo.DistanceMeters(s.Lat, s.Lon, refStops[i].Lat, refStops[i].Lon);
                        if (d < bestD) { bestD = d; best = i; }
                    }
                    return best;
                }

                foreach (var trip in routeTrips)
                {
                    if (trip.StCount == reference.StCount && trip.StStart == reference.StStart) { trip.Direction = 0; continue; }
                    // Quarter points rather than terminals keep loop lines (same first and last stop) classifiable.
                    var early = trip.StCount >= 4 ? trip.StCount / 4 : 0;
                    var late = trip.StCount >= 4 ? trip.StCount - 1 - trip.StCount / 4 : trip.StCount - 1;
                    var a = Nearest(stops[stStop[trip.StStart + early]]);
                    var b = Nearest(stops[stStop[trip.StStart + late]]);
                    trip.Direction = a <= b ? 0 : 1;
                }
                foreach (var t in route.Trips.Select(i => trips[i]).Where(t => t.Direction < 0)) t.Direction = 0;
            }
        }

        private static void BuildFootpaths(GtfsFeed feed, Func<string, TextReader?> open)
        {
            const double radius = 300;
            for (var i = 0; i < feed.Stops.Count; i++) feed.Footpaths[i] = new List<Footpath>();
            foreach (var s in feed.Stops)
            {
                if (!s.IsServed) continue;
                foreach (var (other, meters) in feed.NearbyStops(s.Lat, s.Lon, radius))
                {
                    if (other == s.Index) continue;
                    feed.Footpaths[s.Index].Add(new Footpath(other, Math.Max(60, Geo.WalkSeconds(meters))));
                }
            }

            using var r = open("transfers.txt");
            if (r == null) return;
            var t = new CsvTable(r);
            int cFrom = t.Column("from_stop_id"), cTo = t.Column("to_stop_id"), cType = t.Column("transfer_type"), cMin = t.Column("min_transfer_time");
            while (t.Read())
            {
                if (t.Get(cType) == "3") continue;
                if (!feed.StopIndex.TryGetValue(t.Get(cFrom), out var a) || !feed.StopIndex.TryGetValue(t.Get(cTo), out var b) || a == b) continue;
                if (!feed.Stops[a].IsServed || !feed.Stops[b].IsServed) continue;
                if (!int.TryParse(t.Get(cMin), out var secs)) continue;
                if (secs > 900) continue;
                var list = feed.Footpaths[a];
                var existing = list.FindIndex(f => f.To == b);
                if (existing >= 0) list[existing] = new Footpath(b, Math.Max(list[existing].Seconds, secs));
                else list.Add(new Footpath(b, Math.Max(60, secs)));
            }
        }

        private static GtfsFeed ReadFeedInfo(GtfsFeed feed, Func<string, TextReader?> open)
        {
            using var r = open("feed_info.txt");
            if (r == null) return feed;
            var t = new CsvTable(r);
            if (!t.Read()) return feed;
            feed.FeedVersion = t.Get(t.Column("feed_version"));
            feed.FeedStart = t.Get(t.Column("feed_start_date"));
            feed.FeedEnd = t.Get(t.Column("feed_end_date"));
            return feed;
        }

        private static Dictionary<string, string> LoadTranslations(Func<string, TextReader?> open)
        {
            var result = new Dictionary<string, string>();
            using var r = open("translations.txt");
            if (r == null) return result;
            var t = new CsvTable(r);
            int cTable = t.Column("table_name"), cField = t.Column("field_name"), cLang = t.Column("language"),
                cText = t.Column("translation"), cValue = t.Column("field_value");
            while (t.Read())
            {
                if (!t.Get(cLang).Equals("en", StringComparison.OrdinalIgnoreCase)) continue;
                result[$"{t.Get(cTable)}|{t.Get(cField)}|{t.Get(cValue).Trim()}"] = t.Get(cText).Trim();
            }
            return result;
        }

        private static TextReader Require(Func<string, TextReader?> open, string name) =>
            open(name) ?? throw new InvalidDataException($"GTFS feed is missing {name}");

        private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

        private static string NormalizeColor(string value, string fallback)
        {
            value = value.Trim().TrimStart('#');
            return value.Length == 6 ? value.ToUpperInvariant() : fallback;
        }

        public static TransitType ModeFromRouteType(int routeType) => routeType switch
        {
            0 or 900 => TransitType.Tram,
            1 or 401 => TransitType.Metro,
            11 or 800 => TransitType.Trolleybus,
            3 or 700 => TransitType.Bus,
            _ => TransitType.Bus,
        };

        private static TransitType ModeFromStopId(string stopId)
        {
            var id = stopId.ToUpperInvariant();
            if (id.StartsWith("TM")) return TransitType.Tram;
            if (id.StartsWith("TB")) return TransitType.Trolleybus;
            if (id.StartsWith("M")) return TransitType.Metro;
            if (id.StartsWith("A")) return TransitType.Bus;
            return TransitType.Unknown;
        }

        public static int ModePriority(TransitType mode) => mode switch
        {
            TransitType.Metro => 0,
            TransitType.Tram => 1,
            TransitType.Trolleybus => 2,
            TransitType.Bus => 3,
            _ => 4,
        };

        public static string DefaultColor(TransitType mode) => mode switch
        {
            TransitType.Metro => "2B3C8F",
            TransitType.Tram => "F7941D",
            TransitType.Trolleybus => "27AAE1",
            TransitType.Bus => "BE1E2D",
            _ => "5B6475",
        };
    }
}
