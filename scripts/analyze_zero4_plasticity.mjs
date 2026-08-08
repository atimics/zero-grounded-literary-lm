#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

function parseArgs(argv) {
  const options = { out: null, selfTest: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--self-test") {
      options.selfTest = true;
      continue;
    }
    if (!arg.startsWith("--") || index + 1 >= argv.length) {
      throw new Error(`unexpected argument: ${arg}`);
    }
    const key = arg.slice(2).replaceAll("-", "_");
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function readJsonl(file) {
  return fs.readFileSync(file, "utf8").trim().split("\n")
    .filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${file}:${index + 1}: ${error.message}`);
      }
    });
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function percentile(values, probability) {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(probability * ordered.length) - 1),
  );
  return ordered[index];
}

function attemptSummary(attempts) {
  const projectionFractions = attempts.map(
    (attempt) => attempt.projection_removed_fraction ?? 0,
  );
  const replayChanges = attempts.map(
    (attempt) => attempt.cumulative_relative_change ?? 0,
  );
  return {
    attempts: attempts.length,
    accepted: attempts.filter((attempt) => attempt.decision === "accept").length,
    rejected: attempts.filter((attempt) => attempt.decision !== "accept").length,
    full_scale_accepted: attempts.filter(
      (attempt) => attempt.decision === "accept" && attempt.accepted_scale === 1,
    ).length,
    projected: attempts.filter((attempt) => attempt.projection_applied === true).length,
    backtracked: attempts.filter(
      (attempt) => attempt.decision === "accept" && attempt.accepted_scale < 1,
    ).length,
    max_projection_removed_fraction: Math.max(0, ...projectionFractions),
    mean_projection_removed_fraction: mean(projectionFractions),
    p95_projection_removed_fraction: percentile(projectionFractions, 0.95),
    mean_gradient_norm: mean(attempts.map((attempt) => attempt.gradient_norm ?? 0)),
    mean_step_displacement_norm: mean(
      attempts.map((attempt) => attempt.displacement_norm ?? 0),
    ),
    final_cumulative_replay_change: replayChanges.at(-1) ?? null,
    minimum_cumulative_replay_change: replayChanges.length
      ? Math.min(...replayChanges)
      : null,
    maximum_cumulative_replay_change: replayChanges.length
      ? Math.max(...replayChanges)
      : null,
  };
}

function groupSummary(attempts) {
  const groups = new Map();
  for (const attempt of attempts) {
    for (const group of attempt.groups ?? []) {
      const current = groups.get(group.id) ?? {
        id: group.id,
        active_attempts: 0,
        sum_absolute_replay_drift: 0,
        sum_signed_replay_drift: 0,
        sum_step_displacement_norm: 0,
        sum_fisher_weighted_drift: 0,
      };
      const replayDrift = group.replay_drift ?? 0;
      const displacement = group.displacement_norm ?? 0;
      const fisherDrift = group.fisher_weighted_drift ?? 0;
      if (replayDrift !== 0 || displacement !== 0 || fisherDrift !== 0) {
        current.active_attempts += 1;
      }
      current.sum_absolute_replay_drift += Math.abs(replayDrift);
      current.sum_signed_replay_drift += replayDrift;
      current.sum_step_displacement_norm += displacement;
      current.sum_fisher_weighted_drift += fisherDrift;
      groups.set(group.id, current);
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      right.sum_step_displacement_norm - left.sum_step_displacement_norm ||
      left.id.localeCompare(right.id),
  );
}

function fullEvaluations(events, maximumCommitted) {
  return events.filter(
    (event) => event.type === "full-evaluation" &&
      event.committed <= maximumCommitted,
  ).map((event) => ({
    committed: event.committed,
    phase: event.phase,
    quantity_pass: event.quantityPass,
    minimum_faculty_margin: event.minimumFacultyMargin,
    replay_loss: event.replayLoss,
    replay_regression: event.replayRegression,
    feasible: event.feasible,
    rates: event.rates,
  }));
}

function eventAt(evaluations, committed) {
  return evaluations.find((event) => event.committed === committed) ?? null;
}

function matchedEvaluations(q26Evaluations, q27Evaluations) {
  const updates = [...new Set(q26Evaluations.map((event) => event.committed))]
    .filter((committed) => eventAt(q27Evaluations, committed))
    .sort((left, right) => left - right);
  return updates.map((committed) => {
    const q26 = eventAt(q26Evaluations, committed);
    const q27 = eventAt(q27Evaluations, committed);
    return {
      committed,
      q26,
      q27,
      delta: {
        closed: q27.rates.closed - q26.rates.closed,
        syntax: q27.rates.syntax - q26.rates.syntax,
        operation: q27.rates.operation - q26.rates.operation,
        exact_request: q27.rates.exact_request - q26.rates.exact_request,
        replay_regression: q27.replay_regression - q26.replay_regression,
      },
    };
  });
}

function firstQuantityPass(evaluations) {
  return evaluations.find((event) => event.quantity_pass === true) ?? null;
}

function analyze(q26Attempts, q26Events, q27Attempts, q27Events) {
  assert(q26Attempts.length > 0, "Q2.6 attempts are empty");
  assert(q27Attempts.length > 0, "Q2.7 attempts are empty");
  const matchedLimit = Math.min(q26Attempts.length, q27Attempts.length);
  const q26Matched = q26Attempts.slice(0, matchedLimit);
  const q27Matched = q27Attempts.slice(0, matchedLimit);
  const q26Evaluations = fullEvaluations(q26Events, matchedLimit);
  const q27Evaluations = fullEvaluations(q27Events, matchedLimit);
  return {
    schema: "zero.post_q27_plasticity_trace_analysis.v1",
    matched_committed_update_limit: matchedLimit,
    q26: {
      matched_attempts: attemptSummary(q26Matched),
      full_run_attempts: attemptSummary(q26Attempts),
      matched_group_sums: groupSummary(q26Matched),
      evaluations: q26Evaluations,
      first_quantity_pass: firstQuantityPass(q26Evaluations),
    },
    q27: {
      matched_attempts: attemptSummary(q27Matched),
      full_run_attempts: attemptSummary(q27Attempts),
      matched_group_sums: groupSummary(q27Matched),
      evaluations: q27Evaluations,
      first_quantity_pass: firstQuantityPass(q27Evaluations),
    },
    matched_evaluations: matchedEvaluations(q26Evaluations, q27Evaluations),
  };
}

function selfTest() {
  const group = (id, displacement, replay = 0) => ({
    id,
    displacement_norm: displacement,
    replay_drift: replay,
    fisher_weighted_drift: displacement * displacement,
  });
  const attempt = (index, projected, groups) => ({
    attempt: index,
    decision: "accept",
    accepted_scale: 1,
    projection_applied: projected,
    projection_removed_fraction: projected ? 0.25 : 0,
    gradient_norm: index,
    displacement_norm: index / 10,
    cumulative_relative_change: index / 100,
    groups,
  });
  const evaluation = (committed, quantityPass, operation, replayRegression) => ({
    type: "full-evaluation",
    committed,
    phase: "acquisition",
    quantityPass,
    minimumFacultyMargin: quantityPass ? 0.01 : -0.99,
    replayLoss: 1.6,
    replayRegression,
    feasible: quantityPass,
    rates: {
      closed: operation,
      syntax: operation,
      operation,
      arguments: 1,
      exact_request: operation,
      oracle_arithmetic: 1,
      committed: operation,
      exact_artifact: operation,
    },
  });
  const result = analyze(
    [attempt(1, false, [group("a", 1)]), attempt(2, true, [group("a", 2)])],
    [evaluation(1, false, 0.5, 0.02), evaluation(2, true, 1, 0.01)],
    [attempt(1, false, [group("a", 0.5)]), attempt(2, false, [group("a", 1)])],
    [evaluation(1, false, 0.25, 0), evaluation(2, false, 0.4, 0.001)],
  );
  assert.equal(result.matched_committed_update_limit, 2);
  assert.equal(result.q26.matched_attempts.projected, 1);
  assert.equal(result.q27.first_quantity_pass, null);
  assert.equal(result.matched_evaluations[1].delta.operation, -0.6);
  assert.equal(result.q26.matched_group_sums[0].sum_step_displacement_norm, 3);
  console.log("zero4 plasticity analysis self-test passed");
}

const options = parseArgs(process.argv.slice(2));
if (options.selfTest) {
  selfTest();
  process.exit(0);
}

for (const key of [
  "q26_attempts",
  "q26_events",
  "q27_attempts",
  "q27_events",
  "q27_result",
]) {
  if (!options[key]) throw new Error(`--${key.replaceAll("_", "-")} is required`);
}

const result = analyze(
  readJsonl(options.q26_attempts),
  readJsonl(options.q26_events),
  readJsonl(options.q27_attempts),
  readJsonl(options.q27_events),
);
result.inputs = {
  q26_attempts: {
    locator: options.q26_attempts_locator ?? options.q26_attempts,
    sha256: sha256(options.q26_attempts),
  },
  q26_events: {
    locator: options.q26_events_locator ?? options.q26_events,
    sha256: sha256(options.q26_events),
  },
  q27_attempts: {
    locator: options.q27_attempts_locator ?? options.q27_attempts,
    sha256: sha256(options.q27_attempts),
  },
  q27_events: {
    locator: options.q27_events_locator ?? options.q27_events,
    sha256: sha256(options.q27_events),
  },
  q27_result: {
    locator: options.q27_result_locator ?? options.q27_result,
    sha256: sha256(options.q27_result),
  },
};
const q27Result = JSON.parse(fs.readFileSync(options.q27_result, "utf8"));
result.frozen_q27_terminal_evidence = {
  workflow_run: 31270819935,
  source_commit: "59a97ff57e964db4e576bbf1a75e44dc7a983e9d",
  decision: q27Result.decision,
  stopped_reason: q27Result.stoppedReason,
  attempts: q27Result.attempts,
  committed_updates: q27Result.committed,
  trainable_scope: q27Result.trainableScope,
  trainable_parameters: q27Result.trainableParameters,
  selected_checkpoint: q27Result.selected,
  language_gate_evaluated: q27Result.languageGate?.evaluated ?? false,
};
// The trace summary is large and machine-consumed. Keep it compact so the
// governed branch budget reflects analysis logic rather than JSON whitespace.
const output = `${JSON.stringify(result)}\n`;
if (options.out) fs.writeFileSync(options.out, output);
else process.stdout.write(output);
