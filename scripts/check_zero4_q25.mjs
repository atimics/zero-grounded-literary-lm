#!/usr/bin/env node

import fs from "node:fs";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function close(left, right, tolerance = 1e-7) {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right));
}

function checkContract(contract) {
  assert(contract.schema === "zero.zero4_q25_contract.v1", "wrong contract schema");
  assert(contract.status === "preregistered", "contract is not preregistered");
  assert(contract.diagnostic_seed === 2, "diagnostic seed must be 2");
  assert(JSON.stringify(contract.sealed_replication_seeds) === "[1,3]", "seeds 1 and 3 must remain sealed");
  assert(contract.quantity_corpus.promotion_inaccessible_during_training === true, "promotion split is not sealed");
  assert(contract.guard.mode === "cumulative-backtracking", "wrong guard mode");
  assert(contract.guard.probe_every_attempts === 1, "backtracking guard must probe every attempt");
  assert(contract.guard.all_replay_ranges_required_per_trial === 6, "all six replay ranges are required per trial");
  assert(contract.guard.warning_relative_increase === 0.01, "warning threshold changed");
  assert(contract.guard.hard_relative_increase === 0.015, "hard threshold changed");
  assert(contract.guard.public_replay_ceiling === 0.02, "public replay ceiling changed");
  assert(contract.guard.maximum_trials_per_outer_attempt === 8, "backtracking trial count changed");
  assert(contract.guard.maximum_consecutive_exhausted_attempts === 8, "outer rejection fallback changed");
  assert(JSON.stringify(contract.guard.trial_scales) === "[1,0.5,0.25,0.125,0.0625,0.03125,0.015625,0.0078125]", "trial scale schedule changed");
  assert(contract.guard.selection_policy === "first feasible trial in descending scale order", "trial selection policy changed");
  assert(contract.guard.projection_enabled === false, "projection is not admitted in Q2.5 v1");
  assert(Object.values(contract.immutable_teachers).every((hash) => /^[0-9a-f]{64}$/.test(hash)), "invalid teacher hash");
  assert(Object.values(contract.replay_corpus).every((hash) => /^[0-9a-f]{64}$/.test(hash)), "invalid replay corpus hash");
}

function checkTrial(trial, attempt, contract, trialIndex) {
  const expectedScale = contract.guard.trial_scales[trialIndex];
  assert(trial.index === trialIndex, "backtracking trial index drifted");
  assert(close(trial.scale, expectedScale, 1e-12), "backtracking trial scale drifted");
  assert(close(trial.learning_rate, attempt.base_learning_rate * expectedScale, 1e-9), "scaled learning rate is inconsistent");
  assert(["retry", "accept", "reject"].includes(trial.decision), "invalid trial decision");
  assert(Array.isArray(trial.ranges) && trial.ranges.length === contract.guard.all_replay_ranges_required_per_trial, "trial did not evaluate all replay ranges");
  const rangeIds = trial.ranges.map((entry) => entry.replay_range);
  assert(new Set(rangeIds).size === rangeIds.length, "trial contains duplicate replay ranges");
  const nonFinite = trial.candidate_mean === null || trial.relative_change === null;
  if (nonFinite) {
    assert(trial.ranges.some((entry) => entry.candidate === null), "non-finite trial lacks a non-finite range");
    return { feasible: false };
  }
  assert(finite(trial.candidate_mean) && finite(trial.relative_change), "invalid trial composite");
  assert(trial.ranges.every((entry) => finite(entry.candidate)), "invalid trial range candidate");
  const candidateMean = trial.ranges.reduce((sum, entry) => sum + entry.candidate, 0) / trial.ranges.length;
  const relative = (candidateMean - attempt.cumulative_probe_baseline) / attempt.cumulative_probe_baseline;
  assert(close(candidateMean, trial.candidate_mean, 1e-6), "trial candidate mean is inconsistent");
  assert(close(relative, trial.relative_change), "trial relative change is inconsistent");
  return { feasible: relative <= contract.guard.hard_relative_increase };
}

