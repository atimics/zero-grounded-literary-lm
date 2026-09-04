#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

import {
  analysisFunctionDigest,
  armParityReceipt,
  assertManifestReplay,
  assertRawTraceCoverage,
  assertRankerView,
  assertResultReplay,
  assertSourceAblationMatches,
  canonicalCandidateOrder,
  canonicalDigest,
  canonicalScientificNumber,
  createDeterministicRng,
  createReplayRegistry,
  createSplitState,
  aggregateNestedFamilies,
  buildResultFromRawTraces,
  factorialInteractionFamilies,
  familyInferenceReceipt,
  finalizeManifest,
  freezeFamilySplits,
  registerEpisode,
  registerFamily,
  registerReplayPipeline,
  replayFunctionDigest,
  reconstructCommonGate,
  runVerifiedSearch,
} from "./lib/reasoner5_harness.mjs";
import {
  R55_ARMS,
  R55_BASE_ARMS,
  R55_DERANGEMENTS,
  R55_DERANGEMENT_DIGEST,
  R55_DERANGEMENT_NAMESPACE,
  R55_DERANGEMENT_SEED,
  createR55ReplayCache,
  buildR55AdapterProbes,
  decodeR55Replay,
  expectedObservationQueries,
  parseR55Artifact,
  publicR55Episode,
  rawLexicalRoles,
  reconstructR55Adapter,
  replayR55EpisodeContent,
  replayR55Search,
  sourceArtifactBytesRead,
} from "./lib/reasoner55_replay.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = resolve(root,
  "benchmarks/reasoner55-generated-primitive-transfer-v1");
const writeAnalysis = process.argv.includes("--write-analysis");
const positionalArgs = process.argv.slice(2)
  .filter(argument => argument !== "--write-analysis");
const resultPath = positionalArgs[0] ?? resolve(fixture, "DEVELOPMENT.json");
const tracePath = positionalArgs[1] ??
  resolve(fixture, "DEVELOPMENT-TRACE.jsonl");
const artifactPath = positionalArgs[2] ??
  resolve(fixture, "SOURCE_ARTIFACT.hex");
const contractPath = resolve(fixture, "contract.json");
const analysisPath = resolve(fixture, "DEVELOPMENT-ANALYSIS.json");

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : Math.floor((ordered[middle - 1] + ordered[middle]) / 2);
}

function sameFields(left, right, fields, label) {
  for (const field of fields) {
    check(left[field] === right[field], `${label}: ${field} differs`);
  }
}

const R55_REPLAY_FUNCTION_SHA256 = replayFunctionDigest(
  replayR55EpisodeContent);
const R55_GENERATOR_IMPLEMENTATION = Object.freeze({
  c_core_sha256: sha256(readFileSync(resolve(root, "reasoner55.c"))),
  replay_adapter_sha256: sha256(readFileSync(resolve(root,
    "scripts/lib/reasoner55_replay.mjs"))),
});
const R55_GENERATOR_SHA256 = canonicalDigest("generator-implementation", {
  version: "reasoner55-generated-affine-families-v3",
  ...R55_GENERATOR_IMPLEMENTATION,
});
const R55_INPUT_GENERATOR_SHA256 = canonicalDigest("input-generator-implementation", {
  version: "reasoner55-zero-basis-and-demonstration-v3",
  ...R55_GENERATOR_IMPLEMENTATION,
});
const R55_RANKER_POLICY = Object.freeze({
  schema: "zero.reasoner5_ranker_policy.v1",
  leaf_whitelist: [
    "primitive_labels[]",
    "observations[].input[]",
    "observations[].observed[]",
    "allowed_actions[].kind",
  ],
  leaf_contracts: {
    "primitive_labels[]": { type: "string", provenance: "public-constant" },
    "observations[].input[]": {
      type: "integer", provenance: "generated-query",
    },
    "observations[].observed[]": {
      type: "integer", provenance: "observed-response",
    },
    "allowed_actions[].kind": {
      type: "string", provenance: "allowed-action",
    },
  },
});
const R55_ANALYSIS_SETTINGS = Object.freeze({
  lane: "development",
  cost_field: "primary_cost",
  family_weighting: "target-family-within-fixed-source-to-target-environment",
  source_free_selection_metric:
    "environment-and-family-weighted-mean-paired-log-cost",
  intersection_union: {
    alpha: 0.01,
    independent_unit_fields: ["generator_id", "family_id"],
    primary_strata: [
      "target-syntax-first",
      "target-skeleton-first",
      "cross-generator",
    ],
    simple_effect: {
      full_arm: "full",
      comparator_arm: "adapter_only",
      primary_seed: "55a1000000000001",
      stratum_seeds: [
        "55a1000000000002",
        "55a1000000000003",
        "55a1000000000004",
      ],
    },
    operational_comparator: {
      full_arm: "full",
      comparator_arm: "source_free_jit",
      unit_fields: ["generator_id", "family_id"],
      design: "one-way",
      direction: "lower",
      replicates: 256,
      alpha: 0.01,
      environment_field: "generator_id",
      primary_seed: "55a1000000000011",
      stratum_seeds: [
        "55a1000000000012",
        "55a1000000000013",
        "55a1000000000014",
      ],
    },
    factorial_interaction: {
      adapter_guide_arm: "full",
      adapter_only_arm: "adapter_only",
      guide_only_arm: "raw_lexical",
      raw_arm: "target_only",
      required_upper_log_ratio: 0,
      seed: "55a1000000000007",
    },
    formal_mechanism: {
      full_arm: "raw_lexical",
      comparator_arm: "full",
      minimum_ratio: 1.1,
      alpha: 0.05,
      seed: "55a1000000000006",
    },
  },
});

const R55_UNIT_FIELDS = Object.freeze(["generator_id", "family_id"]);
const R55_SIMPLE_PRIMARY = Object.freeze({
  full_arm: "full",
  comparator_arm: "adapter_only",
  unit_fields: R55_UNIT_FIELDS,
  design: "one-way",
  direction: "lower",
  replicates: 256,
  alpha: 0.01,
  environment_field: "generator_id",
  seed: R55_ANALYSIS_SETTINGS.intersection_union.simple_effect.primary_seed,
});
const R55_OPERATIONAL_PRIMARY = Object.freeze({
  ...R55_ANALYSIS_SETTINGS.intersection_union.operational_comparator,
  seed: R55_ANALYSIS_SETTINGS.intersection_union.operational_comparator
    .primary_seed,
});

function crossGeneratorEpisodeIds() {
  const ids = [];
  for (const [source, target] of [
    ["syntax-first", "skeleton-first"],
    ["skeleton-first", "syntax-first"],
  ]) {
    for (let ordinal = 0; ordinal < 4; ordinal += 1)
      for (let tie = 0; tie < 2; tie += 1)
        ids.push(`${source}-to-${target}-${String(ordinal).padStart(3, "0")}` +
          `-tie-${tie}`);
  }
  return ids;
}

function primaryStrata(comparison, seeds) {
  assert.equal(seeds.length, 3, "R5.5 needs three registered strata seeds");
  return [
    {
      ...comparison,
      name: "target-syntax-first",
      field: "target_generator_id",
      values: ["syntax-first"],
      seed: seeds[0],
      alpha: 0.05,
    },
    {
      ...comparison,
      name: "target-skeleton-first",
      field: "target_generator_id",
      values: ["skeleton-first"],
      seed: seeds[1],
      alpha: 0.05,
    },
    {
      ...comparison,
      name: "cross-generator",
      field: "generator_relation",
      values: ["cross-generator"],
      seed: seeds[2],
      alpha: 0.05,
    },
  ];
}

function sharedPrimaryStrata(comparison, seeds) {
  assert.equal(seeds.length, 3, "R5.5 needs three registered strata seeds");
  return [
    {
      ...comparison,
      name: "target-syntax-first",
      field: "generator_id",
      values: ["syntax-first"],
      seed: seeds[0],
      alpha: 0.05,
    },
    {
      ...comparison,
      name: "target-skeleton-first",
      field: "generator_id",
      values: ["skeleton-first"],
      seed: seeds[1],
      alpha: 0.05,
    },
    {
      ...comparison,
      name: "cross-generator",
      field: "episode_id",
      values: crossGeneratorEpisodeIds(),
      seed: seeds[2],
      alpha: 0.05,
    },
  ];
}

