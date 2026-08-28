#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const directory = "benchmarks/zero5-c43-v1";
const read = name => fs.readFileSync(`${directory}/${name}`);
const parse = name => JSON.parse(read(name));
const digest = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const close = (left, right, tolerance = 1e-12) =>
  Math.abs(left - right) <= tolerance;

const contract = parse("contract.json");
const result = parse("result.json");
const publication = parse("publication.json");

assert.equal(result.schema, "zero.c43_public_result.v1");
assert.equal(result.experiment, contract.experiment);
assert.equal(result.status, "complete-no-go");
assert.equal(result.contract_sha256, digest(read("contract.json")));
assert.equal(result.contract_sha256,
  "0cf7390dbc188d444d723eee6ca7c0ceba3c5c00aec23b1de3f1a827fa3f16dc");
assert.equal(result.training_authorization_id,
  contract.authorization.approval_id);
assert.equal(result.source.braid_release_id, contract.braid.release_id);
assert.equal(result.source.zero_commit,
  "5a4693b786bf5500895f31ecd2e37e29248271da");
assert.equal(result.source.private_execution_sha256,
  "d863ec083ad1ed10d0821a03588d7f5bac592193f8ed676c98798a6fb9504535");
assert.equal(result.source.private_result_sha256,
  "3e1a33e4c0a3a630239a3fefc02ecca2f8c4a76ca7983a9c0efbac4e875130ca");
assert.equal(result.source.private_validation_sha256,
  "27434f18f7066fbf3089b9cda7930b9373f2a563a799786a5fc84b603735ca23");
assert.equal(result.source.private_training_log_sha256,
  "0716b974f5e753e8e038d624117557f141b700f447fe4a3c422d35dae9075cfb");

assert.equal(publication.schema,
  "zero.c43_result_publication_authorization.v1");
assert.equal(publication.approval_id,
  "zero5-c43-result-publication-2026-08-28-v1");
assert.equal(publication.approved_statement, "I agree with that scope");
assert.equal(publication.training_authorization_id,
  result.training_authorization_id);
assert.equal(publication.source_private_result_sha256,
  result.source.private_result_sha256);
assert.equal(publication.public_result.path,
  "benchmarks/zero5-c43-v1/result.json");
assert.equal(publication.public_result.sha256, digest(read("result.json")));
assert.equal(publication.public_result.sha256,
  "ebcf20bf7214f7b99b1425bcd74e3545de7a079268536fde93aeb4d456dbfb74");
assert.equal(publication.public_result.bytes, read("result.json").length);

for (const [name, expected] of [
  ["trainer", result.implementation.trainer_sha256],
  ["runner", result.implementation.runner_sha256],
  ["evaluator", result.implementation.evaluator_sha256],
]) {
  assert.equal(expected, contract.implementation[`${name}_sha256`]);
}
assert.equal(result.implementation.math_backend,
  contract.execution.math_backend);
assert.equal(result.implementation.attention_backend,
  contract.execution.attention_backend);

const training = result.training;
const expected = contract.verified_import.primary;
assert.equal(training.completed_updates, contract.training.update_groups);
assert(training.elapsed_seconds > 0);
assert(training.elapsed_seconds < contract.execution.maximum_execution_seconds);
assert(close(training.aggregate_compute_tokens_per_second,
  expected.compute_token_exposures / training.elapsed_seconds));
assert.equal(training.selected_checkpoint_update, 28500);
assert.equal(training.selected_checkpoint_validation_nats_per_token, 1.9804);
assert.equal("reports" in training, false);
assert.equal(training.accounting.pack_sequences, expected.packs);
assert.equal(training.accounting.compute_token_exposures,
  expected.compute_token_exposures);
assert.equal(training.accounting.active_targets, expected.active_targets);
assert.equal(training.accounting.answer_targets, expected.answer_targets.total);
assert.equal(training.accounting.claim_answer_targets,
  expected.answer_targets_by_task.claim);
assert.equal(training.accounting.cloze_answer_targets,
  expected.answer_targets_by_task.cloze);
assert.equal(training.accounting.retrieval_answer_targets,
  expected.answer_targets_by_task.retrieval);
assert.equal(training.accounting.padding_targets, expected.padding_targets);
assert.equal(training.accounting.wraps, 0);

assert.equal(result.checkpoints.published, false);
assert.equal(result.checkpoints.active.sha256,
  "8370dc7e837292798f4afcfcb8c789b123358e43de37039aebe89f92f5223c48");
assert.equal(result.checkpoints.best.sha256,
  "31a6fef359204939fe70f3e8914096bf9c3d9ea27f7e7fc84a79272751aeaec9");
assert.equal(result.checkpoints.active.bytes, 58236496);
assert.equal(result.checkpoints.best.bytes, 58236496);

