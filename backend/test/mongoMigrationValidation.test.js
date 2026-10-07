const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const backendDirectory = path.join(__dirname, "..");
const migrationScript = path.join(backendDirectory, "scripts", "migrateJsonToMongo.js");
const sourcePath = path.join(backendDirectory, "data", "schema.json");

function runMigrationWithMutation(mutate) {
  const fixturePath = path.join(os.tmpdir(), `zyngram-migration-${crypto.randomUUID()}.json`);
  const data = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  mutate(data);
  fs.writeFileSync(fixturePath, JSON.stringify(data));
  try {
    return spawnSync(process.execPath, [migrationScript, "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, ZYNGRAM_DATA_FILE: fixturePath }
    });
  } finally {
    fs.unlinkSync(fixturePath);
  }
}

test("Mongo migration rejects broken entity references before import", async t => {
  const invalidReferences = [
    {
      name: "order to customer",
      expectedError: /Source collection Orders contains an invalid customer_id reference/,
      mutate(data) {
        data.Orders[0].customer_id = "MISSING-CUSTOMER";
      }
    },
    {
      name: "commission to rule",
      expectedError: /Source collection CommissionLedger contains an invalid rule_id reference/,
      mutate(data) {
        data.CommissionLedger[0].rule_id = "MISSING-RULE";
      }
    },
    {
      name: "commission owner is required",
      expectedError: /Source collection CommissionLedger contains a record without owner_id/,
      mutate(data) {
        data.CommissionLedger[0].owner_id = "";
      }
    },
    {
      name: "employee to department",
      expectedError: /Source collection Employees contains an invalid department_id reference/,
      mutate(data) {
        data.Employees[0].department_id = "MISSING-DEPARTMENT";
      }
    }
  ];

  for (const scenario of invalidReferences) {
    await t.test(scenario.name, () => {
      const result = runMigrationWithMutation(scenario.mutate);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, scenario.expectedError);
      assert.doesNotMatch(result.stdout, /MongoDB import complete/);
    });
  }
});

test("Mongo migration preserves historical commission owner snapshots after reassignment", () => {
  const result = runMigrationWithMutation(data => {
    data.CommissionLedger[0].owner_id = "FORMER-FRANCHISE-OWNER";
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"dryRun": true/);
});
