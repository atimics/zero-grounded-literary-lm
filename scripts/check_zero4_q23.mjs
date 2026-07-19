#!/usr/bin/env node

import fs from "node:fs";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function finiteOrNull(value) { return value === null || (typeof value === "number" && Number.isFinite(value)); }

function checkContract(contract) {
  assert(contract.schema === "zero.zero4_q23_contract.v1", "wrong contract schema");
  assert(contract.status === "preregistered", "contract is not preregistered");
  assert(contract.diagnostic_seed === 2, "diagnostic seed must be 2");
  assert(JSON.stringify(contract.sealed_replication_seeds) === "[1,3]", "seeds 1 and 3 must remain sealed");
  assert(contract.quantity_corpus.promotion_inaccessible_during_training === true, "promotion split is not sealed");
  assert(contract.guard.functional_probe_every_attempts >= 1 && contract.guard.functional_probe_every_attempts <= 5, "invalid functional probe cadence");
  assert(contract.guard.calibration.warning_quantile === 0.95 && contract.guard.calibration.hard_quantile === 0.99, "guard calibration rule changed");
  assert(contract.guard.hard_relative_increase_floor > 0 && contract.guard.hard_relative_increase_cap >= contract.guard.hard_relative_increase_floor, "invalid guard calibration bounds");
  assert(contract.guard.public_replay_ceiling === 0.02, "public replay ceiling changed");
  assert(contract.guard.projection_enabled === false, "projection is not admitted in Q2.3 v1");
  assert(contract.parameter_groups.length === new Set(contract.parameter_groups).size, "duplicate parameter group id");
  assert(Object.values(contract.immutable_teachers).every((hash) => /^[0-9a-f]{64}$/.test(hash)), "invalid teacher hash");
  assert(Object.values(contract.replay_corpus).every((hash) => /^[0-9a-f]{64}$/.test(hash)), "invalid replay corpus hash");
}

function checkAttempt(attempt) {
  const required = ["attempt", "proposed_committed_update", "committed_update", "phase", "mode", "source_mask", "source_ids", "replay_range", "learning_rate", "guard_budget", "functional_probe", "probe_before", "probe_after", "relative_probe_change", "faculty_replay_gradient_cosine", "gradient_norm", "displacement_norm", "predicted_replay_drift", "fisher_weighted_drift", "decision", "reason", "rollback_digest", "groups"];
  assert(attempt.schema === "zero.optimizer_attempt.v1", "wrong attempt schema");
  for (const field of required) assert(Object.hasOwn(attempt, field), `attempt missing ${field}`);
  assert(Number.isInteger(attempt.attempt) && attempt.attempt >= 1, "invalid attempt id");
  assert(["observer", "guard"].includes(attempt.mode), "invalid transaction mode");
  assert(["accept", "reject"].includes(attempt.decision), "invalid decision");
  assert(/^[0-9a-f]{16}$/.test(attempt.source_mask), "invalid source mask");
  assert(Array.isArray(attempt.source_ids) && attempt.source_ids.length > 0 && attempt.source_ids.every(Number.isInteger), "invalid source ids");
  const mask = BigInt(`0x${attempt.source_mask}`);
  const expectedSourceIds = Array.from({ length: 64 }, (_, index) => index).filter((index) => (mask & (1n << BigInt(index))) !== 0n);
  assert(JSON.stringify(attempt.source_ids) === JSON.stringify(expectedSourceIds), "source ids do not match source mask");
  assert(/^[0-9a-f]{16}$/.test(attempt.rollback_digest), "invalid rollback digest");
  for (const value of [attempt.probe_before, attempt.probe_after, attempt.relative_probe_change, attempt.faculty_replay_gradient_cosine]) assert(finiteOrNull(value), "non-finite optional diagnostic");
  assert(Array.isArray(attempt.groups) && attempt.groups.length > 0, "missing group diagnostics");
  const groupDrift = attempt.groups.reduce((sum, group) => sum + group.replay_drift, 0);
  const tolerance = Math.max(1e-10, Math.abs(attempt.predicted_replay_drift) * 1e-6);
  assert(Math.abs(groupDrift - attempt.predicted_replay_drift) <= tolerance, "group drift does not sum to global drift");
  if (attempt.decision === "reject") {
    assert(attempt.committed_update + 1 === attempt.proposed_committed_update, "rejection changed committed update");
    assert(attempt.rollback_digest !== "0000000000000000", "rejection lacks rollback proof");
  }
}

function selfTest() {
  checkContract(readJson("benchmarks/zero4-q23-v1/contract.json"));
  checkAttempt({ schema: "zero.optimizer_attempt.v1", attempt: 1, proposed_committed_update: 1, committed_update: 0, phase: "smoke", mode: "guard", source_mask: "0000000000000001", source_ids: [0], replay_range: 0, learning_rate: 1e-5, guard_budget: 0.0025, functional_probe: true, probe_before: 1, probe_after: 1.01, relative_probe_change: 0.01, faculty_replay_gradient_cosine: -0.5, gradient_norm: 1, displacement_norm: 0.1, predicted_replay_drift: 0.2, fisher_weighted_drift: 0.3, decision: "reject", reason: "replay-budget-exceeded", rollback_digest: "0123456789abcdef", groups: [{ id: "token_embedding", replay_drift: 0.2, displacement_norm: 0.1, fisher_weighted_drift: 0.3 }] });
  console.log("Q2.3 contract and attempt checker self-test passed");
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) { selfTest(); process.exit(0); }
const requireRejection = args.includes("--require-rejection");
const requireMixed = args.includes("--require-mixed");
const paths = args.filter((argument) => !["--require-rejection", "--require-mixed"].includes(argument));
const contractPath = paths[0] ?? "benchmarks/zero4-q23-v1/contract.json";
const logPath = paths[1];
checkContract(readJson(contractPath));
if (logPath) {
  const lines = fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  assert(lines.length > 0, "attempt log is empty");
  const attempts = lines.map(JSON.parse);
  attempts.forEach(checkAttempt);
  if (requireRejection) assert(attempts.some((attempt) => attempt.decision === "reject"), "attempt log contains no rejection");
  if (requireMixed) assert(attempts.some((attempt) => attempt.decision === "reject") && attempts.some((attempt) => attempt.decision === "accept"), "attempt log does not contain both acceptance and rejection");
  console.log(`Q2.3 check: contract and ${lines.length} optimizer attempts passed`);
} else {
  console.log("Q2.3 check: contract passed");
}