const validation = result.validation;
const candidate = validation.candidate;
const baseline = validation.baseline;
const derived = validation.derived;
const gates = validation.gates;
assert(close(derived.combined_relative_improvement,
  1 - candidate.combined_nats_per_token / baseline.combined_nats_per_token));
assert(close(derived.evidence_relative_regression,
  candidate.evidence_nats_per_token / baseline.evidence_nats_per_token - 1));
assert(close(derived.atlas_relative_regression,
  candidate.atlas_nats_per_token / baseline.atlas_nats_per_token - 1));
assert(close(derived.anchor_relative_regression,
  candidate.anchor_nats_per_token / baseline.anchor_nats_per_token - 1));
assert(close(derived.cloze_exact_improvement,
  candidate.cloze.teacher_forced_exact_accuracy -
    baseline.cloze.teacher_forced_exact_accuracy));
for (const task of ["claim", "retrieval"]) {
  assert(close(derived.choice_improvement[task],
    candidate.choice[task].choice_accuracy -
      baseline.choice[task].choice_accuracy));
  assert(close(derived.swap_regression[task],
    baseline.choice[task].swap_consistency_accuracy -
      candidate.choice[task].swap_consistency_accuracy));
  assert(close(derived.pair_exact_improvement[task],
    candidate.choice[task].pair_exact_accuracy -
      baseline.choice[task].pair_exact_accuracy));
}

assert.equal(gates.combined_validation_step,
  derived.combined_relative_improvement >=
    contract.gates.combined_relative_improvement_minimum);
assert.equal(gates.cloze_exact_step,
  derived.cloze_exact_improvement >=
    contract.gates.cloze_exact_improvement_minimum);
assert.equal(gates.evidence_retention,
  derived.evidence_relative_regression <=
    contract.gates.evidence_relative_regression_maximum);
assert.equal(gates.atlas_retention,
  candidate.atlas_nats_per_token <= contract.gates.atlas_nats_per_token_maximum);
assert.equal(gates.anchor_retention,
  candidate.anchor_nats_per_token <=
    contract.gates.anchor_nats_per_token_maximum);
for (const task of ["claim", "retrieval"]) {
  const choice = candidate.choice[task];
  assert.equal(gates[`${task}_choice_accuracy`],
    choice.choice_accuracy >= contract.gates.choice_accuracy_minimum[task] &&
    derived.choice_improvement[task] >=
      contract.gates.choice_improvement_minimum);
  assert.equal(gates[`${task}_position_accuracy`],
    choice.position_0_accuracy >= contract.gates.position_accuracy_minimum &&
    choice.position_1_accuracy >= contract.gates.position_accuracy_minimum &&
    Math.abs(choice.position_0_accuracy - choice.position_1_accuracy) <=
      contract.gates.position_gap_maximum[task]);
  assert.equal(gates[`${task}_swap_consistency`],
    choice.swap_consistency_accuracy >=
      contract.gates.swap_consistency_minimum[task] &&
    derived.swap_regression[task] <=
      contract.gates.swap_regression_maximum[task]);
  assert.equal(gates[`${task}_pair_exact`],
    derived.pair_exact_improvement[task] >=
      contract.gates.pair_exact_improvement_minimum);
}

const numeric = [];
const collectNumbers = value => {
  if (typeof value === "number") numeric.push(value);
  else if (value && typeof value === "object") {
    for (const child of Object.values(value)) collectNumbers(child);
  }
};
collectNumbers({ training, baseline, candidate, derived });
assert(numeric.every(Number.isFinite));
assert.equal(gates.finite_metrics, true);
assert.equal(gates.sealed_test_stayed_closed, true);
assert.equal(gates.test_metrics_opened, false);
assert.equal(result.decision.outcome, "no-go");
assert.equal(result.decision.eligible_for_promotion, false);
assert.deepEqual(result.decision.failed_gates,
  ["cloze_exact_step", "retrieval_choice_accuracy"]);
assert.equal(result.decision.test_metrics_opened, false);
assert.equal(result.decision.promotion_authorized, false);

assert.deepEqual(result.publication_boundary, {
  result_metrics_published: true,
  accounting_published: true,
  hashes_published: true,
  corpus_published: false,
  checkpoints_published: false,
  raw_logs_published: false,
  generations_published: false,
  sealed_test_opened: false,
});
for (const name of ["result.json", "publication.json", "RESULT.md"]) {
  const text = read(name).toString("utf8");
  assert.equal(text.includes("/Users/"), false, `${name} exposes a user path`);
  assert.equal(text.includes("/private/"), false,
    `${name} exposes a private path`);
}
assert.equal(fs.readdirSync(directory).some(name =>
  /\.(?:ckpt|z5pack|log)$/u.test(name)), false);

process.stdout.write("ZERO.5 C4.3 public no-go result verified\n");