function buildR55AnalysisView(nativeRows, strictRows, nativeRawTraceSha256) {
  assert.equal(nativeRows.length, 1280,
    "R5.5 analysis view needs 1,280 native rows");
  assert.equal(strictRows.length, nativeRows.length,
    "R5.5 analysis view must map every strict row once");
  assert.match(nativeRawTraceSha256, /^[0-9a-f]{64}$/u);
  const replayedNativeBytes = Buffer.from(
    `${nativeRows.map(row => JSON.stringify(row)).join("\n")}\n`);
  assert.equal(sha256(replayedNativeBytes), nativeRawTraceSha256,
    "R5.5 analysis input rows must match the native raw trace bytes");
  const inputRowIdentities = [];
  const viewRows = nativeRows.map((nativeRow, index) => {
    const strictRow = strictRows[index];
    for (const field of ["episode_id", "family_id", "nested_repeat_id", "arm"])
      assert.equal(nativeRow[field], strictRow[field],
        `R5.5 analysis row ${index} changed ${field}`);
    assert.equal(nativeRow.generator_id, strictRow.generator_id,
      `R5.5 analysis row ${index} changed target generator`);
    assert.ok(["syntax-first", "skeleton-first"].includes(
      nativeRow.source_generator_id),
    `R5.5 analysis row ${index} has an unknown source generator`);
    assert.equal(nativeRow.generator_relation,
      nativeRow.source_generator_id === nativeRow.generator_id ?
        "same-generator" : "cross-generator",
    `R5.5 analysis row ${index} changed generator relation`);
    assert.ok(nativeRow.episode_id.startsWith(
      `${nativeRow.source_generator_id}-to-${nativeRow.generator_id}-`),
    `R5.5 analysis row ${index} changed source or target identity`);
    const inputIdentity = canonicalDigest("reasoner55-native-trace-row",
      nativeRow);
    inputRowIdentities.push(inputIdentity);
    return {
      ...strictRow,
      source_generator_id: nativeRow.source_generator_id,
      target_generator_id: nativeRow.generator_id,
      generator_relation: nativeRow.generator_relation,
      generator_id:
        `${nativeRow.source_generator_id}->${nativeRow.generator_id}`,
      input_row_index: index,
      input_row_identity_sha256: inputIdentity,
    };
  });
  const environments = new Set(viewRows.map(row => row.generator_id));
  assert.equal(new Set(inputRowIdentities).size, inputRowIdentities.length,
    "R5.5 analysis needs one unique identity for every native row");
  const units = new Map();
  for (const row of viewRows) {
    const key = `${row.generator_id}\0${row.family_id}`;
    const unit = units.get(key) ?? { repeats: new Set(), rows: 0 };
    unit.repeats.add(row.nested_repeat_id);
    unit.rows += 1;
    units.set(key, unit);
  }
  assert.equal(environments.size, 4,
    "R5.5 analysis needs four fixed source-to-target environments");
  assert.equal(units.size, 16,
    "R5.5 analysis needs 16 environment-family units");
  for (const unit of units.values()) {
    assert.equal(unit.repeats.size, 2,
      "R5.5 analysis units need two nested tie repeats");
    assert.equal(unit.rows, 80,
      "R5.5 analysis units need two repeats by 40 arms");
  }
  const body = {
    schema: "zero.reasoner55_analysis_view_receipt.v1",
    input_rows: nativeRows.length,
    output_rows: viewRows.length,
    native_raw_trace_sha256: nativeRawTraceSha256,
    transform_function_sha256: R55_ANALYSIS_VIEW_TRANSFORM_SHA256,
    input_row_identity_sha256: inputRowIdentities,
    analysis_view_sha256: canonicalDigest("reasoner55-analysis-view", viewRows),
    independent_environment_family_units: units.size,
    nested_tie_repeats_per_unit: 2,
    fixed_source_to_target_environments: [...environments].sort(),
  };
  return {
    rows: viewRows,
    receipt: {
      ...body,
      receipt_sha256: canonicalDigest("reasoner55-analysis-view-receipt", body),
    },
  };
}

const R55_ANALYSIS_VIEW_TRANSFORM_SHA256 = analysisFunctionDigest(
  buildR55AnalysisView);

function assertR55AnalysisView(nativeRows, strictRows, nativeRawTraceSha256,
  analysisView) {
  const replayed = buildR55AnalysisView(nativeRows, strictRows,
    nativeRawTraceSha256);
  assert.deepEqual(analysisView, replayed,
    "R5.5 analysis view differs from its deterministic transform");
  return true;
}

function comparisonRows(rawTraces, comparison) {
  if (comparison.field === undefined) return rawTraces;
  const values = new Set(comparison.values);
  return rawTraces.filter(row => values.has(row[comparison.field]));
}

function comparisonInference(rawTraces, comparison) {
  const units = aggregateNestedFamilies(comparisonRows(rawTraces, comparison), {
    fullArm: comparison.full_arm,
    comparatorArm: comparison.comparator_arm,
    unitFields: comparison.unit_fields,
    costField: "primary_cost",
  });
  return familyInferenceReceipt(units, {
    design: comparison.design,
    direction: comparison.direction,
    seed: comparison.seed,
    replicates: comparison.replicates,
    alpha: comparison.alpha,
    environmentField: comparison.environment_field,
  });
}

function sourceFreeSelectionReceipt(analysisRows) {
  const units = aggregateNestedFamilies(analysisRows, {
    fullArm: "source_free_jit",
    comparatorArm: "target_only",
    unitFields: R55_UNIT_FIELDS,
    costField: "primary_cost",
  });
  assert.equal(units.length, 16,
    "source-free selection needs every environment-family unit");
  const meanLogRatio = canonicalScientificNumber(units.reduce((sum, unit) =>
    sum + unit.mean_log_ratio, 0) / units.length);
  const selectedArm = meanLogRatio < 0 ? "source_free_jit" : "target_only";
  const body = {
    schema: "zero.reasoner55_source_free_selection.v1",
    candidates: ["target_only", "source_free_jit"],
    metric: "environment-and-family-weighted-mean-paired-log-cost",
    independent_environment_family_units: units.length,
    nested_tie_repeats_per_unit: 2,
    source_free_jit_to_target_only_log_ratio: meanLogRatio,
    source_free_jit_to_target_only_ratio:
      canonicalScientificNumber(Math.exp(meanLogRatio)),
    selected_arm: selectedArm,
  };
  return {
    ...body,
    receipt_sha256: canonicalDigest("reasoner55-source-free-selection", body),
  };
}

function adapterAggregateReceipt(families) {
  const receipts = [...families.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([familyId, family]) => reconstructR55Adapter(family, undefined,
      familyId));
  const body = {
    schema: "zero.reasoner55_adapter_aggregate.v1",
    families: receipts.length,
    probe_queries: receipts.reduce((sum, item) => sum + item.probe_queries, 0),
    domain_checks: receipts.reduce((sum, item) => sum + item.domain_checks, 0),
    all_coefficients_exact: receipts.every(item => item.coefficients_exact),
    all_roles_exact: receipts.every(item => item.roles_exact),
    all_exact: receipts.every(item => item.exact),
    family_receipts: receipts,
  };
  return {
    ...body,
    receipt_sha256: canonicalDigest("reasoner55-adapter-aggregate", body),
  };
}

function absoluteArmStatistic(analysisRows, arm) {
  const grouped = new Map();
  for (const row of analysisRows.filter(item => item.arm === arm)) {
    const key = `${row.generator_id}\0${row.family_id}`;
    const values = grouped.get(key) ?? [];
    values.push(canonicalScientificNumber(Math.log(row.primary_cost + 1)));
    grouped.set(key, values);
  }
  assert.equal(grouped.size, 16,
    `${arm} derangement statistic needs 16 independent units`);
  const means = [...grouped.values()].map(values => canonicalScientificNumber(
    values.reduce((sum, value) => sum + value, 0) / values.length));
  return canonicalScientificNumber(
    means.reduce((sum, value) => sum + value, 0) / means.length);
}

function derangementAnalysis(analysisRows) {
  return {
    observed: absoluteArmStatistic(analysisRows, "full"),
    values: expectedArms.filter(arm => arm.startsWith("shuffled_"))
      .map(arm => absoluteArmStatistic(analysisRows, arm)),
  };
}

function operationalAnalysis(rawTraces) {
  return {
    arm: R55_OPERATIONAL_PRIMARY.comparator_arm,
    primary: comparisonInference(rawTraces, R55_OPERATIONAL_PRIMARY),
    strata: primaryStrata(R55_OPERATIONAL_PRIMARY,
      R55_ANALYSIS_SETTINGS.intersection_union.operational_comparator
        .stratum_seeds)
      .map(analysis => ({
        name: analysis.name,
        inference: comparisonInference(rawTraces, analysis),
      })),
  };
}

function reconstructR55Development(rawTraces) {
  const arms = {};
  for (const row of rawTraces) {
    const summary = arms[row.arm] ?? {
      rows: 0,
      primary_cost: 0,
      verifier_checks: 0,
      partial_expansions: 0,
      observation_queries: 0,
      source_artifact_reads: 0,
    };
    summary.rows += 1;
    summary.primary_cost += row.primary_cost;
    summary.verifier_checks += row.verifier_checks;
    summary.partial_expansions += row.partial_expansions;
    summary.observation_queries += row.observation_queries;
    summary.source_artifact_reads += row.source_artifact_reads;
    arms[row.arm] = summary;
  }
  return {
    status: "development-only",
    execution_authorized: false,
    arm_totals: arms,
    analysis_scope: "strict trace replay; R5.5 scientific view is separately bound",
  };
}