function checkAttempt(attempt, contract) {
  const required = ["attempt", "proposed_committed_update", "committed_update", "phase", "mode", "source_mask", "source_ids", "replay_range", "learning_rate", "base_learning_rate", "accepted_scale", "backtrack_trial_count", "backtrack_trials", "guard_budget", "functional_probe", "probe_before", "probe_after", "relative_probe_change", "faculty_replay_gradient_cosine", "gradient_norm", "displacement_norm", "predicted_replay_drift", "fisher_weighted_drift", "decision", "reason", "rollback_digest", "cumulative_probe_baseline", "cumulative_probe_after", "cumulative_relative_change", "cumulative_ranges", "groups"];
  assert(attempt.schema === "zero.optimizer_attempt.v3", "wrong attempt schema");
  for (const field of required) assert(Object.hasOwn(attempt, field), `attempt missing ${field}`);
  assert(Number.isInteger(attempt.attempt) && attempt.attempt >= 1, "invalid attempt id");
  assert(attempt.mode === "cumulative-backtracking", "invalid transaction mode");
  assert(attempt.functional_probe === true, "cumulative functional probe was skipped");
  assert(close(attempt.guard_budget, contract.guard.hard_relative_increase), "guard budget differs from contract");
  assert(["accept", "reject"].includes(attempt.decision), "invalid outer decision");
  assert(/^[0-9a-f]{16}$/.test(attempt.source_mask), "invalid source mask");
  assert(Array.isArray(attempt.source_ids) && attempt.source_ids.length > 0 && attempt.source_ids.every(Number.isInteger), "invalid source ids");
  const mask = BigInt(`0x${attempt.source_mask}`);
  const expectedSourceIds = Array.from({ length: 64 }, (_, index) => index).filter((index) => (mask & (1n << BigInt(index))) !== 0n);
  assert(JSON.stringify(attempt.source_ids) === JSON.stringify(expectedSourceIds), "source ids do not match source mask");
  assert(/^[0-9a-f]{16}$/.test(attempt.rollback_digest), "invalid rollback digest");
  assert(finite(attempt.base_learning_rate) && attempt.base_learning_rate >= 0, "invalid base learning rate");
  assert(finite(attempt.cumulative_probe_baseline) && attempt.cumulative_probe_baseline > 0, "invalid cumulative baseline");
  assert(Number.isInteger(attempt.backtrack_trial_count) && attempt.backtrack_trial_count >= 1 && attempt.backtrack_trial_count <= contract.guard.maximum_trials_per_outer_attempt, "invalid backtracking trial count");
  assert(Array.isArray(attempt.backtrack_trials) && attempt.backtrack_trials.length === attempt.backtrack_trial_count, "backtracking trial log is incomplete");
  const verdicts = attempt.backtrack_trials.map((trial, index) => checkTrial(trial, attempt, contract, index));
  const finalTrial = attempt.backtrack_trials.at(-1);
  const finalVerdict = verdicts.at(-1);
  for (let index = 0; index + 1 < verdicts.length; ++index) {
    assert(verdicts[index].feasible === false && attempt.backtrack_trials[index].decision === "retry", "backtracking skipped an earlier feasible trial");
  }
  assert(Array.isArray(attempt.cumulative_ranges) && attempt.cumulative_ranges.length === contract.guard.all_replay_ranges_required_per_trial, "parent cumulative range log is incomplete");
  for (let index = 0; index < attempt.cumulative_ranges.length; ++index) {
    const parent = attempt.cumulative_ranges[index];
    const trial = finalTrial.ranges[index];
    assert(parent.replay_range === trial.replay_range && ((parent.candidate === null && trial.candidate === null) || (finite(parent.candidate) && finite(trial.candidate) && close(parent.candidate, trial.candidate, 1e-12))), "parent range does not match selected trial");
  }
  assert((attempt.cumulative_probe_after === null && finalTrial.candidate_mean === null) || (finite(attempt.cumulative_probe_after) && finite(finalTrial.candidate_mean) && close(attempt.cumulative_probe_after, finalTrial.candidate_mean, 1e-12)), "parent candidate mean does not match selected trial");
  assert((attempt.cumulative_relative_change === null && finalTrial.relative_change === null) || (finite(attempt.cumulative_relative_change) && finite(finalTrial.relative_change) && close(attempt.cumulative_relative_change, finalTrial.relative_change, 1e-12)), "parent relative change does not match selected trial");
  assert(close(attempt.learning_rate, finalTrial.learning_rate, 1e-9), "parent learning rate does not match selected trial");
  if (attempt.decision === "accept") {
    assert(finalVerdict.feasible && finalTrial.decision === "accept", "accepted attempt lacks a feasible selected trial");
    assert(close(attempt.accepted_scale, finalTrial.scale, 1e-12), "accepted scale does not match selected trial");
    assert(attempt.committed_update === attempt.proposed_committed_update, "accepted attempt did not advance committed update");
    assert(attempt.rollback_digest === "0000000000000000", "accepted attempt has a rollback digest");
    assert(attempt.reason === (attempt.backtrack_trial_count === 1 ? "within-cumulative-replay-budget" : "backtracked-within-cumulative-replay-budget"), "accepted attempt reason is inconsistent");
  } else {
    assert(!finalVerdict.feasible && finalTrial.decision === "reject", "rejected attempt ended on a feasible trial");
    assert(attempt.backtrack_trial_count === contract.guard.maximum_trials_per_outer_attempt, "outer attempt rejected before exhausting scales");
    assert(attempt.accepted_scale === null, "rejected attempt has an accepted scale");
    assert(attempt.committed_update + 1 === attempt.proposed_committed_update, "rejection changed committed update");
    assert(attempt.rollback_digest !== "0000000000000000", "rejection lacks rollback proof");
    assert(attempt.reason === "cumulative-backtracking-exhausted", "rejected attempt reason is inconsistent");
  }
  assert(Array.isArray(attempt.groups) && attempt.groups.length > 0, "missing group diagnostics");
}

