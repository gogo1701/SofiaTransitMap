namespace SofiaTransitMap.Models
{
    public class Station
    {
        public string StopId { get; set; }
        public string StopCode { get; set; }
        public string StopName { get; set; }
        public double Latitude { get; set; }
        public double Longitude { get; set; }
        public TransitType TransitType { get; set; }
    }
}