const resultBytes = readFileSync(resultPath);
const traceBytes = readFileSync(tracePath);
const artifactText = readFileSync(artifactPath, "utf8").trim();
const contract = JSON.parse(readFileSync(contractPath));
const result = JSON.parse(resultBytes);
const lines = traceBytes.toString("utf8").trim().split("\n");
const rows = lines.map((line, index) => {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`trace row ${index + 1}: ${error.message}`);
  }
});

check(result.schema === "zero.reasoner55_development.v1",
  "unexpected development schema");
check(contract.schema === "zero.reasoner55_development_contract.v1",
  "unexpected development contract schema");
check(contract.experiment === result.experiment,
  "contract and result experiment IDs differ");
check(contract.status === "development-only" &&
  contract.execution.authorized === false &&
  contract.execution.allowed_lane === "development" &&
  contract.execution.sealed_manifest === null &&
  contract.execution.sealed_seed_family === null &&
  contract.execution.cloud_run === null,
  "contract execution boundary changed");
check(contract.implementation.shared_harness_commit ===
    "a46382178fea84200a331c3ba0a0a22109b00747",
"shared harness commit binding changed");
for (const [field, path] of [
  ["core_sha256", "reasoner55.c"],
  ["header_sha256", "reasoner55.h"],
  ["cli_sha256", "reasoner55_cli.c"],
  ["development_checker_sha256", "scripts/check_reasoner55_development.mjs"],
]) {
  check(sha256(readFileSync(resolve(root, path))) ===
    contract.implementation[field], `implementation digest changed for ${path}`);
}
for (const [field, path] of [
  ["shared_harness_sha256", "scripts/lib/reasoner5_harness.mjs"],
  ["replay_adapter_sha256", "scripts/lib/reasoner55_replay.mjs"],
]) {
  check(sha256(readFileSync(resolve(root, path))) ===
    contract.implementation[field], `implementation digest changed for ${path}`);
}
for (const [field, path] of [
  ["reasoner51_c_sha256", "reasoner51.c"],
  ["reasoner52_c_sha256", "reasoner52.c"],
  ["reasoner5_followup_c_sha256", "reasoner5_followup.c"],
]) {
  check(sha256(readFileSync(resolve(root, path))) ===
    contract.implementation.protected_predecessors[field],
  `protected predecessor changed for ${path}`);
}
check(result.experiment === "reasoner55-generated-primitive-transfer-v1",
  "unexpected experiment ID");
check(result.status === "development-only", "fixture must stay development-only");
check(result.execution_authorized === false,
  "development fixture must keep execution authorization false");
check(JSON.stringify(result.field) ===
  JSON.stringify({ modulus: 5, lanes: 3, points: 125 }),
  "unexpected finite field");
check(JSON.stringify(result.program) === JSON.stringify({
  primitives: 8, length: 4, syntax_candidates: 4096,
}), "unexpected program grammar");
check(result.source_families === 128, "expected 128 source families");
check(result.development_families === 8, "expected 8 development families");
check(result.generator_environments === 4, "expected four generator environments");
check(result.episodes === 32, "expected 32 development episodes");
check(result.trace_rows === 1280 && rows.length === 1280,
  "expected 1,280 arm rows");
check(result.proposal_budget === 64 && result.global_cap === 4096,
  "unexpected search caps");
check(result.derangements === 31, "expected 31 frozen derangements");
check(result.adapter.reconstructions === 8 && result.adapter.exact === 8,
  "every development adapter must reconstruct exactly");
check(result.adapter.domain_checks === 8 * 8 * 125,
  "adapter must check every primitive on every vector");
check(result.generator_sequence_differences === 4,
  "independent generators must differ on every paired fixture");
check(result.semantic_collisions > 0,
  "the syntax universe must contain semantic collisions");
check(result.source_ablation.matches === result.source_ablation.cases &&
  result.source_ablation.cases === 32,
  "source ablation must match the source-free path");
check(result.full_oracle.matches === result.full_oracle.cases &&
  result.full_oracle.cases === 32,
  "exact adapter and oracle must match");
const headroomPass = result.target_only_headroom.median >=
  contract.development_gates.target_only_median_minimum &&
  result.target_only_headroom.median <=
    contract.development_gates.target_only_median_maximum;
check(result.fixture_qualification.target_only_headroom === headroomPass &&
  result.fixture_qualification.decision === (headroomPass ? "pass" : "no-go"),
"fixture qualification must derive from the registered headroom range");
const strongestSourceFree =
  result.development_selection.strongest_source_free_arm;
check(["target_only", "source_free_jit"].includes(strongestSourceFree) &&
  result.development_selection.metric ===
    R55_ANALYSIS_SETTINGS.source_free_selection_metric &&
  result.development_selection.independent_environment_family_units === 16 &&
  result.development_selection.nested_tie_repeats_per_unit === 2 &&
  result.development_selection.paired_episode_measurements === 32 &&
  contract.development_selection.strongest_source_free_arm ===
    strongestSourceFree &&
  contract.development_selection.selection_metric ===
    R55_ANALYSIS_SETTINGS.source_free_selection_metric,
"development must freeze one registered source-free comparator");
check(contract.registered_analysis.primary_error_rule ===
    "intersection-union at one-sided alpha 0.01" &&
  contract.registered_analysis.independent_unit ===
    "target family within each fixed source-to-target generator environment" &&
  contract.registered_analysis.exact_adapter_required === true &&
  contract.registered_analysis.simple_effect.full_arm === "full" &&
  contract.registered_analysis.simple_effect.comparator_arm ===
    "adapter_only" &&
  contract.registered_analysis.operational_comparator.full_arm === "full" &&
  contract.registered_analysis.operational_comparator.comparator_arm ===
    strongestSourceFree &&
  contract.registered_analysis.factorial_interaction
    .required_upper_log_ratio === 0 &&
  contract.registered_analysis.formal_mechanism.contrast ===
    "raw_lexical versus full" &&
  JSON.stringify(contract.registered_analysis.primary_strata) ===
    JSON.stringify(R55_ANALYSIS_SETTINGS.intersection_union.primary_strata) &&
  contract.registered_analysis.target_only_role ===
    "registered fixture headroom only",
"registered intersection-union contract changed");
check(contract.raw_lexical_control.mapping ===
    "rank each public 32-bit surface label among the eight labels" &&
  contract.raw_lexical_control.properties ===
    "one-to-one, label-only, independent of hidden semantic roles",
"registered raw lexical control changed");
check(contract.shared_replay.scientific_analysis_view.native_rows === 1280 &&
  contract.shared_replay.scientific_analysis_view
    .independent_environment_family_units === 16 &&
  contract.shared_replay.scientific_analysis_view
    .nested_tie_repeats_per_unit === 2 &&
  contract.shared_replay.scientific_analysis_view
    .fixed_source_to_target_environments === 4,
"registered R5.5 scientific analysis view changed");
check(result.family_selection_rule ===
  contract.development_selection.family_headroom_rule,
"development family headroom rule changed");

check(/^[0-9a-f]{64}$/.test(result.artifact_sha256),
  "invalid artifact digest");
check(/^[0-9a-f]{64}$/.test(result.raw_trace_sha256),
  "invalid trace digest");
check(sha256(traceBytes) === result.raw_trace_sha256,
  "raw trace digest mismatch");
check(contract.trace.raw_sha256 === result.raw_trace_sha256,
  "contract trace digest mismatch");
check(/^[0-9a-f]+$/.test(artifactText) && artifactText.length % 2 === 0,
  "source artifact must be canonical lowercase hex");
const artifact = Buffer.from(artifactText, "hex");
check(artifact.length === 1823, "unexpected source artifact size");
check(sha256(artifact) === result.artifact_sha256,
  "source artifact digest mismatch");
check(contract.source_artifact.sha256 === result.artifact_sha256,
  "contract artifact digest mismatch");
check(artifact.subarray(0, 8).toString("ascii") === "R55A0001",
  "unexpected source artifact magic");
check([...artifact.subarray(8, 13)].join(",") === "5,3,8,4,2",
  "unexpected source artifact header");
let artifactOffset = 13;
for (let generator = 0; generator < 2; generator += 1) {
  check(artifact[artifactOffset] === generator,
    `artifact guide ${generator}: wrong generator ID`);
  artifactOffset += 1;
  check(artifact.readUInt32LE(artifactOffset) === 64,
    `artifact guide ${generator}: wrong source family count`);
  artifactOffset += 4;
  check(artifact.readUInt32LE(artifactOffset) === 64,
    `artifact guide ${generator}: wrong source solution count`);
  artifactOffset += 4 + (4 * ((4 * 8) + (3 * 8 * 8)));
}
check(artifactOffset === artifact.length, "source artifact has trailing bytes");

