#!/usr/bin/env node

import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateLiteratureReview } from "./check_literature_review.mjs";

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const args = process.argv.slice(2);
const root = fileURLToPath(new URL("..", import.meta.url));
const evidencePath = path.resolve(root, option(
  args,
  "--evidence",
  "benchmarks/zero4-q27-v1/EVIDENCE.json",
));
const outputPath = path.resolve(root, option(
  args,
  "--output",
  "benchmarks/zero4-q27-v1/LITERATURE-REVIEW.json",
));
const schemaPath = path.resolve(
  root,
  "schemas/literature-review-result.schema.json",
);
const model = option(args, "--model", "gpt-5.6-terra");
const reasoningEffort = option(args, "--reasoning-effort", "medium");

assert(model === "gpt-5.6-terra", "only bounded Terra review is supported");
assert(reasoningEffort === "medium",
  "only medium reasoning effort is supported");
assert(fs.existsSync(evidencePath), "experiment evidence file is missing");
assert(fs.existsSync(schemaPath), "literature review output schema is missing");
assert(!fs.existsSync(outputPath),
  "literature review output already exists; refusing to overwrite evidence");

const CACHED_INPUT_CREDITS_PER_MILLION = 6.25;
const OUTPUT_CREDITS_PER_MILLION = 375;
function recordObservedUsage(review, observedTotalTokens) {
  if (observedTotalTokens === null) {
    review.agent.observed_total_tokens = null;
    review.agent.credit_bounds = null;
    return;
  }
  assert(Number.isInteger(observedTotalTokens) && observedTotalTokens > 0,
    "observed total token count is invalid");
  review.agent.observed_total_tokens = observedTotalTokens;
  review.agent.credit_bounds = {
    lower: observedTotalTokens *
      CACHED_INPUT_CREDITS_PER_MILLION / 1_000_000,
    upper: observedTotalTokens *
      OUTPUT_CREDITS_PER_MILLION / 1_000_000,
    basis: "Bounded from the observed aggregate token count using the GPT-5.6 Terra Codex rates: 6.25 cached-input to 375 output credits per million tokens. Exact credits remain unavailable without the token-type split.",
  };
}

const relativeEvidence = path.relative(root, evidencePath);
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
const packet = {
  schema: "zero.literature_review_packet.v1",
  experiment_id: evidence.experiment_id,
  review_questions: evidence.literature.search_protocol.questions,
  inclusion_criteria: evidence.literature.search_protocol.inclusion_criteria,
  known_gaps: evidence.literature.search_protocol.known_gaps,
  authorization_requirements:
    evidence.literature.authorization_requirements,
  registered_works: evidence.literature.works,
  decision_scope: {
    uncertainty: evidence.decision_value.uncertainty,
    decision_purchased: evidence.decision_value.decision_purchased,
    claims_not_supported: evidence.decision_value.claims_not_supported,
  },
  cost_controls: {
    model,
    reasoning_effort: reasoningEffort,
    subagents_allowed: false,
    max_primary_sources: 5,
    projected_credit_cap: 30,
  },
};
const prompt = `Conduct the bounded literature review in REVIEW-PACKET.json.

Rules:
- Work read-only. The packet is the complete project context available to you.
  Do not seek repository access, edit files, run other agents, or create
  subagents.
- Use only primary papers from the registered literature list.
- Review exactly five decision-critical full texts, including at least one work
  whose registered stance is "limiting" or "counterevidence".
- Open the actual paper or proceedings full text. Do not mark a work
  full_text_reviewed if only an abstract, search result, or secondary summary
  was available.
- Address the registered research questions and record a concrete section,
  page, figure, table, or methods locator for every work.
- Paraphrase findings. Do not include extended quotations.
- Assess whether Q2.7 should run unchanged, be revised before compute, or be
  abandoned. Distinguish literature support from the repository's internal
  Q2.6 trace.
- Treat the cost controls as immutable: model gpt-5.6-terra, medium reasoning,
  no subagents, five primary sources, projected cap 30 credits. The CLI does
  not expose actual task credits here, so set actual_usage_available=false and
  actual_credits=null rather than inventing usage. Also set
  observed_total_tokens=null and credit_bounds=null; the runner populates
  those fields from the CLI transcript after the review.
- If five qualifying full texts cannot be accessed, return status="blocked",
  explain why in block_reason, and report only sources actually reviewed.
- Return only the JSON object required by the supplied output schema.`;

if (args.includes("--print-prompt")) {
  process.stdout.write(`${prompt}\n\nPacket source: ${relativeEvidence}\n`);
  process.exit(0);
}
if (args.includes("--print-packet")) {
  process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  process.exit(0);
}

const allowedEnvironment = {};
for (const name of ["PATH", "LANG", "LC_ALL", "TERM", "TMPDIR"]) {
  if (process.env[name] !== undefined) {
    allowedEnvironment[name] = process.env[name];
  }
}
const temporaryRoot = fs.mkdtempSync(path.join(
  os.tmpdir(),
  "zero-literature-review-",
));
assert(temporaryRoot.startsWith(os.tmpdir()),
  "temporary review directory escaped the system temp root");
const packetPath = path.join(temporaryRoot, "REVIEW-PACKET.json");
const isolatedSchemaPath = path.join(
  temporaryRoot,
  "literature-review-result.schema.json",
);
const isolatedOutputPath = path.join(
  temporaryRoot,
  "LITERATURE-REVIEW.json",
);
try {
  fs.writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, {
    flag: "wx",
  });
  fs.copyFileSync(schemaPath, isolatedSchemaPath,
    fs.constants.COPYFILE_EXCL);
  const codex = childProcess.spawn(
    "codex",
    [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--cd",
      temporaryRoot,
      "--model",
      model,
      "--config",
      `model_reasoning_effort="${reasoningEffort}"`,
      "--output-schema",
      isolatedSchemaPath,
      "--output-last-message",
      isolatedOutputPath,
      "--color",
      "never",
      prompt,
    ],
    {
      cwd: temporaryRoot,
      env: allowedEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let transcript = "";
  for (const stream of [codex.stdout, codex.stderr]) {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      transcript += text;
      process.stderr.write(text);
    });
  }
  const status = await new Promise((resolve, reject) => {
    codex.on("error", reject);
    codex.on("close", resolve);
  });
  assert(status === 0, `literature review agent exited ${status}`);
  const review = JSON.parse(fs.readFileSync(isolatedOutputPath, "utf8"));
  const usageMatches = [
    ...transcript.matchAll(/tokens used\s+([\d,]+)/g),
  ];
  const observedTotalTokens = usageMatches.length === 0
    ? null
    : Number(usageMatches.at(-1)[1].replaceAll(",", ""));
  recordObservedUsage(review, observedTotalTokens);
  validateLiteratureReview(review, evidence, { requireComplete: false });
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(review, null, 2)}\n`,
    { flag: "wx" },
  );
  console.log(`literature review artifact written: ${outputPath}`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
