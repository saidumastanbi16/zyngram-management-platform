const assert = require("node:assert/strict");
const test = require("node:test");
const { isPointInsidePolygon } = require("../src/services/geoMappingService");

const visakhapatnamBoundary = [
  [83.2, 17.7],
  [83.24, 17.7],
  [83.24, 17.67],
  [83.2, 17.67],
  [83.2, 17.7]
];

test("maps latitude and longitude against GeoJSON longitude-latitude polygon coordinates", () => {
  assert.equal(isPointInsidePolygon(17.6868, 83.2185, visakhapatnamBoundary), true);
  assert.equal(isPointInsidePolygon(17.6868, 78.5616, visakhapatnamBoundary), false);
});
