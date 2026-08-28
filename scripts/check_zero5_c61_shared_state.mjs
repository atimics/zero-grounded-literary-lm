#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const contractPath = "benchmarks/zero5-c61-shared-state-v1/contract.json";
const specPath = "benchmarks/zero5-c61-shared-state-v1/SPEC.md";
const contractBytes = fs.readFileSync(contractPath);
const contract = JSON.parse(contractBytes);

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function run(program, args, expected = 0) {
  const result = spawnSync(program, args, { encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, expected,
    `${program} ${args.join(" ")} returned ${result.status}: ` +
      (result.stderr || result.stdout));
  return result;
}

assert.equal(contract.schema, "zero.c61_shared_state_contract.v1");
assert.equal(contract.experiment, "zero5-c61-shared-state-v1");
assert.equal(contract.status, "frozen-awaiting-ilxyr-authorization");
assert.equal(contract.authorized, false);
assert.equal(contract.ilxyr.system_of_record, "ilxyr");
assert.equal(contract.ilxyr.registration_state, "blocked");
assert.equal(contract.ilxyr.run_authorized, false);
assert.equal(sha256(contract.specification.path), contract.specification.sha256);
for (const file of [contractPath, specPath]) {
  const text = fs.readFileSync(file, "utf8");
  assert.equal(text.includes("/Users/"), false, `${file} exposes a user path`);
  assert.equal(text.includes("/private/"), false, `${file} exposes a private path`);
}
for (const name of ["trainer", "importer", "evaluator", "runner",
  "c51_evaluator"]) assert.equal(sha256(contract.implementation[name]),
  contract.implementation[`${name}_sha256`], `${name} changed`);
assert.equal(sha256(contract.control.c51_contract),
  contract.control.c51_contract_sha256);

assert.equal(contract.model.base_parameters, 4852992);
assert.equal(contract.model.bottleneck_width, 152);
assert.equal(contract.model.bottleneck_parameters,
  152 * 256 + 152 + 752 * 152 + 752 + 256 * 152);
assert(contract.model.bottleneck_parameters <=
  contract.model.auxiliary_parameter_ceiling);
assert.equal(contract.model.total_parameters,
  contract.model.base_parameters + contract.model.bottleneck_parameters);
assert(contract.model.total_parameters < 5100000);
assert.equal(contract.treatment.state_decoder_and_answer_bridge_share_bottleneck,
  true);
assert.equal(contract.treatment.random_numbers_added_at_initialization, 0);
assert.equal(contract.training.seed, 0);
assert.equal(contract.training.update_groups, 28707);
assert.equal(contract.training.pack_sequences, 37768);
assert.equal(contract.training.compute_token_exposures, 19337216);
assert.equal(contract.training.auxiliary_events, 293606);
assert.equal(contract.training.auxiliary_loss_weight, .1);
assert.equal(contract.training.bridge_scale, .1);
assert.equal(contract.verified_target_import.primary.choice_a_records,
  contract.verified_target_import.primary.choice_b_records);
assert.equal(contract.execution.venue, "local Apple Silicon");
assert.equal(contract.execution.paid_compute_authorized, false);
assert.equal(contract.execution.cost_ceiling_usd, null);
assert.equal(contract.execution.independent_retry_authorized, false);
assert.equal(contract.claim_boundary.shared_state_bottleneck, true);
assert.equal(contract.claim_boundary.symbolic_serialization, false);
assert.equal(contract.claim_boundary.promotion_authorized, false);
assert.equal(contract.claim_boundary.replication_authorized, false);
assert.equal(contract.claim_boundary.publication_authorized, false);
for (const name of ["content_present", "parsed", "tokenized", "packed",
  "scored", "metrics_opened"]) assert.equal(contract.test[name], false);

const importer = fs.readFileSync(contract.implementation.importer, "utf8");
assert.equal(importer.includes("data/text/test.jsonl"), false);
assert.equal(importer.includes("canonical/test.jsonl"), false);
assert.equal(importer.includes("alignment/test.jsonl"), false);
assert.match(run("node", [contract.implementation.importer, "--self-test"])
  .stdout, /importer self-test passed/u);
assert.match(run("node", [contract.implementation.evaluator, "--self-test"])
  .stdout, /evaluator self-test passed/u);
assert.match(run("node", [contract.implementation.runner, "--self-test"])
  .stdout, /runner self-test passed/u);
assert.match(run("./zero5_c61_bottleneck_lm", ["--self-test"]).stdout,
  /Shared-State Bottleneck self-test passed/u);

const blocked = run("node", [contract.implementation.runner,
  "--contract", contractPath], 1);
assert.match(blocked.stderr, /training is not authorized/u);
assert.equal(fs.existsSync(path.join(path.dirname(contractPath),
  "authorization.json")), false);

process.stdout.write("ZERO.5 C6.1 Shared-State Bottleneck checks passed\n");
