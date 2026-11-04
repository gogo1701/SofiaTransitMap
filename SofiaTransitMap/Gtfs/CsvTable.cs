using System.Text;

namespace SofiaTransitMap.Gtfs
{
    /// <summary>Minimal, allocation-light RFC 4180 reader for GTFS text files.</summary>
    public sealed class CsvTable
    {
        private readonly TextReader _reader;
        private readonly Dictionary<string, int> _columns = new(StringComparer.OrdinalIgnoreCase);
        private readonly List<string> _fields = new();
        private readonly StringBuilder _sb = new();

        public CsvTable(TextReader reader)
        {
            _reader = reader;
            var header = reader.ReadLine();
            if (header == null) return;
            header = header.TrimStart('\uFEFF');
            Split(header);
            for (var i = 0; i < _fields.Count; i++)
                _columns[_fields[i].Trim()] = i;
        }

        public int Column(string name) => _columns.TryGetValue(name, out var i) ? i : -1;

        public bool Read()
        {
            while (true)
            {
                var line = _reader.ReadLine();
                if (line == null) return false;
                if (line.Length == 0) continue;
                Split(line);
                return true;
            }
        }

        public string Get(int column) => column >= 0 && column < _fields.Count ? _fields[column] : string.Empty;

        private void Split(string line)
        {
            _fields.Clear();
            if (line.IndexOf('"') < 0)
            {
                _fields.AddRange(line.Split(','));
                return;
            }

            _sb.Clear();
            var inQuotes = false;
            for (var i = 0; i < line.Length; i++)
            {
                var ch = line[i];
                if (inQuotes)
                {
                    if (ch == '"')
                    {
                        if (i + 1 < line.Length && line[i + 1] == '"') { _sb.Append('"'); i++; }
                        else inQuotes = false;
                    }
                    else _sb.Append(ch);
                }
                else if (ch == '"') inQuotes = true;
                else if (ch == ',') { _fields.Add(_sb.ToString()); _sb.Clear(); }
                else _sb.Append(ch);
            }
            _fields.Add(_sb.ToString());
        }

        /// <summary>GTFS times are HH:MM:SS and may exceed 24:00:00 for trips running past midnight.</summary>
        public static int ParseTime(string value)
        {
            if (string.IsNullOrEmpty(value)) return -1;
            var parts = value.Trim().Split(':');
            if (parts.Length != 3) return -1;
            return int.Parse(parts[0]) * 3600 + int.Parse(parts[1]) * 60 + int.Parse(parts[2]);
        }
    }
}