const expectedBaseArms = R55_BASE_ARMS;
const expectedArms = R55_ARMS;
check(result.arms.length === expectedArms.length, "unexpected arm summary count");
check(result.arms.map(({ arm }) => arm).join("|") === expectedArms.join("|"),
  "arm summary order changed");

const hashFields = [
  "ast_sha256", "behavior_sha256", "episode_spec_sha256",
  "allowed_actions_digest", "latent_episode_digest",
  "potential_response_digest", "candidate_universe_digest",
  "initial_evidence_digest", "grammar_digest", "verifier_digest",
  "caps_digest", "accepted_semantic_sha256", "proposal_order_sha256",
  "source_artifact_sha256", "family_replay_sha256",
];
const parityFields = [
  "ast_sha256", "behavior_sha256", "episode_spec_sha256",
  "allowed_actions_digest", "latent_episode_digest",
  "potential_response_digest", "candidate_universe_digest",
  "initial_evidence_digest", "grammar_digest", "verifier_digest",
  "caps_digest",
];
const equalityFields = [
  "exact", "certificate_valid", "premature_commit", "primary_cost",
  "verifier_checks", "partial_expansions",
  "verifier_domain_points", "fallback_started", "fallback_work_counted",
  "global_cap_hit", "fallback_exhausted", "censoring_reason",
  "injected_invalid", "injected_invalid_rejected",
  "injected_counterexample_index", "source_artifact_reads",
  "accepted_semantic_sha256", "proposal_order_sha256",
];
const sourceArms = new Set([
  "raw_lexical", "full", "oracle_adapter", "frequency_lexical",
  "source_only", ...expectedArms.filter((arm) => arm.startsWith("shuffled_")),
]);
const episodeRows = new Map();
const familyRows = new Map();
const environmentKeys = new Set();
for (const [index, row] of rows.entries()) {
  const label = `trace row ${index + 1}`;
  check(row.schema === "zero.reasoner55_trace_row.v1", `${label}: schema`);
  check(row.experiment === result.experiment, `${label}: experiment`);
  check(row.lane === "development", `${label}: lane`);
  check(["syntax-first", "skeleton-first"].includes(row.source_generator_id),
    `${label}: source generator`);
  check(["syntax-first", "skeleton-first"].includes(row.generator_id),
    `${label}: target generator`);
  check(row.cross_family_id === null, `${label}: cross family must be null`);
  check(["tie-0", "tie-1"].includes(row.nested_repeat_id),
    `${label}: nested repeat`);
  check(row.shift_stratum === "generated-affine", `${label}: shift stratum`);
  check(row.generator_relation ===
    (row.source_generator_id === row.generator_id
      ? "same-generator" : "cross-generator"), `${label}: generator relation`);
  check(expectedArms.includes(row.arm), `${label}: unknown arm`);
  check(row.exact === true && row.certificate_valid === true,
    `${label}: exact certificate`);
  check(row.premature_commit === false, `${label}: premature commit`);
  check(row.verifier_checks > 0 && row.verifier_checks <= 4096,
    `${label}: verifier count`);
  check(row.partial_expansions >= row.verifier_checks,
    `${label}: partial expansion accounting`);
  check(row.observation_queries === expectedObservationQueries(row.arm),
    `${label}: observation count`);
  check(row.wall_ns === null && row.peak_bytes === null,
    `${label}: unmeasured development resources`);
  check(row.verifier_domain_points === 125, `${label}: verifier domain`);
  check(row.fallback_work_counted === true, `${label}: fallback accounting`);
  check(row.global_cap_hit === false, `${label}: unexpected cap hit`);
  check(row.fallback_exhausted === false && row.censoring_reason === null,
    `${label}: unexpected fallback exhaustion`);
  check(row.primary_cost === row.verifier_checks,
    `${label}: primary cost accounting`);
  check(row.injected_invalid === true && row.injected_invalid_rejected === true,
    `${label}: invalid-first rejection`);
  check(Number.isInteger(row.injected_counterexample_index) &&
    row.injected_counterexample_index >= 0 &&
    row.injected_counterexample_index < 125,
    `${label}: injected counterexample`);
  for (const field of hashFields)
    check(/^[0-9a-f]{64}$/.test(row[field]), `${label}: ${field}`);
  check(row.accepted_semantic_sha256 === row.behavior_sha256,
    `${label}: accepted semantics`);
  check(row.source_artifact_reads === sourceArtifactBytesRead(row.arm),
    `${label}: source artifact read accounting`);
  check(row.source_artifact_sha256 === result.artifact_sha256,
    `${label}: source artifact binding`);
  check(typeof row.family_replay_hex === "string" &&
    sha256(Buffer.from(row.family_replay_hex, "hex")) ===
      row.family_replay_sha256, `${label}: replay preimage binding`);
  environmentKeys.add(`${row.source_generator_id}|${row.generator_id}`);
  const episode = episodeRows.get(row.episode_id) ?? [];
  episode.push(row);
  episodeRows.set(row.episode_id, episode);
  const familyKey = `${row.source_generator_id}|${row.generator_id}|${row.family_id}`;
  const family = familyRows.get(familyKey) ?? [];
  family.push(row);
  familyRows.set(familyKey, family);
}
check(environmentKeys.size === 4, "all four generator environments are required");
check(episodeRows.size === 32, "expected 32 distinct episode IDs");
check(familyRows.size === 16, "expected 16 independent environment-family units");

for (const [episodeId, episode] of episodeRows) {
  check(episode.length === 40, `${episodeId}: expected 40 arms`);
  const byArm = new Map(episode.map((row) => [row.arm, row]));
  check(byArm.size === 40, `${episodeId}: duplicate or missing arm`);
  check(expectedArms.every((arm) => byArm.has(arm)),
    `${episodeId}: incomplete arm set`);
  for (const row of episode.slice(1))
    sameFields(episode[0], row, parityFields, `${episodeId}: arm parity`);
  sameFields(byArm.get("source_free_jit"), byArm.get("source_ablation"),
    equalityFields, `${episodeId}: source ablation`);
  sameFields(byArm.get("full"), byArm.get("oracle_adapter"),
    equalityFields, `${episodeId}: oracle adapter`);
  sameFields(byArm.get("target_only"), byArm.get("adapter_only"),
    equalityFields, `${episodeId}: guide-off factorial parity`);
}

for (const [familyId, family] of familyRows) {
  check(new Set(family.map((row) => row.nested_repeat_id)).size === 2,
    `${familyId}: expected two nested tie repeats`);
  check(family.length === 80, `${familyId}: expected 80 nested arm rows`);
}

const targetHeadroomByFamily = new Map();
for (const row of rows.filter(item => item.arm === "target_only")) {
  const costs = targetHeadroomByFamily.get(row.family_id) ?? [];
  costs.push(row.primary_cost);
  targetHeadroomByFamily.set(row.family_id, costs);
}
for (const [familyId, costs] of targetHeadroomByFamily) {
  check(costs.length === 4, `${familyId}: expected four fixed tie environments`);
  const familyMedian = median(costs);
  check(familyMedian >= contract.development_gates.target_only_median_minimum &&
    familyMedian <= contract.development_gates.target_only_median_maximum,
  `${familyId}: development headroom selection changed`);
}

for (const arm of result.arms) {
  const armRows = rows.filter((row) => row.arm === arm.arm);
  check(armRows.length === 32, `${arm.arm}: expected 32 rows`);
  const sums = {
    primary_cost: 0,
    verifier_checks: 0,
    partial_expansions: 0,
    exact_answers: 0,
    fallback_episodes: 0,
    global_cap_hits: 0,
    invalid_first_rejected: 0,
  };
  for (const row of armRows) {
    sums.primary_cost += row.primary_cost;
    sums.verifier_checks += row.verifier_checks;
    sums.partial_expansions += row.partial_expansions;
    sums.exact_answers += Number(row.exact);
    sums.fallback_episodes += Number(row.fallback_started);
    sums.global_cap_hits += Number(row.global_cap_hit);
    sums.invalid_first_rejected += Number(row.injected_invalid_rejected);
  }
  check(Object.entries(sums).every(([key, value]) => arm[key] === value),
    `${arm.arm}: summary does not replay from raw rows`);
}

const targetCosts = rows
  .filter((row) => row.arm === "target_only")
  .map((row) => row.primary_cost);
check(result.target_only_headroom.minimum === Math.min(...targetCosts) &&
  result.target_only_headroom.median === median(targetCosts) &&
  result.target_only_headroom.maximum === Math.max(...targetCosts),
  "target-only headroom summary mismatch");

