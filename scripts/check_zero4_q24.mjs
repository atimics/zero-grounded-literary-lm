#!/usr/bin/env node

import fs from "node:fs";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function finite(value) { return typeof value === "number" && Number.isFinite(value); }

function checkContract(contract) {
  assert(contract.schema === "zero.zero4_q24_contract.v1", "wrong contract schema");
  assert(contract.status === "preregistered", "contract is not preregistered");
  assert(contract.diagnostic_seed === 2, "diagnostic seed must be 2");
  assert(JSON.stringify(contract.sealed_replication_seeds) === "[1,3]", "seeds 1 and 3 must remain sealed");
  assert(contract.quantity_corpus.promotion_inaccessible_during_training === true, "promotion split is not sealed");
  assert(contract.guard.mode === "cumulative-guard", "wrong guard mode");
  assert(contract.guard.probe_every_attempts === 1, "cumulative guard must probe every attempt");
  assert(contract.guard.all_replay_ranges_required === 6, "all six replay ranges are required");
  assert(contract.guard.warning_relative_increase === 0.01, "warning threshold changed");
  assert(contract.guard.hard_relative_increase === 0.015, "hard threshold changed");
  assert(contract.guard.public_replay_ceiling === 0.02, "public replay ceiling changed");
  assert(contract.guard.maximum_consecutive_rejections === 8, "rejection fallback changed");
  assert(contract.guard.projection_enabled === false, "projection is not admitted in Q2.4 v1");
  assert(Object.values(contract.immutable_teachers).every((hash) => /^[0-9a-f]{64}$/.test(hash)), "invalid teacher hash");
  assert(Object.values(contract.replay_corpus).every((hash) => /^[0-9a-f]{64}$/.test(hash)), "invalid replay corpus hash");
}

function checkAttempt(attempt, contract) {
  const required = ["attempt", "proposed_committed_update", "committed_update", "phase", "mode", "source_mask", "source_ids", "replay_range", "learning_rate", "guard_budget", "functional_probe", "probe_before", "probe_after", "relative_probe_change", "faculty_replay_gradient_cosine", "gradient_norm", "displacement_norm", "predicted_replay_drift", "fisher_weighted_drift", "decision", "reason", "rollback_digest", "cumulative_probe_baseline", "cumulative_probe_after", "cumulative_relative_change", "cumulative_ranges", "groups"];
  assert(attempt.schema === "zero.optimizer_attempt.v2", "wrong attempt schema");
  for (const field of required) assert(Object.hasOwn(attempt, field), `attempt missing ${field}`);
  assert(Number.isInteger(attempt.attempt) && attempt.attempt >= 1, "invalid attempt id");
  assert(attempt.mode === "cumulative-guard", "invalid transaction mode");
  assert(attempt.functional_probe === true, "cumulative functional probe was skipped");
  assert(Math.abs(attempt.guard_budget - contract.guard.hard_relative_increase) <= 1e-8, "guard budget differs from contract");
  assert(["accept", "reject"].includes(attempt.decision), "invalid decision");
  assert(/^[0-9a-f]{16}$/.test(attempt.source_mask), "invalid source mask");
  assert(Array.isArray(attempt.source_ids) && attempt.source_ids.length > 0 && attempt.source_ids.every(Number.isInteger), "invalid source ids");
  const mask = BigInt(`0x${attempt.source_mask}`);
  const expectedSourceIds = Array.from({ length: 64 }, (_, index) => index).filter((index) => (mask & (1n << BigInt(index))) !== 0n);
  assert(JSON.stringify(attempt.source_ids) === JSON.stringify(expectedSourceIds), "source ids do not match source mask");
  assert(/^[0-9a-f]{16}$/.test(attempt.rollback_digest), "invalid rollback digest");
  assert(finite(attempt.cumulative_probe_baseline) && attempt.cumulative_probe_baseline > 0, "invalid cumulative baseline");
  assert(Array.isArray(attempt.cumulative_ranges) && attempt.cumulative_ranges.length === contract.guard.all_replay_ranges_required, "cumulative guard did not evaluate all replay ranges");
  const rangeIds = attempt.cumulative_ranges.map((entry) => entry.replay_range);
  assert(new Set(rangeIds).size === rangeIds.length, "duplicate cumulative replay range");
  const nonFinite = attempt.cumulative_probe_after === null || attempt.cumulative_relative_change === null;
  if (nonFinite) {
    assert(attempt.decision === "reject" && attempt.reason === "non-finite-cumulative-replay-probe", "non-finite cumulative candidate did not fail closed");
    assert(attempt.cumulative_ranges.some((entry) => entry.candidate === null || entry.relative_change === null), "non-finite composite lacks a non-finite range");
    assert(attempt.committed_update + 1 === attempt.proposed_committed_update, "non-finite rejection changed committed update");
    assert(attempt.rollback_digest !== "0000000000000000", "non-finite rejection lacks rollback proof");
    return;
  }
  assert(finite(attempt.cumulative_probe_after), "invalid cumulative candidate mean");
  assert(finite(attempt.cumulative_relative_change), "invalid cumulative relative change");
  for (const entry of attempt.cumulative_ranges) {
    assert(finite(entry.baseline) && entry.baseline > 0 && finite(entry.candidate) && finite(entry.relative_change), "invalid cumulative range metric");
    const expected = (entry.candidate - entry.baseline) / entry.baseline;
    assert(Math.abs(expected - entry.relative_change) <= 1e-7, "range relative change is inconsistent");
  }
  const baselineMean = attempt.cumulative_ranges.reduce((sum, entry) => sum + entry.baseline, 0) / attempt.cumulative_ranges.length;
  const candidateMean = attempt.cumulative_ranges.reduce((sum, entry) => sum + entry.candidate, 0) / attempt.cumulative_ranges.length;
  const relative = (candidateMean - baselineMean) / baselineMean;
  assert(Math.abs(baselineMean - attempt.cumulative_probe_baseline) <= 1e-6, "cumulative baseline mean is inconsistent");
  assert(Math.abs(candidateMean - attempt.cumulative_probe_after) <= 1e-6, "cumulative candidate mean is inconsistent");
  assert(Math.abs(relative - attempt.cumulative_relative_change) <= 1e-7, "cumulative relative change is inconsistent");
  const shouldAccept = relative <= contract.guard.hard_relative_increase;
  assert((attempt.decision === "accept") === shouldAccept, "decision does not follow cumulative guard rule");
  if (attempt.decision === "reject") {
    assert(attempt.committed_update + 1 === attempt.proposed_committed_update, "rejection changed committed update");
    assert(attempt.rollback_digest !== "0000000000000000", "rejection lacks rollback proof");
  }
  assert(Array.isArray(attempt.groups) && attempt.groups.length > 0, "missing group diagnostics");
}

