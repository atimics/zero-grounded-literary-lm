#!/usr/bin/env node

import fs from "node:fs";
import { pathToFileURL } from "node:url";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function stringList(value, name, { allowEmpty = false } = {}) {
  assert(Array.isArray(value) && (allowEmpty || value.length > 0) &&
    value.every(nonEmpty), `${name} must be a string list`);
}

export function validateLiteratureReview(
  review,
  evidence,
  { requireComplete = true } = {},
) {
  assert(review?.schema === "zero.literature_review_result.v1",
    "unsupported literature review schema");
  assert(review.experiment_id === evidence?.experiment_id,
    "literature review belongs to another experiment");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(review.reviewed_at),
    "literature review date is invalid");
  assert(["complete", "blocked"].includes(review.status),
    "literature review status is invalid");
  assert(typeof review.block_reason === "string",
    "literature review block reason is missing");

  const agent = review.agent;
  assert(agent?.model === "gpt-5.6-terra",
    "literature review must use the bounded Terra model");
  assert(agent.reasoning_effort === "medium",
    "literature review reasoning effort drifted");
  assert(agent.subagents_allowed === false,
    "literature review unexpectedly allows subagents");
  assert(agent.max_primary_sources === 5,
    "literature review source cap drifted");
  assert(agent.projected_credit_cap === 30,
    "literature review projected credit cap drifted");
  assert(agent.actual_usage_available === false &&
    agent.actual_credits === null,
  "unavailable agent usage must not be fabricated");
  if (agent.observed_total_tokens === null) {
    assert(agent.credit_bounds === null,
      "credit bounds require observed total tokens");
  } else {
    assert(Number.isInteger(agent.observed_total_tokens) &&
      agent.observed_total_tokens > 0,
    "observed total tokens are invalid");
    assert(agent.credit_bounds &&
      Number.isFinite(agent.credit_bounds.lower) &&
      Number.isFinite(agent.credit_bounds.upper) &&
      agent.credit_bounds.lower >= 0 &&
      agent.credit_bounds.upper >= agent.credit_bounds.lower &&
      nonEmpty(agent.credit_bounds.basis),
    "observed token credit bounds are invalid");
    assert(agent.credit_bounds.upper <= agent.projected_credit_cap,
      "observed token upper credit bound exceeded the projected cap");
  }

  assert(review.method?.primary_sources_only === true,
    "literature review admits non-primary evidence");
  stringList(review.method.questions_addressed,
    "literature questions addressed");
  stringList(review.method.search_limitations,
    "literature search limitations", { allowEmpty: true });

  assert(Array.isArray(review.works) && review.works.length <=
    agent.max_primary_sources, "literature review exceeded its source cap");
  const registered = new Map(
    evidence.literature.works.map((work) => [work.id, work]),
  );
  const ids = new Set();
  for (const work of review.works) {
    assert(nonEmpty(work.id) && registered.has(work.id) && !ids.has(work.id),
      "reviewed work is unregistered or duplicated");
    ids.add(work.id);
    assert(/^https:\/\//.test(work.access_url),
      `${work.id} access URL is invalid`);
    assert(work.primary_source_verified === true,
      `${work.id} was not verified against a primary source`);
    assert(work.review_status === "full_text_reviewed",
      `${work.id} was not reviewed in full text`);
    assert(nonEmpty(work.locator), `${work.id} lacks a source locator`);
    stringList(work.supports, `${work.id} supporting findings`);
    stringList(work.limitations, `${work.id} limitations`);
    assert(nonEmpty(work.design_consequence),
      `${work.id} design consequence is missing`);
    assert(["high", "medium", "low"].includes(work.confidence),
      `${work.id} confidence is invalid`);
  }

  const synthesis = review.synthesis;
  assert(["supports", "mixed", "challenges"].includes(
    synthesis?.overall_assessment,
  ), "literature synthesis assessment is invalid");
  stringList(synthesis.findings, "literature synthesis findings");
  stringList(synthesis.design_changes, "literature design changes",
    { allowEmpty: true });
  stringList(synthesis.unresolved_questions,
    "literature unresolved questions");
  assert(["run", "revise", "abandon"].includes(synthesis.recommendation),
    "literature recommendation is invalid");
  assert(nonEmpty(synthesis.recommendation_rationale) &&
    nonEmpty(synthesis.value_assessment),
  "literature recommendation rationale or value is missing");

  if (review.status === "complete") {
    assert(review.block_reason === "",
      "complete literature review retains a block reason");
    assert(review.works.length >=
      evidence.literature.authorization_requirements
        .minimum_full_text_reviews,
    "literature review has too few full-text sources");
    const limiting = review.works.filter((work) =>
      ["limiting", "counterevidence"].includes(
        registered.get(work.id).stance,
      )).length;
    assert(limiting >= evidence.literature.authorization_requirements
      .minimum_limiting_or_counterevidence,
    "literature review omitted limiting or counterevidence");
  } else {
    assert(nonEmpty(review.block_reason),
      "blocked literature review lacks a reason");
  }
  if (requireComplete) {
    assert(review.status === "complete",
      `literature review is blocked: ${review.block_reason}`);
  }
  return true;
}