function makeParityBundle(family, universe) {
  const content = publicR55Episode(family);
  const fields = {
    candidates: universe,
    grammar: {
      field: "GF(5)", lanes: 3, primitive_symbols: 8, program_length: 4,
    },
    initial_evidence: {
      public: content.public,
      source_artifact_sha256: result.artifact_sha256,
    },
    allowed_actions: content.public.allowed_actions,
    latent_episode: {
      target_ast: content.evaluator.ast,
      target_behavior: content.evaluator.behavior,
    },
    potential_response: {
      candidate_count: 4096,
      response_type: "affine-gf5-v3",
    },
    verifier: { method: "exhaustive-gf5-v3", points: 125 },
    caps: {
      proposal_budget: 64,
      global_cap: 4096,
      unsolved_cost: 4097,
      fallback_order: "shared-canonical-candidate-order-v1",
    },
  };
  const armParityReceipts = expectedArms.map(arm =>
    armParityReceipt({ arm, ...fields }));
  const first = armParityReceipts[0];
  return {
    content,
    expected_arms: expectedArms,
    arm_parity_receipts: armParityReceipts,
    ranker_policy: R55_RANKER_POLICY,
    trace_binding: {
      candidate_universe_digest: canonicalDigest("candidate-universe",
        first.candidate_multiset),
      grammar_digest: first.grammar_sha256,
      initial_evidence_digest: first.initial_evidence_sha256,
      allowed_actions_digest: first.allowed_actions_sha256,
      latent_episode_digest: first.latent_episode_sha256,
      potential_response_digest: first.potential_response_sha256,
      verifier_digest: first.verifier_sha256,
      caps_digest: first.caps_sha256,
    },
  };
}

function analysisContract() {
  const unitFields = R55_UNIT_FIELDS;
  const comparison = {
    full_arm: "full",
    comparator_arm: "adapter_only",
    unit_fields: unitFields,
    design: "one-way",
    direction: "lower",
    seed: "55a1000000000001",
    replicates: 256,
    alpha: 0.01,
    environment_field: "generator_id",
  };
  return {
    schema: "zero.reasoner5_analysis_contract.v1",
    expected_arms: expectedArms,
    selected_lanes: ["development"],
    source_isolated_arms: ["target_only", "adapter_only",
      "source_free_jit", "source_ablation"],
    primary_cost_rule: "verified-search",
    analysis_settings_sha256: canonicalDigest("analysis-settings",
      R55_ANALYSIS_SETTINGS),
    analysis_function_sha256: analysisFunctionDigest(
      reconstructR55Development),
    common_gate_registration: {
      primary_alpha: 0.01,
      primary_strata: [
        "target-syntax-first",
        "target-skeleton-first",
        "cross-generator",
      ],
      formal_mechanisms: ["raw-lexical-guide"],
      crossed_design: false,
      marginal_axes: [],
      derangements: 31,
      mechanism_family_alpha: 0.05,
      factorial_interaction_required: true,
    },
    trace_schema: "zero.reasoner5_trace_row.v1",
    primary_analysis: comparison,
    stratum_analyses: sharedPrimaryStrata(comparison,
      R55_ANALYSIS_SETTINGS.intersection_union.simple_effect.stratum_seeds),
    mechanism_analyses: [{
      ...comparison,
      name: "raw-lexical-guide",
      full_arm: "raw_lexical",
      comparator_arm: "full",
      direction: "higher",
      seed: "55a1000000000006",
      alpha: 0.05,
    }],
    factorial_analysis: {
      adapter_guide_arm: "full",
      adapter_only_arm: "adapter_only",
      guide_only_arm: "raw_lexical",
      raw_arm: "target_only",
      unit_fields: unitFields,
      design: "one-way",
      direction: "lower",
      seed: "55a1000000000007",
      replicates: 256,
      alpha: 0.01,
      environment_field: "generator_id",
    },
    derangement_analysis: {
      observed_arm: "full",
      reference_arms: expectedArms.filter(arm => arm.startsWith("shuffled_")),
      unit_fields: unitFields,
    },
    source_ablation: {
      ablation_arm: "source_ablation",
      source_free_arm: "source_free_jit",
    },
    headroom: {
      comparator_arm: "target_only",
      median_primary_cost_min:
        contract.development_gates.target_only_median_minimum,
    },
  };
}

function scientificAnalysis(analysisRows) {
  const simple = {
    primary: comparisonInference(analysisRows, R55_SIMPLE_PRIMARY),
    strata: primaryStrata(R55_SIMPLE_PRIMARY,
      R55_ANALYSIS_SETTINGS.intersection_union.simple_effect.stratum_seeds)
      .map(analysis => ({
        name: analysis.name,
        inference: comparisonInference(analysisRows, analysis),
      })),
  };
  const operational = operationalAnalysis(analysisRows);
  const mechanismComparison = {
    ...R55_SIMPLE_PRIMARY,
    full_arm: "raw_lexical",
    comparator_arm: "full",
    direction: "higher",
    seed: R55_ANALYSIS_SETTINGS.intersection_union.formal_mechanism.seed,
    alpha: R55_ANALYSIS_SETTINGS.intersection_union.formal_mechanism.alpha,
  };
  const mechanisms = [{
    name: "raw-lexical-guide",
    inference: comparisonInference(analysisRows, mechanismComparison),
  }];
  const factorialUnits = factorialInteractionFamilies(analysisRows, {
    adapterGuideArm: "full",
    adapterOnlyArm: "adapter_only",
    guideOnlyArm: "raw_lexical",
    rawArm: "target_only",
    unitFields: R55_UNIT_FIELDS,
    costField: "primary_cost",
  });
  const factorial = familyInferenceReceipt(factorialUnits, {
    design: "one-way",
    direction: "lower",
    seed: R55_ANALYSIS_SETTINGS.intersection_union.factorial_interaction.seed,
    replicates: 256,
    alpha: 0.01,
    environmentField: "generator_id",
  });
  const targetCosts = analysisRows.filter(row => row.arm === "target_only")
    .map(row => row.primary_cost).sort((left, right) => left - right);
  const middle = Math.floor(targetCosts.length / 2);
  const headroomMedian = targetCosts.length % 2 ? targetCosts[middle] :
    (targetCosts[middle - 1] + targetCosts[middle]) / 2;
  return {
    simple,
    operational,
    mechanisms,
    factorial,
    derangement: derangementAnalysis(analysisRows),
    headroom: {
      comparator_arm: "target_only",
      median_primary_cost: headroomMedian,
      registered_minimum:
        contract.development_gates.target_only_median_minimum,
      measurement_floor: headroomMedian <
        contract.development_gates.target_only_median_minimum,
    },
  };
}

function r55CommonGate(commonResult, rawTraces, registration, analysis) {
  return reconstructCommonGate({
    integrity_valid: commonResult.integrity.manifest_digest_valid &&
      commonResult.integrity.trace_contract_valid,
    registration,
    exact: {
      ...commonResult.exactness,
      fallback_receipts: rawTraces.map(row => row.fallback_receipt),
    },
    measurement_floor: analysis.headroom.measurement_floor,
    primary: { inference: analysis.primary },
    strata: analysis.strata,
    mechanisms: analysis.mechanisms,
    derangement: analysis.derangement,
    source_ablation_matches_source_free:
      commonResult.registered_analysis.source_ablation.matches,
    factorial: {
      inference: analysis.factorial,
    },
  });
}

function intersectionUnionGate(simpleGate, operationalGate,
  factorialInteraction, adapterReceipt) {
  const checks = {
    adapter_exact: adapterReceipt?.all_exact === true,
    simple_effect_common_gate: simpleGate.passed === true,
    operational_comparator_common_gate: operationalGate.passed === true,
    negative_factorial_interaction: factorialInteraction === true,
  };
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed).map(([name]) => name);
  const invalid = [simpleGate, operationalGate]
    .some(gate => gate.decision === "invalid-run") ||
    adapterReceipt?.all_exact !== true;
  const measurementFloor = [simpleGate, operationalGate]
    .some(gate => gate.decision === "measurement-floor");
  const decision = invalid ? "invalid-run" : measurementFloor ?
    "measurement-floor" : failures.length === 0 ? "pass" : "no-go";
  const body = {
    schema: "zero.reasoner55_intersection_union_gate.v1",
    alpha: 0.01,
    rule: "exact adapter AND simple-effect common gate AND operational-comparator common gate AND negative factorial upper limit",
    checks,
    failures,
    decision,
    passed: decision === "pass",
  };
  return {
    ...body,
    gate_sha256: canonicalDigest("reasoner55-intersection-union-gate", body),
  };
}

