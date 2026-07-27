#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateLiteratureReview } from "./check_literature_review.mjs";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function range(value, name) {
  assert(value && Number.isFinite(value.lower) && Number.isFinite(value.upper),
    `${name} must be a finite range`);
  assert(value.lower >= 0 && value.upper >= value.lower,
    `${name} range is invalid`);
}
function sumRanges(values) {
  return values.reduce(
    (total, value) => ({
      lower: total.lower + value.lower,
      upper: total.upper + value.upper,
    }),
    { lower: 0, upper: 0 },
  );
}
function sameRange(left, right) {
  return Math.abs(left.lower - right.lower) < 1e-12 &&
    Math.abs(left.upper - right.upper) < 1e-12;
}

const REQUIRED_PHASES = [
  "literature",
  "design",
  "implementation",
  "execution",
  "evaluation",
  "analysis",
];

export function validateExperimentEvidence(
  evidence,
  { requireReady = false, evidencePath = null } = {},
) {
  assert(evidence?.schema === "zero.experiment_evidence.v1",
    "unsupported experiment evidence schema");
  assert(nonEmpty(evidence.experiment_id), "experiment id is missing");
  assert(
    [
      "draft",
      "review_incomplete",
      "design_revision_required",
      "ready_for_authorization",
      "retired",
    ]
      .includes(evidence.status),
    "experiment evidence status is invalid",
  );
  assert(/^\d{4}-\d{2}-\d{2}$/.test(evidence.updated_at),
    "evidence update date is invalid");
  assert(evidence.policy?.completed_history_rewritten === false,
    "evidence policy rewrites completed history");

  const literature = evidence.literature;
  assert(
    ["scoped", "screened_review_incomplete", "review_complete"]
      .includes(literature?.status),
    "literature status is invalid",
  );
  const protocol = literature.search_protocol;
  for (const [name, values] of [
    ["sources", protocol?.sources],
    ["questions", protocol?.questions],
    ["inclusion criteria", protocol?.inclusion_criteria],
    ["known gaps", protocol?.known_gaps],
  ]) {
    assert(Array.isArray(values) && values.length > 0 &&
      values.every(nonEmpty), `literature ${name} are missing`);
  }
  assert(/^\d{4}-\d{2}-\d{2}$/.test(protocol.searched_at),
    "literature search date is invalid");
  assert(Array.isArray(literature.works) && literature.works.length >= 5,
    "literature list must contain at least five relevant primary works");
  const workIds = new Set();
  for (const work of literature.works) {
    assert(nonEmpty(work.id) && !workIds.has(work.id),
      "literature work id is missing or duplicated");
    workIds.add(work.id);
    assert(nonEmpty(work.citation) && Number.isInteger(work.year) &&
      work.year >= 1900, `${work.id} citation metadata is invalid`);
    assert(/^https:\/\//.test(work.url), `${work.id} lacks a stable HTTPS URL`);
    assert(
      ["supporting", "context", "limiting", "counterevidence"]
        .includes(work.stance),
      `${work.id} stance is invalid`,
    );
    assert(
      ["abstract_screened", "full_text_reviewed"]
        .includes(work.review_status),
      `${work.id} review status is invalid`,
    );
    for (const field of ["relevance", "limits", "design_consequence"]) {
      assert(nonEmpty(work[field]), `${work.id} ${field} is missing`);
    }
  }
  assert(
    literature.works.some((work) =>
      ["limiting", "counterevidence"].includes(work.stance)),
    "literature list lacks a limiting or disconfirming source",
  );
  const requirements = literature.authorization_requirements;
  assert(
    Number.isInteger(requirements?.minimum_full_text_reviews) &&
      requirements.minimum_full_text_reviews >= 1 &&
      Number.isInteger(requirements.minimum_limiting_or_counterevidence) &&
      requirements.minimum_limiting_or_counterevidence >= 1,
    "literature authorization requirements are invalid",
  );
  let review = null;
  if (literature.status === "review_complete") {
    const artifact = literature.review_artifact;
    assert(artifact && nonEmpty(artifact.path) &&
      /^[a-f0-9]{64}$/.test(artifact.sha256),
    "completed literature review lacks a bound artifact");
    assert(path.basename(artifact.path) === artifact.path,
      "literature review artifact must be next to its evidence file");
    assert(evidencePath !== null,
      "evidence path is required to validate the literature artifact");
    const reviewPath = path.resolve(
      path.dirname(path.resolve(evidencePath)),
      artifact.path,
    );
    assert(fs.existsSync(reviewPath),
      "bound literature review artifact is missing");
    const bytes = fs.readFileSync(reviewPath);
    assert(crypto.createHash("sha256").update(bytes).digest("hex") ===
      artifact.sha256,
    "bound literature review artifact hash drifted");
    review = JSON.parse(bytes);
    validateLiteratureReview(review, evidence);
    assert(artifact.status === review.status &&
      artifact.recommendation === review.synthesis.recommendation,
    "literature review summary disagrees with its artifact");
  }

  const costs = evidence.costs;
  assert(costs?.currency === "USD" && costs.estimates_are_ranges === true,
    "cost accounting basis is invalid");
  assert(costs.human_time_monetized === false,
    "human time must remain separately visible");
  assert(Array.isArray(costs.phases), "cost phases are missing");
  assert(
    JSON.stringify(costs.phases.map((phase) => phase.id)) ===
      JSON.stringify(REQUIRED_PHASES),
    "cost phase order or coverage is incomplete",
  );
  for (const phase of costs.phases) {
    assert(
      ["projected", "actual", "mixed"].includes(phase.status),
      `${phase.id} cost status is invalid`,
    );
    range(phase.usd_equivalent, `${phase.id} USD-equivalent`);
    range(phase.cash_usd, `${phase.id} cash`);
    range(phase.agent_credits, `${phase.id} agent credits`);
    range(phase.human_hours, `${phase.id} human hours`);
    range(phase.machine_hours, `${phase.id} machine hours`);
    assert(nonEmpty(phase.basis), `${phase.id} cost basis is missing`);
  }
  const totals = costs.totals;
  range(totals.known_incremental_usd_equivalent,
    "known incremental USD-equivalent");
  range(totals.incremental_cash_usd, "incremental cash");
  range(totals.agent_credits, "total agent credits");
  range(totals.human_hours, "total human hours");
  range(totals.machine_hours, "total machine hours");
  for (const [name, phaseField, totalField] of [
    [
      "known incremental USD-equivalent",
      "usd_equivalent",
      "known_incremental_usd_equivalent",
    ],
    ["incremental cash", "cash_usd", "incremental_cash_usd"],
    ["total agent credits", "agent_credits", "agent_credits"],
    ["total human hours", "human_hours", "human_hours"],
    ["total machine hours", "machine_hours", "machine_hours"],
  ]) {
    assert(
      sameRange(
        totals[totalField],
        sumRanges(costs.phases.map((phase) => phase[phaseField])),
      ),
      `${name} does not equal the phase ledger`,
    );
  }
  assert(Array.isArray(totals.exclusions) &&
    totals.exclusions.length > 0 &&
    totals.exclusions.every(nonEmpty), "cost exclusions are missing");
  assert(
    costs.comparison.knowledge_and_design_can_exceed_execution === true,
    "cost comparison hides knowledge and design cost",
  );
  assert(Number.isFinite(
    costs.comparison.literature_and_design_usd_equivalent_upper,
  ) && Number.isFinite(
    costs.comparison.scientific_execution_cash_usd_upper,
  ), "cost comparison is incomplete");

  const value = evidence.decision_value;
  for (const field of [
    "uncertainty",
    "decision_purchased",
    "go_action",
    "no_go_action",
    "inconclusive_action",
    "null_result_value",
  ]) {
    assert(nonEmpty(value?.[field]), `decision value ${field} is missing`);
  }
  assert(Array.isArray(value.claims_not_supported) &&
    value.claims_not_supported.length > 0 &&
    value.claims_not_supported.every(nonEmpty),
  "unsupported-claim boundary is missing");
  assert(Array.isArray(value.downstream_effects) &&
    value.downstream_effects.length > 0 &&
    value.downstream_effects.every(nonEmpty),
  "downstream decision effects are missing");

  assert(Array.isArray(evidence.alternatives) &&
    evidence.alternatives.length >= 2, "cheaper alternatives are missing");
  for (const alternative of evidence.alternatives) {
    assert(nonEmpty(alternative.id) && nonEmpty(alternative.description) &&
      nonEmpty(alternative.information_gained) &&
      nonEmpty(alternative.reason_not_sufficient_alone),
    "alternative evidence path is incomplete");
  }

  const gate = evidence.authorization_gate;
  for (const name of [
    "literature_list_present",
    "literature_review_complete",
    "literature_recommendation_resolved",
    "cost_projection_complete",
    "decision_value_review_complete",
    "human_approval_observed",
    "ready_for_experiment_authorization",
  ]) {
    assert(typeof gate?.[name] === "boolean",
      `authorization gate ${name} is not boolean`);
  }
  assert(typeof gate.recommendation_resolution === "string",
    "literature recommendation resolution record is missing");
  if (gate.literature_recommendation_resolved) {
    assert(nonEmpty(gate.recommendation_resolution),
      "resolved literature recommendation lacks a resolution record");
  } else {
    assert(gate.recommendation_resolution === "",
      "unresolved literature recommendation claims a resolution");
  }
  assert(gate.literature_list_present === true,
    "literature list is not registered");
  const fullTextCount = (review?.works ?? []).filter(
    (work) => work.review_status === "full_text_reviewed",
  ).length;
  const registeredById = new Map(
    literature.works.map((work) => [work.id, work]),
  );
  const limitingCount = (review?.works ?? []).filter(
    (work) => ["limiting", "counterevidence"].includes(
      registeredById.get(work.id)?.stance,
    ),
  ).length;
  const literatureComplete =
    literature.status === "review_complete" &&
    fullTextCount >= requirements.minimum_full_text_reviews &&
    limitingCount >= requirements.minimum_limiting_or_counterevidence;
  assert(gate.literature_review_complete === literatureComplete,
    "literature completion gate disagrees with the review record");
  if (review?.synthesis.recommendation === "run") {
    assert(gate.literature_recommendation_resolved === true,
      "run recommendation is not marked resolved");
  }
  if (review?.synthesis.recommendation === "revise") {
    assert(gate.literature_recommendation_resolved
      ? evidence.status !== "design_revision_required"
      : evidence.status === "design_revision_required",
    "unresolved revision has the wrong evidence status");
  }
  if (review?.synthesis.recommendation === "abandon") {
    assert(gate.literature_recommendation_resolved === false,
      "abandon recommendation cannot open experiment authorization");
  }
  const ready = literatureComplete &&
    gate.literature_recommendation_resolved &&
    gate.cost_projection_complete &&
    gate.decision_value_review_complete &&
    gate.human_approval_observed;
  assert(gate.ready_for_experiment_authorization === ready,
    "authorization readiness is not the conjunction of evidence gates");
  if (ready) {
    assert(evidence.status === "ready_for_authorization",
      "ready evidence has the wrong status");
  } else {
    assert(nonEmpty(gate.block_reason),
      "incomplete evidence lacks a block reason");
    assert(evidence.status !== "ready_for_authorization",
      "incomplete evidence claims authorization readiness");
  }
  if (requireReady) {
    assert(ready, `experiment evidence is not authorization-ready: ${
      gate.block_reason}`);
  }
  return true;
}

function selfTest() {
  const path = new URL(
    "../benchmarks/zero4-q27-v1/EVIDENCE.json",
    import.meta.url,
  );
  const valid = JSON.parse(fs.readFileSync(path, "utf8"));
  validateExperimentEvidence(valid, {
    evidencePath: fileURLToPath(path),
  });
  const mutations = [
    ["empty literature", (copy) => { copy.literature.works = []; }],
    ["no counterevidence", (copy) => {
      for (const work of copy.literature.works) work.stance = "supporting";
    }],
    ["missing design cost", (copy) => { copy.costs.phases.splice(1, 1); }],
    ["false readiness", (copy) => {
      copy.authorization_gate.ready_for_experiment_authorization = true;
    }],
    ["false recommendation resolution", (copy) => {
      copy.authorization_gate.literature_recommendation_resolved = true;
      copy.authorization_gate.recommendation_resolution =
        "Claimed complete without revising the evidence status.";
    }],
    ["review hash drift", (copy) => {
      copy.literature.review_artifact.sha256 = "0".repeat(64);
    }],
  ];
  for (const [name, mutate] of mutations) {
    const copy = structuredClone(valid);
    mutate(copy);
    let rejected = false;
    try {
      validateExperimentEvidence(copy, {
        evidencePath: fileURLToPath(path),
      });
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
  let blocked = false;
  try {
    validateExperimentEvidence(valid, {
      requireReady: true,
      evidencePath: fileURLToPath(path),
    });
  } catch {
    blocked = true;
  }
  assert(blocked, "self-test evidence unexpectedly opened authorization");
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log("experiment evidence self-test passed");
  } else {
    const evidencePath = process.argv[2];
    if (!evidencePath) {
      fail("usage: check_experiment_evidence.mjs EVIDENCE.json [--require-ready]");
    }
    validateExperimentEvidence(
      JSON.parse(fs.readFileSync(evidencePath, "utf8")),
      {
        requireReady: process.argv.includes("--require-ready"),
        evidencePath,
      },
    );
    console.log("experiment evidence passed");
  }
}
