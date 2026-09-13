#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { scientificHash, implementationHash } from "./contract_tiers.mjs";
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
assert.equal(contract.status, "authorized-unrun-aws");
assert.equal(contract.authorized, true);
assert.equal(contract.ilxyr.system_of_record, "ilxyr");
assert.equal(contract.ilxyr.registration_state, "authorized");
assert.equal(contract.ilxyr.run_authorized, true);
assert.equal(contract.execution.venue, "aws us-east-1 c6i.4xlarge on-demand");
assert.equal(contract.execution.paid_compute_authorized, true);
assert.equal(contract.execution.cost_ceiling_usd, 1.7);
assert.equal(contract.execution.maximum_instance_seconds, 9000);
assert.equal(contract.execution.spot_instances, false);
assert.equal(contract.execution.automatic_termination, true);
assert.equal(contract.authorization.record.supersedes.includes(
  "zero5-c61-shared-state-aws-2026-08-29-v1"), true);
assert.equal(contract.authorization.record.supersedes.includes(
  "superseded by the corrective parser amendment"), true);
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

// Contract tier verification: scientific and implementation hashes
assert.equal(contract.contract_tiers?.schema, "zero.contract_tiers.v1",
  "contract_tiers schema is absent");
assert.equal(scientificHash(contract),
  contract.contract_tiers.scientific_invariants_sha256,
  "scientific invariant hash is stale");
assert.equal(implementationHash(contract),
  contract.contract_tiers.implementation_artifacts_sha256,
  "implementation artifacts hash is stale");

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

// Authorization evidence: the committed record must match the contract binding.
const authorizationEvidence = contract.authorization.record;
const authorization = JSON.parse(fs.readFileSync(
  authorizationEvidence.path, "utf8"));
assert.equal(authorization.schema, "zero.c61_training_authorization.v1");
assert.equal(authorization.authorized, true);
assert.equal(authorization.contract_sha256, sha256(contractPath));
assert.equal(authorization.authorization_id,
  contract.authorization.approval_id);
assert.match(authorization.approved_statement,
  /supersedes zero5-c61-shared-state-aws-2026-08-29-v1/u);
assert.match(authorization.approved_statement,
  /The amendment fixes one defect in the pinned trainer source/u);
assert.equal(authorization.authorization_id, contract.authorization.approval_id);
assert.equal(authorization.scope.experiment, contract.experiment);
assert.equal(authorization.scope.runs, 1);
assert.equal(authorization.scope.seed, contract.training.seed);
assert.equal(authorization.scope.venue, contract.execution.venue);
assert.equal(authorization.scope.maximum_execution_seconds,
  contract.execution.maximum_execution_seconds);
assert.equal(authorization.scope.paid_compute, true);
assert.equal(authorization.ilxyr.registration_id, contract.ilxyr.registration_id);
assert.equal(authorization.ilxyr.run_authorized, true);
assert.match(authorization.approved_statement,
  /I authorize one fresh ZERO\.5 C6\.1 shared-state bottleneck run on AWS/u);
for (const item of ["retries", "promotion", "publication",
  "sealed-test access"]) assert.equal(authorization.not_authorized.join(" ")
  .includes(item), true);

// The runner must accept the authorization and proceed to artifact
// verification (fail-fast on authorization is gone; placeholder paths prove
// the gate opened without requiring private artifacts).
const placeholder = run("node", [contract.implementation.runner,
  "--contract", contractPath, "--authorization", authorizationEvidence.path,
  "--target-import", "/tmp", "--c51-import", "/tmp", "--c43-import", "/tmp",
  "--c0-dir", "/tmp", "--c2-dir", "/tmp", "--c2-import-dir", "/tmp",
  "--control-result", "/tmp/absent.json"], 1);
const combined = `${placeholder.stderr}${placeholder.stdout}`;
assert.match(combined, /is missing|absent|not found/u);
assert.doesNotMatch(combined, /not authorized|authorization does not match/u);

process.stdout.write("ZERO.5 C6.1 Shared-State Bottleneck checks passed\n");
