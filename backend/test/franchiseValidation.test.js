const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const fixture = path.join(os.tmpdir(), `zyngram-franchise-${crypto.randomUUID()}.json`);
const command = { id: "CMD-1", level: "Command", name: "Command", owner_id: "OWNER-1", parent_id: null, status: "ACTIVE" };
const hub = { id: "HUB-1", level: "Hub", name: "Hub", owner_id: "OWNER-2", parent_id: command.id, status: "ACTIVE" };
const center = { id: "CTR-1", level: "Center", name: "Center", owner_id: "OWNER-3", parent_id: hub.id, status: "ACTIVE" };
const point = { id: "PNT-1", level: "Point", name: "Point", owner_id: "OWNER-4", parent_id: center.id, status: "ACTIVE" };
const testData = {
  Users: [{ id: "USR-1", name: "Test Customer", status: "ACTIVE" }],
  Franchises: [command, hub, center, point],
  GeoBoundaries: [],
  OrderAttribution: [],
  UserLocations: [{
    id: "LOC-1",
    user_id: "USR-1",
    lat: 17.6868,
    lon: 83.2185,
    accuracy: 10,
    captured_at: new Date().toISOString()
  }],
  GeoMappingCorrections: [],
  AuditLogs: []
};
fs.writeFileSync(fixture, JSON.stringify(testData));
process.env.ZYNGRAM_DATA_FILE = fixture;
const franchiseService = require("../src/services/franchiseService");
const geoBoundaryService = require("../src/services/geoBoundaryService");
const geoMappingService = require("../src/services/geoMappingService");
const attributionService = require("../src/services/attributionService");

test("franchise creation enforces the immediate parent level and active state", () => {
  assert.throws(
    () => franchiseService.createFranchise({ level: "Center", name: "Wrong parent", owner_id: "OWNER-X", parent_id: command.id }),
    { message: "Parent must be an active Hub franchise" }
  );
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  data.Franchises.find(item => item.id === hub.id).status = "INACTIVE";
  fs.writeFileSync(fixture, JSON.stringify(data));
  assert.throws(
    () => franchiseService.createFranchise({ level: "Center", name: "Inactive parent", owner_id: "OWNER-X", parent_id: hub.id }),
    { message: "Parent must be an active Hub franchise" }
  );
  const inactiveCommand = JSON.parse(fs.readFileSync(fixture, "utf8"));
  inactiveCommand.Franchises.find(item => item.id === hub.id).status = "ACTIVE";
  inactiveCommand.Franchises.find(item => item.id === command.id).status = "INACTIVE";
  fs.writeFileSync(fixture, JSON.stringify(inactiveCommand));
  assert.throws(
    () => franchiseService.createFranchise({ level: "Point", name: "Missing ancestor", owner_id: "OWNER-X", parent_id: center.id }),
    { message: "The franchise parent hierarchy must be complete and active" }
  );
});