function buildR55AnalysisRecord(commonResult, rawTraces, nativeRows,
  nativeRawTraceSha256, familyCache, registration, nativeResultSha256) {
  const analysisView = buildR55AnalysisView(nativeRows, rawTraces,
    nativeRawTraceSha256);
  const adapterReceipt = adapterAggregateReceipt(familyCache);
  const selectionReceipt = sourceFreeSelectionReceipt(analysisView.rows);
  const analysis = scientificAnalysis(analysisView.rows);
  const simpleGate = r55CommonGate(commonResult, rawTraces, registration, {
    primary: analysis.simple.primary,
    strata: analysis.simple.strata,
    mechanisms: analysis.mechanisms,
    factorial: analysis.factorial,
    derangement: analysis.derangement,
    headroom: analysis.headroom,
  });
  const operationalGate = r55CommonGate(commonResult, rawTraces, registration, {
    primary: analysis.operational.primary,
    strata: analysis.operational.strata,
    mechanisms: analysis.mechanisms,
    factorial: analysis.factorial,
    derangement: analysis.derangement,
    headroom: analysis.headroom,
  });
  const factorial = analysis.factorial;
  const factorialPass = factorial.interval.upper_log_ratio < 0;
  const gate = intersectionUnionGate(simpleGate, operationalGate,
    factorialPass, adapterReceipt);
  const body = {
    schema: "zero.reasoner55_development_analysis.v1",
    experiment: commonResult.experiment,
    status: "development-only",
    execution_authorized: false,
    adapter: adapterReceipt,
    analysis_view: analysisView.receipt,
    source_free_selection: selectionReceipt,
    simple_effect: {
      full_arm: "full",
      comparator_arm: "adapter_only",
      primary: analysis.simple.primary,
      strata: analysis.simple.strata,
      common_gate: simpleGate,
    },
    operational_comparator: {
      full_arm: "full",
      comparator_arm: "source_free_jit",
      primary: analysis.operational.primary,
      strata: analysis.operational.strata,
      common_gate: operationalGate,
    },
    factorial_interaction: {
      contrast: "log(full) - log(adapter_only) - log(raw_lexical) + log(target_only)",
      inference: factorial,
      upper_log_ratio_below_zero: factorialPass,
    },
    formal_mechanisms: analysis.mechanisms,
    target_only_headroom: analysis.headroom,
    intersection_union_gate: gate,
    provenance: {
      common_result_sha256: commonResult.result_sha256,
      native_result_sha256: nativeResultSha256,
      native_raw_trace_sha256:
        analysisView.receipt.native_raw_trace_sha256,
      source_artifact_sha256: result.artifact_sha256,
      manifest_sha256: commonResult.manifest_sha256,
      raw_trace_sha256: commonResult.raw_trace_sha256,
      trace_coverage_sha256: commonResult.trace_coverage_sha256,
      analysis_settings_sha256: commonResult.analysis_settings_sha256,
      analysis_function_sha256: commonResult.analysis_function_sha256,
      analysis_view_transform_sha256:
        analysisView.receipt.transform_function_sha256,
      r55_analysis_function_sha256: analysisFunctionDigest(
        buildR55AnalysisRecord),
    },
  };
  return {
    ...body,
    analysis_sha256: canonicalDigest("reasoner55-development-analysis", body),
  };
}

assert.equal(intersectionUnionGate(
  { passed: true, decision: "pass" },
  { passed: true, decision: "pass" }, true,
  { all_exact: true }).decision, "pass");
for (const [simple, operational, factorial] of [
  [false, true, true], [true, false, true], [true, true, false],
]) {
  assert.equal(intersectionUnionGate(
    { passed: simple, decision: simple ? "pass" : "no-go" },
    { passed: operational, decision: operational ? "pass" : "no-go" },
    factorial, { all_exact: true }).decision, "no-go",
  "every intersection-union component must fail closed");
}
assert.equal(intersectionUnionGate(
  { passed: true, decision: "pass" },
  { passed: true, decision: "pass" }, true,
  { all_exact: false }).decision, "invalid-run",
"an inexact adapter must invalidate the intersection-union result");

function buildSharedManifestAndTraces() {
  const state = createSplitState({ experiment_id: result.experiment });
  check(Array.isArray(result.split_families) &&
    result.split_families.length === 136,
  "split receipt must contain every source and development family");
  check(new Set(result.split_families.map(item => item.ast_sha256)).size ===
    result.split_families.length, "target AST crosses a split or family");
  check(new Set(result.split_families.map(item => item.behavior_sha256)).size ===
    result.split_families.length, "target behavior crosses a split or family");
  for (const family of result.split_families) {
    const familyId = family.lane === "development" ?
      `development-${family.generator_id}-${String(family.ordinal)
        .padStart(3, "0")}` :
      `source-training-${family.generator_id}-${String(family.ordinal)
        .padStart(3, "0")}`;
    registerFamily(state, {
      family_id: familyId,
      lane: family.lane,
      generator_id: family.generator_id,
      shift_stratum: family.lane === "development" ?
        "generated-affine" : "source-generated-affine",
      family_spec: {
        target_ast_digest: family.ast_sha256,
        target_behavior_digest: family.behavior_sha256,
      },
    });
  }
  freezeFamilySplits(state);
  const replayCache = createR55ReplayCache();
  const familyCache = new Map();
  const parityCache = new Map();
  const searchByRow = new Map();
  for (const [episodeId, episode] of episodeRows) {
    const first = episode[0];
    const decoded = decodeR55Replay(first);
    const priorFamily = familyCache.get(first.family_id);
    if (priorFamily === undefined) familyCache.set(first.family_id, decoded);
    else {
      for (const field of ["primitiveByRole", "surfaceToRole", "surfaceIds",
        "targetRoles", "target", "exampleInput", "exampleOutput",
        "generator", "ordinal", "familySeed"])
        assert.deepEqual(priorFamily[field], decoded[field],
          `${episodeId}: family replay changed ${field}`);
    }
    const family = familyCache.get(first.family_id);
    family.tieSalt = decoded.tieSalt;
    family.sourceGenerator = decoded.sourceGenerator;
    family.tie = decoded.tie;
    let parity = parityCache.get(first.family_id);
    if (parity === undefined) {
      const replay = replayR55Search(first, family,
        artifactGuides[decoded.sourceGenerator], replayCache);
      searchByRow.set(`${episodeId}\0${first.arm}`, replay.search);
      parity = makeParityBundle(family, replay.universe);
      parityCache.set(first.family_id, parity);
    }
    const rootSeed = family.familySeed.toString(16).padStart(16, "0");
    const derivationPath = [first.generator_id, decoded.ordinal,
      first.source_generator_id, Number(first.nested_repeat_id.slice(4))];
    const recipe = {
      schema: "zero.reasoner5_replay_recipe.v1",
      generator_sha256: R55_GENERATOR_SHA256,
      input_generator_sha256: R55_INPUT_GENERATOR_SHA256,
      replay_function_sha256: R55_REPLAY_FUNCTION_SHA256,
      seed_binding: { root_seed: rootSeed, derivation_path: derivationPath },
    };
    registerEpisode(state, {
      episode_id: episodeId,
      lane: "development",
      family_id: first.family_id,
      cross_family_id: null,
      nested_repeat_id: first.nested_repeat_id,
      seed_ref: canonicalDigest("episode-seed-reference", recipe),
      replay_recipe: recipe,
      ...parity,
      public: parity.content.public,
      evaluator: parity.content.evaluator,
    });
  }
  const manifest = finalizeManifest(state, {
    source_artifact: {
      sha256: result.artifact_sha256,
      canonical_bytes: artifact.length,
    },
    derangement_registration: {
      seed: R55_DERANGEMENT_SEED,
      namespace: R55_DERANGEMENT_NAMESPACE,
      digest: R55_DERANGEMENT_DIGEST,
      permutations: R55_DERANGEMENTS,
    },
    analysis_contract: analysisContract(),
  });
  const manifestEpisodes = new Map(manifest.episodes.map(item =>
    [item.episode_id, item]));
  const normalized = [];
  for (const [index, row] of rows.entries()) {
    const decoded = decodeR55Replay(row);
    const family = familyCache.get(row.family_id);
    family.tieSalt = decoded.tieSalt;
    family.sourceGenerator = decoded.sourceGenerator;
    family.tie = decoded.tie;
    const key = `${row.episode_id}\0${row.arm}`;
    let search = searchByRow.get(key);
    if (search === undefined) {
      search = replayR55Search(row, family,
        artifactGuides[decoded.sourceGenerator], replayCache).search;
      searchByRow.set(key, search);
    }
    const episode = manifestEpisodes.get(row.episode_id);
    check(episode !== undefined, `trace row ${index + 1}: manifest episode`);
    normalized.push({
      schema: "zero.reasoner5_trace_row.v1",
      experiment: result.experiment,
      lane: episode.lane,
      family_id: episode.family_id,
      cross_family_id: episode.cross_family_id,
      generator_id: episode.generator_id,
      shift_stratum: episode.shift_stratum,
      episode_id: episode.episode_id,
      nested_repeat_id: episode.nested_repeat_id,
      arm: row.arm,
      episode_bytes_sha256: episode.episode_bytes_sha256,
      ast_sha256: episode.fingerprints.ast_sha256,
      behavior_sha256: episode.fingerprints.behavior_sha256,
      episode_spec_sha256: episode.fingerprints.episode_spec_sha256,
      candidate_universe_digest:
        episode.trace_binding.candidate_universe_digest,
      grammar_digest: episode.trace_binding.grammar_digest,
      initial_evidence_digest: episode.trace_binding.initial_evidence_digest,
      allowed_actions_digest: episode.trace_binding.allowed_actions_digest,
      latent_episode_digest: episode.trace_binding.latent_episode_digest,
      potential_response_digest:
        episode.trace_binding.potential_response_digest,
      verifier_digest: episode.trace_binding.verifier_digest,
      caps_digest: episode.trace_binding.caps_digest,
      parity_digest: episode.trace_binding.parity_digest,
      verified_search: search,
      execution_trace_sha256: search.search_sha256,
      primary_cost: search.primary_cost,
      verifier_checks: search.verifier_checks,
      partial_expansions: search.partial_expansions,
      fallback_verifier_checks: search.fallback_verifier_checks,
      fallback_partial_expansions: search.fallback_partial_expansions,
      observation_queries: row.observation_queries,
      wall_ns: row.wall_ns,
      peak_bytes: row.peak_bytes,
      source_artifact_reads: row.source_artifact_reads,
      exact: search.solved,
      certificate_valid: search.certificate_sha256 !== null,
      premature_commit: search.premature_commits > 0,
      fallback_started: search.fallback_started,
      global_cap_hit: search.global_cap_hit,
      fallback_exhausted: search.fallback_exhausted,
      censoring_reason: search.censoring_reason,
      injected_invalid: search.injected_invalid !== null,
      injected_invalid_rejected: search.injected_invalid?.rejected === true,
      answer_ir: search.answer_ir,
      answer_ir_sha256: search.answer_ir_sha256,
      certificate_sha256: search.certificate_sha256,
      fallback_receipt: search.fallback_receipt,
    });
  }
  return { manifest, normalized, familyCache };
}

