#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const [input, output] = process.argv.slice(2);
assert(input && output, "usage: render_q28_language_gate_result.mjs RESULT OUT");
const result = JSON.parse(fs.readFileSync(input, "utf8"));
assert.equal(result.schema, "zero.language_preservation_gate_result.v1");
assert.equal(result.model.id, "zero4-q28-seed2-u200");
assert.equal(result.training_updates, 0);

const blimp = result.tasks.blimp.metrics;
const tiny = result.tasks.tinystories.metrics;
const decision = result.decision.pass ? "PASS" : "FAIL";
const markdown = `# Q2.8 candidate-bound language gate

Decision: **${decision}**

| Screen | Candidate | Frozen threshold | Result |
| --- | ---: | ---: | --- |
| BLiMP raw accuracy | ${blimp.raw_accuracy.toFixed(6)} | ≥ 0.522000 | ${result.decision.checks.blimp_raw_accuracy.pass ? "pass" : "fail"} |
| TinyStories bits/byte | ${tiny.bits_per_byte.toFixed(6)} | ≤ 2.553140 | ${result.decision.checks.tinystories_bits_per_byte.pass ? "pass" : "fail"} |

The gate used the frozen 1,000-case screens with zero training updates. This is
a bounded preservation result, not evidence of general language capability or
authorization to promote the candidate.
`;
fs.writeFileSync(output, markdown);