function selfTest() {
  const evidence = JSON.parse(fs.readFileSync(
    new URL("../benchmarks/zero4-q27-v1/EVIDENCE.json", import.meta.url),
    "utf8",
  ));
  const selected = [
    "lopez-paz-ranzato-2017-gem",
    "farajtabar-2020-ogd",
    "geva-2021-ffn-memory",
    "meng-2022-rome",
    "liu-niehues-2025-forgetting",
  ];
  const valid = {
    schema: "zero.literature_review_result.v1",
    experiment_id: evidence.experiment_id,
    reviewed_at: "2026-07-26",
    status: "complete",
    block_reason: "",
    agent: {
      model: "gpt-5.6-terra",
      reasoning_effort: "medium",
      subagents_allowed: false,
      max_primary_sources: 5,
      projected_credit_cap: 30,
      actual_credits: null,
      actual_usage_available: false,
      observed_total_tokens: 78046,
      credit_bounds: {
        lower: 0.4877875,
        upper: 29.26725,
        basis: "Terra token-rate bounds",
      },
    },
    method: {
      primary_sources_only: true,
      questions_addressed: ["Does the literature justify Q2.7?"],
      search_limitations: ["Self-test fixture."],
    },
    works: selected.map((id) => ({
      id,
      access_url: evidence.literature.works.find(
        (work) => work.id === id,
      ).url,
      primary_source_verified: true,
      review_status: "full_text_reviewed",
      locator: "abstract and methods",
      supports: ["Relevant mechanism."],
      limitations: ["Different experimental setting."],
      design_consequence: "Retain direct evaluation.",
      confidence: "medium",
    })),
    synthesis: {
      overall_assessment: "mixed",
      findings: ["The premise is plausible but not established."],
      design_changes: ["Clarify the claim."],
      unresolved_questions: ["Will the intervention work at ZERO's scale?"],
      recommendation: "revise",
      recommendation_rationale: "The design needs a narrower claim.",
      value_assessment: "A clean result changes the next roadmap branch.",
    },
  };
  validateLiteratureReview(valid, evidence);
  const mutations = [
    ["source cap", (copy) => { copy.agent.max_primary_sources = 12; }],
    ["missing counterevidence", (copy) => {
      copy.works = copy.works.filter((work) =>
        !["meng-2022-rome", "liu-niehues-2025-forgetting"]
          .includes(work.id));
    }],
    ["fabricated usage", (copy) => {
      copy.agent.actual_usage_available = true;
      copy.agent.actual_credits = 12;
    }],
    ["credit cap", (copy) => {
      copy.agent.credit_bounds.upper = 31;
    }],
  ];
  for (const [name, mutate] of mutations) {
    const copy = structuredClone(valid);
    mutate(copy);
    let rejected = false;
    try {
      validateLiteratureReview(copy, evidence);
    } catch {
      rejected = true;
    }
    assert(rejected, `self-test failed to reject ${name}`);
  }
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  if (process.argv.includes("--self-test")) {
    selfTest();
    console.log("literature review self-test passed");
  } else {
    const [reviewPath, evidencePath] = process.argv.slice(2)
      .filter((arg) => arg !== "--allow-blocked");
    if (!reviewPath || !evidencePath) {
      fail("usage: check_literature_review.mjs REVIEW.json EVIDENCE.json [--allow-blocked]");
    }
    validateLiteratureReview(
      JSON.parse(fs.readFileSync(reviewPath, "utf8")),
      JSON.parse(fs.readFileSync(evidencePath, "utf8")),
      { requireComplete: !process.argv.includes("--allow-blocked") },
    );
    console.log("literature review passed");
  }
}
