#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";

function read(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function fileSha256(path) {
  return crypto.createHash("sha256").update(fs.readFileSync(path)).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function close(actual, expected, tolerance = 1e-12) {
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function populationStandardDeviation(values) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

const contractPath = "benchmarks/sero-latent-v3/contract.json";
const contractBytes = fs.readFileSync(contractPath);
const contractDigest = crypto.createHash("sha256").update(contractBytes).digest("hex");
const contract = JSON.parse(contractBytes);
const aggregate = read("benchmarks/sero-latent-v3/aggregate.json");
const results = contract.seeds.map((seed) => read(`benchmarks/sero-latent-v3/seed${seed}.json`));
const awsRuns = read("benchmarks/sero-latent-v3/aws-runs.json");
const awsExecution = read("benchmarks/sero-latent-v3/aws-execution.json");

assert(aggregate.schema === "sero.latent_v3_aggregate.v1", "wrong V3 aggregate schema");
assert(!aggregate.aggregate_override_used, "aggregate override is forbidden");
assert(aggregate.contract_sha256 === contractDigest, "aggregate contract binding drifted");
assert(aggregate.dataset_digest === contract.data.dataset_digest,
  "aggregate dataset binding drifted");
assert(aggregate.tokenizer_sha256 === contract.compute_calibration.tokenizer_sha256,
  "aggregate tokenizer binding drifted");
assert(awsRuns.schema === "sero.latent_v3_aws_runs.v1",
  "wrong V3 AWS run receipt schema");
assert(awsRuns.dataset_digest === contract.data.dataset_digest,
  "AWS run receipt dataset binding drifted");
assert(awsRuns.region === awsExecution.region &&
  awsRuns.instance_type === awsExecution.instance_type &&
  awsRuns.on_demand_usd_per_hour === awsExecution.on_demand_usd_per_hour,
"AWS run receipt environment drifted");
assert(/^[0-9a-f]{64}$/.test(awsRuns.source.archive_sha256),
  "AWS source archive digest is invalid");
assert(awsRuns.promotion_run.decision === aggregate.decision,
  "AWS run receipt decision drifted");
assert(awsRuns.promotion_run.runs.length === contract.seeds.length,
  "AWS run receipt count drifted");
const datasetDigests = new Set();
const tokenizerDigests = new Set();
const trainingSplitDigests = new Set();
const validationSplitDigests = new Set();
const scheduleDigests = new Set();
const runtimeCommits = new Set();
const latentValues = [];
const bpeValues = [];
const qualityRatios = [];

for (const [index, result] of results.entries()) {
  const seed = contract.seeds[index];
  const receipt = awsRuns.promotion_run.runs[index];
  assert(result.schema === "sero.latent_v3_seed_result.v1", `seed ${seed} schema drifted`);
  assert(result.seed === seed, `seed ${seed} ordering drifted`);
  assert(result.contract.sha256 === contractDigest, `seed ${seed} contract drifted`);
  assert(result.data.dataset_digest === contract.data.dataset_digest,
    `seed ${seed} dataset binding drifted`);
  assert(result.tokenizer.sha256 === contract.compute_calibration.tokenizer_sha256,
    `seed ${seed} tokenizer binding drifted`);
  for (const [name, digest] of Object.entries({
    train_split: result.data.train_split_digest,
    validation_split: result.data.validation_split_digest,
    schedule: result.data.schedule_sha256,
    tokenizer_artifact: result.tokenizer.artifact_sha256,
    model_artifact: result.models.artifact_sha256,
  })) assert(/^[0-9a-f]{64}$/.test(digest), `seed ${seed} ${name} digest is invalid`);
  assert(/^[0-9a-f]{40}$/.test(result.runtime.git_commit),
    `seed ${seed} source commit is invalid`);
  assert(result.runtime.git_commit === awsRuns.source.git_commit,
    `seed ${seed} source commit does not match the AWS receipt`);
  assert(receipt.seed === seed && receipt.status === "complete" && receipt.exit_code === 0,
    `seed ${seed} AWS execution did not complete cleanly`);
  assert(receipt.elapsed_instance_seconds <=
    awsExecution.promotion_run.maximum_instance_seconds_each &&
    receipt.estimated_ec2_usd <= awsExecution.promotion_run.maximum_ec2_usd_each,
  `seed ${seed} exceeded the AWS execution ceiling`);
  assert(receipt.result_sha256 === fileSha256(`benchmarks/sero-latent-v3/seed${seed}.json`),
    `seed ${seed} downloaded result does not match the AWS receipt`);
  assert(receipt.model_sha256 === result.models.artifact_sha256 &&
    receipt.tokenizer_artifact_sha256 === result.tokenizer.artifact_sha256 &&
    receipt.dashboard_payload_sha256 === result.telemetry.dashboard_payload_sha256,
  `seed ${seed} artifact receipt drifted`);
  assert(receipt.dashboard_event_key.startsWith(
    `telemetry/runs/${receipt.run_id}/000000000000-`) &&
    /-[0-9a-f]{64}\.json$/.test(receipt.dashboard_event_key),
  `seed ${seed} dashboard receipt is invalid`);
  assert(result.data.unique_training_bytes >= contract.data.minimum_unique_training_bytes,
    `seed ${seed} corpus is below the promotion floor`);
  assert(result.data.document_boundaries_crossed === false,
    `seed ${seed} crossed a document boundary`);
  assert(result.training.raw_byte_context === contract.data.raw_byte_context &&
    result.training.batch_size === contract.data.batch_size,
    `seed ${seed} training shape drifted`);
  assert(JSON.stringify(result.training.requested_byte_budgets) ===
    JSON.stringify(contract.data.training_byte_budgets), `seed ${seed} budgets drifted`);
  assert(result.training.raw_byte_exposure_ratio === 1 &&
    result.training.actual_raw_bytes_per_arm.latent ===
      result.training.actual_raw_bytes_per_arm.bpe_control,
    `seed ${seed} training exposure differs between arms`);
  assert(Object.values(result.data.source_training_exposure_bytes)
    .reduce((total, value) => total + value, 0) ===
      result.training.actual_raw_bytes_per_arm.latent,
  `seed ${seed} source exposure does not sum to the trained bytes`);
  assert(result.validation.complete_split && result.validation.raw_byte_exposure_ratio === 1 &&
    result.validation.raw_bytes_per_arm.latent === result.validation.raw_bytes_per_arm.bpe_control,
    `seed ${seed} validation exposure differs between arms`);
  assert(result.tokenizer.training_bytes === contract.bpe_control.tokenizer_training_bytes &&
    result.tokenizer.maximum_token_bytes === contract.bpe_control.maximum_token_bytes &&
    result.tokenizer.actual_vocabulary_size <= contract.bpe_control.vocabulary_size &&
    result.tokenizer.actual_vocabulary_size >= 256,
    `seed ${seed} tokenizer drifted`);
  assert(result.models.latent_parameters > 0 && result.models.bpe_parameters > 0,
    `seed ${seed} model accounting is missing`);
  assert(result.telemetry.dashboard_payload_sha256.match(/^[0-9a-f]{64}$/) &&
    result.telemetry.published === false,
    `seed ${seed} dashboard payload binding is missing or claims publication`);
  assert(result.checkpoints.length === contract.data.training_byte_budgets.length,
    `seed ${seed} checkpoint count drifted`);

  for (const [checkpointIndex, checkpoint] of result.checkpoints.entries()) {
    assert(checkpoint.requested_training_bytes ===
      contract.data.training_byte_budgets[checkpointIndex],
    `seed ${seed} checkpoint ${checkpointIndex} budget drifted`);
    assert(checkpoint.actual_training_bytes >= checkpoint.requested_training_bytes &&
      checkpoint.actual_training_bytes - checkpoint.requested_training_bytes <
        contract.data.batch_size * contract.data.raw_byte_context,
    `seed ${seed} checkpoint ${checkpointIndex} byte accounting drifted`);
    assert(checkpoint.latent.raw_bytes === checkpoint.bpe_control.raw_bytes,
      `seed ${seed} checkpoint validation bytes differ`);
    assert(close(checkpoint.comparison.latent_to_bpe_bpb_ratio,
      checkpoint.latent.bits_per_byte / checkpoint.bpe_control.bits_per_byte),
      `seed ${seed} quality ratio drifted`);
    assert(close(checkpoint.estimated_inference_compute.latent_to_bpe_ratio,
      checkpoint.estimated_inference_compute.latent_madds_per_sample /
      checkpoint.estimated_inference_compute.bpe_madds_per_sample),
      `seed ${seed} compute ratio drifted`);
    assert(checkpoint.validation_timing.total_seconds > 0 &&
      checkpoint.validation_timing.raw_bytes_per_second > 0,
      `seed ${seed} validation throughput is missing`);
  }

  const final = result.checkpoints.at(-1);
  const expectedComputeGate = final.estimated_inference_compute.latent_to_bpe_ratio >=
    contract.gates.estimated_compute_ratio_minimum &&
    final.estimated_inference_compute.latent_to_bpe_ratio <=
      contract.gates.estimated_compute_ratio_maximum;
  const expectedQualityGate = final.comparison.latent_to_bpe_bpb_ratio <=
    contract.gates.latent_final_bpb_ratio_maximum;
  assert(result.gates.estimated_compute_parity === expectedComputeGate,
    `seed ${seed} compute gate is inconsistent`);
  assert(result.gates.quality_step_change === expectedQualityGate,
    `seed ${seed} quality gate is inconsistent`);
  assert(result.decision.passed === Object.values(result.gates).every(Boolean),
    `seed ${seed} conjunction is inconsistent`);
  assert(result.decision.eligible_for_promotion === true,
    `seed ${seed} is not a full promotion-eligible run`);
  assert(JSON.stringify(result.decision.failed_or_ineligible_gates) === JSON.stringify(
    Object.entries(result.gates).filter(([, passed]) => !passed).map(([name]) => name)),
  `seed ${seed} failed-gate list is inconsistent`);
  assert(result.status === (result.decision.passed ? "passed" : "failed"),
    `seed ${seed} status is inconsistent`);
  datasetDigests.add(result.data.dataset_digest);
  tokenizerDigests.add(result.tokenizer.sha256);
  trainingSplitDigests.add(result.data.train_split_digest);
  validationSplitDigests.add(result.data.validation_split_digest);
  scheduleDigests.add(result.data.schedule_sha256);
  runtimeCommits.add(result.runtime.git_commit);
  latentValues.push(final.latent.bits_per_byte);
  bpeValues.push(final.bpe_control.bits_per_byte);
  qualityRatios.push(final.comparison.latent_to_bpe_bpb_ratio);
  const aggregateSeed = aggregate.seeds[index];
  assert(aggregateSeed.seed === seed && aggregateSeed.status === result.status &&
    aggregateSeed.passed === result.decision.passed &&
    close(aggregateSeed.latent_bits_per_byte, final.latent.bits_per_byte) &&
    close(aggregateSeed.bpe_bits_per_byte, final.bpe_control.bits_per_byte) &&
    close(aggregateSeed.latent_to_bpe_ratio, final.comparison.latent_to_bpe_bpb_ratio) &&
    close(aggregateSeed.bytes_per_learned_chunk, final.latent.bytes_per_chunk) &&
    close(aggregateSeed.bytes_per_bpe_token, final.bpe_control.bytes_per_token) &&
    close(aggregateSeed.estimated_compute_ratio,
      final.estimated_inference_compute.latent_to_bpe_ratio),
    `seed ${seed} aggregate drifted`);
}

assert(datasetDigests.size === 1 && tokenizerDigests.size === 1,
  "dataset or tokenizer changed between seeds");
assert(trainingSplitDigests.size === 1 && validationSplitDigests.size === 1,
  "corpus splits changed between seeds");
assert(scheduleDigests.size === contract.seeds.length,
  "seed schedules are not distinct");
assert(runtimeCommits.size === 1, "source commit changed between seeds");
const promotionCost = awsRuns.promotion_run.runs
  .reduce((total, run) => total + run.estimated_ec2_usd, 0);
const calibrationCost = awsRuns.calibration.attempts
  .reduce((total, run) => total + run.estimated_ec2_usd, 0);
assert(close(awsRuns.promotion_run.estimated_ec2_usd, promotionCost),
  "promotion-run AWS cost total drifted");
assert(close(awsRuns.calibration.estimated_ec2_usd, calibrationCost),
  "calibration AWS cost total drifted");
assert(close(awsRuns.total_estimated_ec2_usd, promotionCost + calibrationCost),
  "total AWS cost drifted");
for (const [name, values] of Object.entries({
  latent_bits_per_byte: latentValues,
  bpe_bits_per_byte: bpeValues,
  latent_to_bpe_ratio: qualityRatios,
})) {
  assert(close(aggregate.means[name], mean(values)), `aggregate ${name} mean drifted`);
  assert(close(aggregate.population_standard_deviations[name],
    populationStandardDeviation(values)), `aggregate ${name} deviation drifted`);
}
const allPassed = results.every((result) => result.decision.passed);
assert(aggregate.all_seed_conjunction_passed === allPassed,
  "aggregate conjunction is inconsistent");
assert(aggregate.decision === (allPassed ? "promote-latent-v3" : "do-not-promote-latent-v3"),
  "aggregate decision is inconsistent");

console.log(`Sero Latent v3 result passed frozen accounting; decision=${aggregate.decision}`);