const artifactGuides = parseR55Artifact(artifact);
const generatedDerangements = [];
const derangementKeys = new Set();
const derangementRng = createDeterministicRng(R55_DERANGEMENT_SEED,
  R55_DERANGEMENT_NAMESPACE);
while (generatedDerangements.length < 31) {
  const permutation = [0, 1, 2, 3, 4, 5, 6, 7];
  for (let index = 7; index > 0; index -= 1) {
    const other = derangementRng.index(index + 1);
    [permutation[index], permutation[other]] =
      [permutation[other], permutation[index]];
  }
  if (permutation.some((value, index) => value === index)) continue;
  const key = permutation.join(",");
  if (derangementKeys.has(key)) continue;
  derangementKeys.add(key);
  generatedDerangements.push(permutation);
}
assert.deepEqual(generatedDerangements, R55_DERANGEMENTS,
  "frozen derangements must replay from the registered uniform sampler");
check(canonicalDigest("reasoner55-frozen-derangements",
  generatedDerangements) === R55_DERANGEMENT_DIGEST,
"frozen derangement digest mismatch");

const overlapProbe = createSplitState({ experiment_id: "r55-overlap-probe" });
registerFamily(overlapProbe, {
  family_id: "source", lane: "source-training", generator_id: "syntax-first",
  shift_stratum: "source-generated-affine",
  family_spec: { semantic_task: "same-generated-family" },
});
assert.throws(() => registerFamily(overlapProbe, {
  family_id: "development", lane: "development",
  generator_id: "syntax-first", shift_stratum: "generated-affine",
  family_spec: { semantic_task: "same-generated-family" },
}), /family fingerprint duplicates/u);

assert.throws(() => assertRankerView({
  primitive_labels: ["p0"],
  observations: [{ input: [0, 0, 0], observed: [0, 0, 0],
    TARGET: [1, 2, 3] }],
  allowed_actions: [{ kind: "propose-four-symbol-program" }],
}, {
  whitelist: R55_RANKER_POLICY.leaf_whitelist,
  leafContracts: R55_RANKER_POLICY.leaf_contracts,
}), /complete registered schema|outside the registered schema|evaluator field/u);
assert.throws(() => assertRankerView({
  primitive_labels: ["p0"],
  observations: [{ input: [0, 0, 0], observed: [0, 0, 0] }],
}, {
  whitelist: R55_RANKER_POLICY.leaf_whitelist,
  leafContracts: R55_RANKER_POLICY.leaf_contracts,
}), /complete registered schema/u);
for (const hiddenField of ["target", "surface_to_role", "family_seed",
  "atoms", "typed_subtrees"]) {
  assert.throws(() => assertRankerView({
    primitive_labels: ["p0"],
    observations: [{ input: [0, 0, 0], observed: [0, 0, 0],
      [hiddenField]: 1 }],
    allowed_actions: [{ kind: "propose-four-symbol-program" }],
  }, {
    whitelist: R55_RANKER_POLICY.leaf_whitelist,
    leafContracts: R55_RANKER_POLICY.leaf_contracts,
  }), /complete registered schema|outside the registered schema|evaluator field/u,
  `ranker view leaked hidden field ${hiddenField}`);
}

const censorUniverse = Object.freeze([0, 1, 2].map(value =>
  Object.freeze({ semantic: value, ast: value, partial_expansions: 1 })));
const censored = runVerifiedSearch({
  proposals: [censorUniverse[0]],
  fallback: canonicalCandidateOrder(censorUniverse),
  candidate_universe: censorUniverse,
  global_cap: 16,
  injected_invalid_sha256: canonicalDigest("candidate-semantic-class", 0),
  verify: candidate => ({ accepted: false, certificate_valid: false,
    counterexample: { candidate: candidate.semantic } }),
});
check(censored.fallback_exhausted && !censored.global_cap_hit &&
  censored.primary_cost === 17 && censored.censoring_reason ===
    "fallback-exhausted", "exhausted fallback must receive cap-plus-one cost");

const shared = buildSharedManifestAndTraces();
const replayRegistry = createReplayRegistry();
registerReplayPipeline(replayRegistry, {
  generator_sha256: R55_GENERATOR_SHA256,
  input_generator_sha256: R55_INPUT_GENERATOR_SHA256,
  replay_function_sha256: R55_REPLAY_FUNCTION_SHA256,
  replay: replayR55EpisodeContent,
});
const replayReceipt = assertManifestReplay(shared.manifest, replayRegistry);
check(replayReceipt.episodes === 32, "shared manifest replay count");
const coverage = assertRawTraceCoverage({
  manifest: shared.manifest,
  rawTraces: shared.normalized,
});
check(coverage.rows === 1280 && coverage.episodes === 32,
  "shared trace coverage count");
check(coverage.exactness.all_final_answers_exact &&
  coverage.exactness.all_certificates_valid &&
  coverage.exactness.all_injected_invalid_first_candidates_rejected &&
  coverage.exactness.fallback_work_counted,
"shared trace exactness receipt");
const commonResult = buildResultFromRawTraces({
  experiment: result.experiment,
  manifest: shared.manifest,
  rawTraces: shared.normalized,
  reconstruct: reconstructR55Development,
  analysisSettings: R55_ANALYSIS_SETTINGS,
});
const commonReplay = assertResultReplay({
  experiment: result.experiment,
  manifest: shared.manifest,
  rawTraces: shared.normalized,
  reconstruct: reconstructR55Development,
  analysisSettings: R55_ANALYSIS_SETTINGS,
  result: commonResult,
});
check(commonReplay.result_sha256 === commonResult.result_sha256 &&
  commonResult.integrity.manifest_digest_valid &&
  commonResult.integrity.trace_contract_valid,
"common result must replay from strict raw traces");
const analysisView = buildR55AnalysisView(rows, shared.normalized,
  result.raw_trace_sha256);
assertR55AnalysisView(rows, shared.normalized, result.raw_trace_sha256,
  analysisView);
const tamperedSourceRows = structuredClone(rows);
tamperedSourceRows[0].source_generator_id =
  tamperedSourceRows[0].source_generator_id === "syntax-first" ?
    "skeleton-first" : "syntax-first";
assert.throws(() => buildR55AnalysisView(tamperedSourceRows,
  shared.normalized, result.raw_trace_sha256), /native raw trace bytes/u);
const tamperedTargetRows = structuredClone(rows);
tamperedTargetRows[0].generator_id =
  tamperedTargetRows[0].generator_id === "syntax-first" ?
    "skeleton-first" : "syntax-first";
assert.throws(() => buildR55AnalysisView(tamperedTargetRows,
  shared.normalized, result.raw_trace_sha256), /native raw trace bytes/u);