test("digital hierarchy can be configured above Command and is returned by geo mapping", () => {
  const nation = franchiseService.createFranchise({ level: "Nation", name: "Test Nation", owner_id: "OWNER-NATION" });
  const region = franchiseService.createFranchise({ level: "Region", name: "Test Region", owner_id: "OWNER-REGION", parent_id: nation.id });
  const territory = franchiseService.createFranchise({ level: "Territory", name: "Test Territory", owner_id: "OWNER-TERRITORY", parent_id: region.id });
  const zone = franchiseService.createFranchise({ level: "Zone", name: "Test Zone", owner_id: "OWNER-ZONE", parent_id: territory.id });
  const node = franchiseService.createFranchise({ level: "Node", name: "Test Node", owner_id: "OWNER-NODE", parent_id: zone.id });
  const digitalCommand = franchiseService.createFranchise({ level: "Command", name: "Digital Command", owner_id: "OWNER-DIGITAL-COMMAND", parent_id: node.id });
  const digitalHub = franchiseService.createFranchise({ level: "Hub", name: "Digital Hub", owner_id: "OWNER-DIGITAL-HUB", parent_id: digitalCommand.id });
  const digitalCenter = franchiseService.createFranchise({ level: "Center", name: "Digital Center", owner_id: "OWNER-DIGITAL-CENTER", parent_id: digitalHub.id });
  const digitalPoint = franchiseService.createFranchise({ level: "Point", name: "Digital Point", owner_id: "OWNER-DIGITAL-POINT", parent_id: digitalCenter.id });
  const ring = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67], [83.2, 17.7]];
  geoBoundaryService.createGeoBoundary({
    franchise_id: digitalPoint.id,
    geometry: { type: "Polygon", coordinates: [ring] }
  });

  const mapping = geoMappingService.findFranchiseHierarchy(17.6868, 83.2185);
  assert.equal(mapping.mapped, true);
  assert.deepEqual(
    ["node", "zone", "territory", "region", "nation"].map(level => mapping[level]?.id),
    [node.id, zone.id, territory.id, region.id, nation.id]
  );
  const snapshot = attributionService.createOrderAttribution({ id: "ORDER-DIGITAL" }, mapping);
  assert.deepEqual(
    ["node_id", "zone_id", "territory_id", "region_id", "nation_id"].map(field => snapshot[field]),
    [node.id, zone.id, territory.id, region.id, nation.id]
  );
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  data.GeoBoundaries.find(boundary => boundary.franchise_id === digitalPoint.id).status = "INACTIVE";
  fs.writeFileSync(fixture, JSON.stringify(data));
});

test("boundaries require an active Point and a closed numeric GeoJSON polygon", () => {
  const fixtureData = JSON.parse(fs.readFileSync(fixture, "utf8"));
  fixtureData.Franchises.find(item => item.id === hub.id).status = "ACTIVE";
  fixtureData.Franchises.find(item => item.id === command.id).status = "ACTIVE";
  fs.writeFileSync(fixture, JSON.stringify(fixtureData));
  const openRing = [[83.2, 17.7], [83.24, 17.7], [83.24, 17.67], [83.2, 17.67]];
  assert.throws(
    () => geoBoundaryService.createGeoBoundary({ franchise_id: point.id, geometry: { type: "Polygon", coordinates: [openRing] } }),
    { message: "Polygon rings must be closed" }
  );
  const ring = [...openRing, openRing[0]];
  const boundary = geoBoundaryService.createGeoBoundary({
    franchise_id: point.id,
    version: "test-v1",
    geometry: { type: "Polygon", coordinates: [ring] }
  });
  assert.equal(boundary.version, "test-v1");
  const nextBoundary = geoBoundaryService.createGeoBoundary({
    franchise_id: point.id,
    version: "test-v2",
    geometry: { type: "Polygon", coordinates: [ring] }
  });
  assert.deepEqual(nextBoundary.supersedes, [boundary.id]);
  assert.equal(geoBoundaryService.getGeoBoundaries().find(item => item.id === boundary.id).status, "INACTIVE");
  assert.equal(geoMappingService.findFranchiseHierarchy(17.6868, 83.2185).mapping_version, "test-v2");
  assert.equal(geoMappingService.findFranchiseHierarchy(17.6868, 83.2185).point.id, point.id);
});

test("manual mapping corrections require a reason, persist attribution and take precedence", () => {
  const result = geoMappingService.correctLocationMapping({
    locationId: "LOC-1",
    pointId: point.id,
    reason: "Verified customer address with operations",
    actor: { id: "ADMIN-1", role: "ADMIN" }
  });
  const mapping = geoMappingService.findFranchiseHierarchy(17.6868, 83.2185, "LOC-1");
  assert.equal(mapping.mapping_source, "ADMIN_CORRECTION");
  assert.equal(mapping.correction_id, result.correction.id);
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"));
  assert.equal(data.AuditLogs[0].action, "GEO_MAPPING_CORRECTED");
  assert.equal(data.AuditLogs[0].metadata.reason, "Verified customer address with operations");
});

test.after(() => {
  if (fs.existsSync(fixture)) fs.unlinkSync(fixture);
  delete process.env.ZYNGRAM_DATA_FILE;
});