function selfTest() {
  const contract = readJson("benchmarks/zero4-q24-v1/contract.json");
  checkContract(contract);
  const ranges = Array.from({ length: 6 }, (_, replay_range) => ({ replay_range, baseline: 1, candidate: 1.01, relative_change: 0.01 }));
  checkAttempt({ schema: "zero.optimizer_attempt.v2", attempt: 1, proposed_committed_update: 1, committed_update: 1, phase: "smoke", mode: "cumulative-guard", source_mask: "0000000000000001", source_ids: [0], replay_range: 0, learning_rate: 1e-5, guard_budget: 0.015, functional_probe: true, probe_before: 1, probe_after: 1.01, relative_probe_change: 0.01, faculty_replay_gradient_cosine: -0.5, gradient_norm: 1, displacement_norm: 0.1, predicted_replay_drift: 0.2, fisher_weighted_drift: 0.3, decision: "accept", reason: "within-cumulative-replay-budget", rollback_digest: "0000000000000000", cumulative_probe_baseline: 1, cumulative_probe_after: 1.01, cumulative_relative_change: 0.01, cumulative_ranges: ranges, groups: [{ id: "token_embedding", replay_drift: 0.2, displacement_norm: 0.1, fisher_weighted_drift: 0.3 }] }, contract);
  console.log("Q2.4 contract and attempt checker self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) { selfTest(); process.exit(0); }
const requireRejection = args.includes("--require-rejection");
const requireAcceptance = args.includes("--require-acceptance");
const paths = args.filter((argument) => !["--require-rejection", "--require-acceptance"].includes(argument));
const contractPath = paths[0] ?? "benchmarks/zero4-q24-v1/contract.json";
const logPath = paths[1];
const contract = readJson(contractPath);
checkContract(contract);
if (logPath) {
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  assert(lines.length > 0, "attempt log is empty");
  const attempts = lines.map(JSON.parse);
  attempts.forEach((attempt) => checkAttempt(attempt, contract));
  if (requireRejection) assert(attempts.some((attempt) => attempt.decision === "reject"), "attempt log contains no rejection");
  if (requireAcceptance) assert(attempts.some((attempt) => attempt.decision === "accept"), "attempt log contains no acceptance");
  console.log(`Q2.4 check: contract and ${lines.length} cumulative optimizer attempts passed`);
} else {
  console.log("Q2.4 check: contract passed");
}
