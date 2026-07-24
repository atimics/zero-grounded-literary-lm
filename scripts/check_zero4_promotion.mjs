import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const EXPECTED = Object.freeze({
  aggregateSha256: "246274e15bcdcea7e337a01bdf415b72251f010fb411b8a1c0ac879d0ddc5d71",
  completionSha256: "523e305d099aba1735f1cb72b2278ede72a873c840b798c37b9b51a2d8339509",
  historicalChannelModelSha256: "05b9824d54f9d290ea472c3da8f9791c3d18fb3775419bd408a7e803012c7c24",
  modelSha256: "44b32f2262be2754fd2eeaf16ed206bae32b4ce30d7f5541a1059cd21257ae50",
  resultSha256: "6fba7b46a00c881ab129ea706125fee0924d897836784274275ae9517805eb5f",
  resultsCommit: "bde7875bdc3947bb4203fe3b8eccc8fb6488bda6",
});

const paths = Object.freeze({
  aggregate: "benchmarks/zero4-q26r-v1/aggregate.json",
  completion: "benchmarks/zero4-q26r-v1/aws-v2/COMPLETED",
  contract: "zero4-contract.json",
  deployment: "docs/model.json",
  deployedModel: "docs/model.litq8",
  historicalChannelManifest: "benchmarks/zero-channel-v1/manifest.json",
  historicalChannelModel: "benchmarks/zero-channel-v1/model.litq8",
  sourceModel: "benchmarks/zero4-q26-v1/seed2/selected.litq8",
  sourceResult: "benchmarks/zero4-q26-v1/seed2/result.json",
});

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

for (const file of Object.values(paths)) {
  assert(fs.existsSync(file), `promotion input missing: ${file}`);
}

assert.equal(sha256(paths.aggregate), EXPECTED.aggregateSha256, "frozen aggregate drifted");
assert.equal(sha256(paths.completion), EXPECTED.completionSha256, "AWS completion record drifted");
assert.equal(sha256(paths.sourceResult), EXPECTED.resultSha256, "seed-2 source result drifted");
assert.equal(sha256(paths.sourceModel), EXPECTED.modelSha256, "seed-2 promotion candidate drifted");
assert.equal(sha256(paths.deployedModel), EXPECTED.modelSha256, "deployed model is not the promoted candidate");
assert.equal(sha256(paths.historicalChannelModel), EXPECTED.historicalChannelModelSha256, "historical channel benchmark model drifted");
assert.equal(fs.statSync(paths.sourceModel).size, 4_920_400, "promotion candidate byte count drifted");
assert(fs.readFileSync(paths.sourceModel).equals(fs.readFileSync(paths.deployedModel)), "deployed model bytes differ from the frozen candidate");

const aggregate = readJson(paths.aggregate);
assert.equal(aggregate.schema, "zero.zero4_q26_multiseed.v1");
assert.equal(aggregate.decision, "go");
assert.equal(aggregate.promotion_eligible, true);
assert.equal(aggregate.promotion_blocker, null);
assert.deepEqual(aggregate.declared_seeds, [1, 2, 3]);
assert.deepEqual(aggregate.completed_seeds, [1, 2, 3]);
assert.equal(aggregate.current_model, "ZERO.4");
assert.equal(aggregate.promoted_model?.source_seed, 2);
assert.equal(aggregate.promoted_model?.path, paths.sourceModel);
assert.equal(aggregate.promoted_model?.sha256, EXPECTED.modelSha256);
for (const seed of ["1", "2", "3"]) {
  assert.equal(aggregate.results?.[seed]?.decision, "go", `seed ${seed} did not resolve go`);
  assert.equal(aggregate.results?.[seed]?.promotion_evaluated, true, `seed ${seed} promotion was not evaluated`);
  assert.equal(aggregate.results?.[seed]?.promotion_passed, true, `seed ${seed} promotion did not pass`);
}

const completion = readJson(paths.completion);
assert.equal(completion.source_run_id, "30126034960");
assert.equal(completion.source_commit, "e6e717a53d6903b71d8f563104ec9ce75c65ce11");
assert.deepEqual(completion.seeds, [1, 3]);
assert.equal(completion.new_training_started_by_collector, false);
assert.equal(completion.collector_waited_for_compute, false);

const sourceResult = readJson(paths.sourceResult);
assert.equal(sourceResult.seed, 2);
assert.equal(sourceResult.decision, "go");
assert.equal(sourceResult.selected?.committed, 500);
assert.equal(sourceResult.selected?.feasible, true);
assert.equal(sourceResult.promotion?.evaluatedOnceAtEnd, true);
assert.equal(sourceResult.promotion?.quantityPass, true);
assert.equal(sourceResult.artifacts?.quantizedSha256, EXPECTED.modelSha256);

const deployment = readJson(paths.deployment);
assert.equal(deployment.schema, "zero.deployed_model.v1");
assert.equal(deployment.id, "zero4");
assert.equal(deployment.display_name, "ZERO.4");
assert.equal(deployment.status, "promoted");
assert.equal(deployment.architecture?.parameters, 4_852_992);
assert.equal(deployment.architecture?.context, 512);
assert.equal(deployment.architecture?.runtime_update, 500);
assert.equal(deployment.artifact?.path, paths.deployedModel);
assert.equal(deployment.artifact?.source_path, paths.sourceModel);
assert.equal(deployment.artifact?.source_seed, 2);
assert.equal(deployment.artifact?.sha256, EXPECTED.modelSha256);
assert.equal(deployment.artifact?.source_sha256, EXPECTED.modelSha256);
assert.equal(deployment.artifact?.bytes, 4_920_400);
assert.equal(deployment.promotion?.aggregate_sha256, EXPECTED.aggregateSha256);
assert.equal(deployment.promotion?.completion_sha256, EXPECTED.completionSha256);
assert.equal(deployment.promotion?.source_result_sha256, EXPECTED.resultSha256);
assert.equal(deployment.promotion?.merged_results_commit, EXPECTED.resultsCommit);
assert.equal(deployment.promotion?.family_decision, "go");
assert.equal(deployment.promotion?.promotion_eligible, true);

const historicalChannelManifest = readJson(paths.historicalChannelManifest);
assert.equal(historicalChannelManifest.baseline_model?.path, paths.historicalChannelModel);
assert.equal(historicalChannelManifest.baseline_model?.sha256, EXPECTED.historicalChannelModelSha256);

const contract = readJson(paths.contract);
assert.equal(contract.status, "promoted_q26_three_seed_go");
assert.equal(contract.current_model?.id, "ZERO.4");
assert.equal(contract.current_model?.artifact_sha256, EXPECTED.modelSha256);
assert.equal(contract.latest_experiment?.id, "zero4-q26r-three-seed-replication");
assert.equal(contract.latest_experiment?.decision, "go_promote_zero4");
assert.deepEqual(contract.latest_experiment?.completed_seeds, [1, 2, 3]);
assert.equal(contract.latest_experiment?.promotion_eligible, true);

console.log(`OK ZERO.4 promotion: ${EXPECTED.modelSha256}`);
