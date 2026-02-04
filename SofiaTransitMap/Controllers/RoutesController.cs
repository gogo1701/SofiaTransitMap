using Microsoft.AspNetCore.Mvc;
using SofiaTransitMap.Services;

namespace SofiaTransitMap.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class RoutesController : ControllerBase
    {
        private readonly RouteService _service;

        public RoutesController(RouteService service)
        {
            _service = service;
        }

        [HttpGet]
        public IActionResult GetAll([FromQuery] string? search = null)
        {
            var routes = string.IsNullOrWhiteSpace(search) 
                ? _service.GetAllRoutes() 
                : _service.SearchRoutes(search);
            
            return Ok(routes);
        }

        [HttpGet("{lineNumber}")]
        public IActionResult GetByLineNumber(string lineNumber)
        {
            var routeDetails = _service.GetRouteDetails(lineNumber);
            
            if (routeDetails == null)
                return NotFound(new { message = $"Route '{lineNumber}' not found" });

            return Ok(routeDetails);
        }

        [HttpGet("{lineNumber}/shape")]
        public IActionResult GetRouteShape(string lineNumber)
        {
            var routeDetails = _service.GetRouteDetails(lineNumber);
            
            if (routeDetails == null)
                return NotFound(new { message = $"Route '{lineNumber}' not found" });

            return Ok(routeDetails.Shapes);
        }
    }
}
