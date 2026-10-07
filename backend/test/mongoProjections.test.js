const assert = require("node:assert/strict");
const test = require("node:test");
const { getMongoProjections } = require("../src/services/mongoProjections");

test("MongoDB customer projection contains customer profiles without auth secrets", () => {
  const projections = getMongoProjections({
    Users: [
      { id: "CUSTOMER-1", role: "CUSTOMER", name: "Customer One", email: "customer@example.invalid", status: "ACTIVE" },
      { id: "OWNER-1", role: "CENTER", name: "Owner One" }
    ],
    AuthAccounts: [
      { user_id: "CUSTOMER-1", password_hash: "must-not-be-projected" }
    ],
    Franchises: []
  });

  assert.deepEqual(projections.Customers.map(customer => customer.id), ["CUSTOMER-1"]);
  assert.equal("password_hash" in projections.Customers[0], false);
  assert.deepEqual(projections.FranchiseOwners, []);
});

test("MongoDB franchise-owner projection links known accounts and identifies unlinked references", () => {
  const projections = getMongoProjections({
    Users: [{ id: "OWNER-1", role: "CENTER", name: "Owner One", email: "owner@example.invalid" }],
    AuthAccounts: [{ user_id: "OWNER-1", role: "CENTER", password_hash: "must-not-be-projected" }],
    Franchises: [
      { id: "CENTER-1", level: "Center", owner_id: "OWNER-1" },
      { id: "POINT-1", level: "Point", owner_id: "OWNER-1" },
      { id: "CENTER-2", level: "Center", owner_id: "UNKNOWN-OWNER" }
    ]
  });

  assert.deepEqual(projections.FranchiseOwners, [
    {
      id: "OWNER-1",
      user_id: "OWNER-1",
      name: "Owner One",
      email: "owner@example.invalid",
      mobile: null,
      account_role: "CENTER",
      linkage_status: "LINKED",
      franchise_ids: ["CENTER-1", "POINT-1"],
      franchise_levels: ["Center", "Point"]
    },
    {
      id: "UNKNOWN-OWNER",
      user_id: null,
      name: null,
      email: null,
      mobile: null,
      account_role: null,
      linkage_status: "UNLINKED",
      franchise_ids: ["CENTER-2"],
      franchise_levels: ["Center"]
    }
  ]);
  assert.equal(JSON.stringify(projections.FranchiseOwners).includes("password_hash"), false);
});
