using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SofiaTransitMap.Models;
using SofiaTransitMap.Services;

namespace SofiaTransitMap.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class StationsController : ControllerBase
    {
        private readonly StationService _service;

        public StationsController(StationService service)
        {
            _service = service;
        }

        [HttpGet]
        public IActionResult Get(
            [FromQuery] TransitType? type,
            [FromQuery] double? minLat = null,
            [FromQuery] double? maxLat = null,
            [FromQuery] double? minLon = null,
            [FromQuery] double? maxLon = null,
            [FromQuery] int limit = 500)
        {
            var stations = _service.GetStations(type, minLat, maxLat, minLon, maxLon, limit);
            return Ok(stations);
        }


    }
}
