#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const [input, output] = process.argv.slice(2);
assert(input && output, "usage: render_q29_language_gate_result.mjs RESULT OUT");
const result = JSON.parse(fs.readFileSync(input, "utf8"));
assert.equal(result.schema, "zero.language_preservation_gate_result.v1");
assert.equal(result.model.id, "zero4-q29-seed2-u50");
assert.equal(result.training_updates, 0);

const blimp = result.tasks.blimp.metrics;
const tiny = result.tasks.tinystories.metrics;
const decision = result.decision.pass ? "go" : "no-go";
const interpretation = result.decision.pass ?
  "The candidate passed both frozen screens. Q2.9 stops here and requires a separate three-seed replication contract; seed 2 is not promoted." :
  "The candidate failed at least one frozen screen. Q2.9 is a no-go; seeds 1 and 3 remain sealed and this profile family is retired.";
const markdown = `# Q2.9 candidate-bound language gate

Decision: **${decision}**

Model SHA-256: \`${result.model.sha256}\`

| Screen | Candidate | Frozen threshold | Result |
| --- | ---: | ---: | --- |
| BLiMP raw accuracy | ${blimp.raw_accuracy.toFixed(6)} | ≥ 0.522000 | ${result.decision.checks.blimp_raw_accuracy.pass ? "pass" : "fail"} |
| TinyStories bits/byte | ${tiny.bits_per_byte.toFixed(6)} | ≤ 2.553140 | ${result.decision.checks.tinystories_bits_per_byte.pass ? "pass" : "fail"} |

The gate used the frozen 1,000-case screens with zero training updates.
${interpretation}

This result does not authorize model promotion, replication, or additional
training.
`;
fs.writeFileSync(output, markdown);
