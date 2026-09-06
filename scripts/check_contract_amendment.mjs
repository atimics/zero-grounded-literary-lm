#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { diffContracts, scientificHash, implementationHash } from "./contract_tiers.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  if (index + 1 >= process.argv.length) {
    process.stderr.write(`error: missing value for ${name}\n`);
    process.exit(1);
  }
  return process.argv[index + 1];
}

function selfTest() {
  const base = {
    schema: "zero.c61_shared_state_contract.v1",
    experiment: "test",
    training: { seed: 0, update_groups: 100 },
    gates: { threshold: 0.5 },
    implementation: { trainer: "a.c", trainer_sha256: "aaa" },
    status: "authorized",
  };
  const implOnlyAmended = { ...base,
    implementation: { trainer: "a.c", trainer_sha256: "bbb" },
    status: "authorized-unrun",
  };
  const report = diffContracts(base, implOnlyAmended);
  assert.equal(report.scientific_unchanged, true);
  assert.equal(report.resume_valid, true);
  assert.deepEqual(report.changed_scientific_fields, []);
  assert.deepEqual(report.changed_implementation_fields, ["implementation"]);

  const scientificChanged = { ...base,
    training: { seed: 1, update_groups: 100 },
  };
  const report2 = diffContracts(base, scientificChanged);
  assert.equal(report2.scientific_unchanged, false);
  assert.equal(report2.resume_valid, false);
  assert.deepEqual(report2.changed_scientific_fields, ["training"]);

  process.stdout.write("contract amendment diff checker self-test passed\n");
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const previousPath = option("--previous");
const amendedPath = option("--amended");
if (!previousPath || !amendedPath) {
  process.stderr.write(
    "usage: check_contract_amendment.mjs --previous <prev.json> --amended <new.json>\n");
  process.exit(1);
}

const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
const amended = JSON.parse(fs.readFileSync(amendedPath, "utf8"));
const report = diffContracts(previous, amended);

process.stdout.write(JSON.stringify({
  schema: "zero.contract_amendment_report.v1",
  previous_contract: path.basename(previousPath),
  amended_contract: path.basename(amendedPath),
  ...report,
}, null, 2) + "\n");

if (!report.resume_valid) {
  process.stderr.write(
    `error: amendment changed scientific fields: ${report.changed_scientific_fields.join(", ")}; ` +
    `checkpoints are invalidated\n`);
  process.exit(1);
}