function makeRanges(candidate) {
  return Array.from({ length: 6 }, (_, replay_range) => ({ replay_range, candidate }));
}
function makeCumulativeRanges(candidate) {
  return Array.from({ length: 6 }, (_, replay_range) => ({ replay_range, baseline: 1, candidate, relative_change: candidate - 1 }));
}
function baseAttempt(overrides = {}) {
  return { schema: "zero.optimizer_attempt.v3", attempt: 1, proposed_committed_update: 1, committed_update: 1, phase: "smoke", mode: "cumulative-backtracking", source_mask: "0000000000000001", source_ids: [0], replay_range: 0, learning_rate: 0.05, base_learning_rate: 0.1, accepted_scale: 0.5, backtrack_trial_count: 2, backtrack_trials: [{ index: 0, scale: 1, learning_rate: 0.1, candidate_mean: 1.02, relative_change: 0.02, decision: "retry", ranges: makeRanges(1.02) }, { index: 1, scale: 0.5, learning_rate: 0.05, candidate_mean: 1.01, relative_change: 0.01, decision: "accept", ranges: makeRanges(1.01) }], guard_budget: 0.015, functional_probe: true, probe_before: 1, probe_after: 1.01, relative_probe_change: 0.01, faculty_replay_gradient_cosine: -0.5, gradient_norm: 1, displacement_norm: 0.1, predicted_replay_drift: 0.2, fisher_weighted_drift: 0.3, decision: "accept", reason: "backtracked-within-cumulative-replay-budget", rollback_digest: "0000000000000000", cumulative_probe_baseline: 1, cumulative_probe_after: 1.01, cumulative_relative_change: 0.01, cumulative_ranges: makeCumulativeRanges(1.01), groups: [{ id: "token_embedding", replay_drift: 0.2, displacement_norm: 0.1, fisher_weighted_drift: 0.3 }], ...overrides };
}

function selfTest() {
  const contract = readJson("benchmarks/zero4-q25-v1/contract.json");
  checkContract(contract);
  checkAttempt(baseAttempt(), contract);
  const trials = contract.guard.trial_scales.map((scale, index) => ({ index, scale, learning_rate: 0.1 * scale, candidate_mean: 1.02, relative_change: 0.02, decision: index === 7 ? "reject" : "retry", ranges: makeRanges(1.02) }));
  checkAttempt(baseAttempt({ committed_update: 0, learning_rate: 0.00078125, accepted_scale: null, backtrack_trial_count: 8, backtrack_trials: trials, decision: "reject", reason: "cumulative-backtracking-exhausted", rollback_digest: "1234567890abcdef", cumulative_probe_after: 1.02, cumulative_relative_change: 0.02, cumulative_ranges: makeCumulativeRanges(1.02) }), contract);
  console.log("Q2.5 contract and backtracking checker self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) { selfTest(); process.exit(0); }
const requireBacktrack = args.includes("--require-backtrack");
const requireFullScale = args.includes("--require-full-scale");
const requireExhaustion = args.includes("--require-exhaustion");
const paths = args.filter((argument) => !["--require-backtrack", "--require-full-scale", "--require-exhaustion"].includes(argument));
const contractPath = paths[0] ?? "benchmarks/zero4-q25-v1/contract.json";
const logPath = paths[1];
const contract = readJson(contractPath);
checkContract(contract);
if (logPath) {
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  assert(lines.length > 0, "attempt log is empty");
  const attempts = lines.map(JSON.parse);
  attempts.forEach((attempt) => checkAttempt(attempt, contract));
  if (requireBacktrack) assert(attempts.some((attempt) => attempt.decision === "accept" && attempt.backtrack_trial_count > 1), "attempt log contains no backtracked commit");
  if (requireFullScale) assert(attempts.some((attempt) => attempt.decision === "accept" && attempt.accepted_scale === 1), "attempt log contains no full-scale commit");
  if (requireExhaustion) assert(attempts.some((attempt) => attempt.decision === "reject"), "attempt log contains no exhausted outer attempt");
  console.log(`Q2.5 check: contract and ${lines.length} backtracking optimizer attempts passed`);
} else {
  console.log("Q2.5 check: contract passed");
}