const tamperedEnvironmentView = structuredClone(analysisView);
tamperedEnvironmentView.rows[0].generator_id = "forged->environment";
assert.throws(() => assertR55AnalysisView(rows, shared.normalized,
  result.raw_trace_sha256, tamperedEnvironmentView),
/deterministic transform/u);
const tamperedIdentityView = structuredClone(analysisView);
tamperedIdentityView.rows[0].input_row_identity_sha256 = "0".repeat(64);
assert.throws(() => assertR55AnalysisView(rows, shared.normalized,
  result.raw_trace_sha256, tamperedIdentityView), /deterministic transform/u);

for (const [familyId, family] of shared.familyCache) {
  const lexical = rawLexicalRoles(family);
  check(new Set(lexical).size === 8,
    `${familyId}: raw lexical guide must preserve eight public labels`);
  const hiddenRoleTamper = structuredClone(family);
  hiddenRoleTamper.surfaceToRole.reverse();
  assert.deepEqual(rawLexicalRoles(hiddenRoleTamper), lexical,
    `${familyId}: raw lexical mapping read a hidden semantic role`);
}
const adapterProbeFamily = shared.familyCache.values().next().value;
const adapterProbes = buildR55AdapterProbes(adapterProbeFamily);
check(reconstructR55Adapter(adapterProbeFamily, adapterProbes).exact,
  "adapter reconstruction must derive from public probe responses");
const tamperedProbes = structuredClone(adapterProbes);
tamperedProbes[0].queries[0].observed[0] =
  (tamperedProbes[0].queries[0].observed[0] + 1) % 5;
check(!reconstructR55Adapter(adapterProbeFamily, tamperedProbes).exact,
  "adapter receipt must reject a changed public probe response");
const tamperedHiddenFamily = structuredClone(adapterProbeFamily);
tamperedHiddenFamily.primitiveByRole[0].bias[0] =
  (tamperedHiddenFamily.primitiveByRole[0].bias[0] + 1) % 5;
check(!reconstructR55Adapter(tamperedHiddenFamily, adapterProbes).exact,
  "adapter receipt must reject changed hidden generator coefficients");

const sourceOnlyRow = rows.find(row => row.arm === "source_only");
const sourceOnlyFamily = decodeR55Replay(sourceOnlyRow);
const sourceOnlyPublicPrimitives = sourceOnlyFamily.surfaceToRole.map(role =>
  structuredClone(sourceOnlyFamily.primitiveByRole[role]));
const sourceOnlyHiddenTamper = structuredClone(sourceOnlyFamily);
sourceOnlyHiddenTamper.surfaceToRole.reverse();
sourceOnlyHiddenTamper.primitiveByRole = Array(8);
sourceOnlyHiddenTamper.surfaceToRole.forEach((role, slot) => {
  sourceOnlyHiddenTamper.primitiveByRole[role] =
    sourceOnlyPublicPrimitives[slot];
});
replayR55Search(sourceOnlyRow, sourceOnlyHiddenTamper,
  artifactGuides[sourceOnlyHiddenTamper.sourceGenerator],
  createR55ReplayCache());

const fullRow = rows.find(row => row.arm === "full");
const oracleRow = rows.find(row => row.episode_id === fullRow.episode_id &&
  row.arm === "oracle_adapter");
const oracleFamily = decodeR55Replay(oracleRow);
replayR55Search(oracleRow, oracleFamily,
  artifactGuides[oracleFamily.sourceGenerator], createR55ReplayCache(),
  { adapterProbes: [] });
assert.throws(() => replayR55Search(fullRow, decodeR55Replay(fullRow),
  artifactGuides[oracleFamily.sourceGenerator], createR55ReplayCache(),
  { adapterProbes: [] }),
"full must use the reconstructed adapter while oracle bypasses it");
for (const arm of ["target_only", "raw_lexical", "frequency_lexical",
  "source_only", "oracle_adapter"]) {
  const adapterFreeRow = rows.find(row => row.episode_id ===
    fullRow.episode_id && row.arm === arm);
  const adapterFreeFamily = decodeR55Replay(adapterFreeRow);
  replayR55Search(adapterFreeRow, adapterFreeFamily,
    artifactGuides[adapterFreeFamily.sourceGenerator],
    createR55ReplayCache(), { adapterProbes: [] });
}

const nativeResultSha256 = sha256(resultBytes);
const r55Analysis = buildR55AnalysisRecord(commonResult, shared.normalized,
  rows, result.raw_trace_sha256, shared.familyCache,
  shared.manifest.analysis_contract.common_gate_registration,
  nativeResultSha256);
const replayedR55Analysis = buildR55AnalysisRecord(commonResult,
  shared.normalized, rows, result.raw_trace_sha256, shared.familyCache,
  shared.manifest.analysis_contract.common_gate_registration,
  nativeResultSha256);
assert.deepEqual(replayedR55Analysis, r55Analysis,
  "R5.5 intersection-union analysis must replay exactly");
check(r55Analysis.source_free_selection.selected_arm ===
    result.development_selection.strongest_source_free_arm &&
  r55Analysis.source_free_selection.selected_arm ===
    contract.development_selection.strongest_source_free_arm &&
  r55Analysis.source_free_selection.independent_environment_family_units ===
    16,
"strongest source-free comparator must derive from the bound analysis view");
check(r55Analysis.operational_comparator.comparator_arm ===
    contract.development_selection.strongest_source_free_arm &&
  r55Analysis.simple_effect.comparator_arm === "adapter_only",
"registered intersection-union comparators changed");
for (const inference of [r55Analysis.simple_effect.primary,
  r55Analysis.operational_comparator.primary,
  r55Analysis.factorial_interaction.inference,
  r55Analysis.formal_mechanisms[0].inference]) {
  check(inference.summary.independent_families === 16 &&
    inference.interval.independent_units === 16 &&
    inference.interval.fixed_environments === 4,
  "primary R5.5 inference must keep 16 units in four fixed environments");
}
for (const analysis of [r55Analysis.simple_effect,
  r55Analysis.operational_comparator]) {
  check(analysis.strata.length === 3 &&
    analysis.strata.every(stratum =>
      stratum.inference.summary.independent_families === 8 &&
      stratum.inference.interval.fixed_environments === 2),
  "each R5.5 shift stratum must keep both registered environments");
}
check(r55Analysis.factorial_interaction.upper_log_ratio_below_zero ===
    r55Analysis.intersection_union_gate.checks
      .negative_factorial_interaction,
"intersection-union gate must use the replayed factorial upper limit");
const analysisBytes = Buffer.from(`${JSON.stringify(r55Analysis, null, 2)}\n`);
if (writeAnalysis) writeFileSync(analysisPath, analysisBytes);
else {
  const committedAnalysisBytes = readFileSync(analysisPath);
  assert.deepEqual(JSON.parse(committedAnalysisBytes), r55Analysis,
    "committed R5.5 analysis differs from replay");
  check(sha256(committedAnalysisBytes) ===
      contract.shared_replay.development_analysis_file_sha256,
  "development analysis file digest changed");
}
if (!writeAnalysis) {
  check(contract.shared_replay.strict_trace_schema ===
    "zero.reasoner5_trace_row.v1" &&
    contract.shared_replay.coverage_sha256 === coverage.coverage_sha256 &&
    contract.shared_replay.common_result_sha256 === commonResult.result_sha256 &&
    contract.shared_replay.intersection_union_analysis_sha256 ===
      r55Analysis.analysis_sha256 &&
    contract.shared_replay.scientific_analysis_view
      .transform_function_sha256 ===
      r55Analysis.analysis_view.transform_function_sha256 &&
    contract.shared_replay.scientific_analysis_view.analysis_view_sha256 ===
      r55Analysis.analysis_view.analysis_view_sha256 &&
    contract.shared_replay.scientific_analysis_view.receipt_sha256 ===
      r55Analysis.analysis_view.receipt_sha256,
  "contract shared replay receipt changed");
}
const normalizedByEpisode = new Map();
for (const row of shared.normalized) {
  const episode = normalizedByEpisode.get(row.episode_id) ?? new Map();
  episode.set(row.arm, row);
  normalizedByEpisode.set(row.episode_id, episode);
}
for (const [episodeId, arms] of normalizedByEpisode)
  assertSourceAblationMatches([arms.get("source_ablation")],
    [arms.get("source_free_jit")], episodeId);

console.log(`Reasoner 5.5 development checks passed: ${rows.length} rows, ` +
  `${familyRows.size} environment-family views, shared coverage ` +
  `${coverage.coverage_sha256}, common result ${commonResult.result_sha256}, ` +
  `intersection result ${r55Analysis.analysis_sha256}, decision ` +
  `${r55Analysis.intersection_union_gate.decision}, artifact ` +
  `${result.artifact_sha256}`);
