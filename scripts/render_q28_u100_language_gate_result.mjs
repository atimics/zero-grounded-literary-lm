#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const [input, output] = process.argv.slice(2);
assert(input && output, "usage: render_q28_u100_language_gate_result.mjs RESULT OUT");
const result = JSON.parse(fs.readFileSync(input, "utf8"));
assert.equal(result.schema, "zero.language_preservation_gate_result.v1");
assert.equal(result.model.id, "zero4-q28-seed2-u100");
assert.equal(result.training_updates, 0);

const blimp = result.tasks.blimp.metrics;
const tiny = result.tasks.tinystories.metrics;
const decision = result.decision.pass ? "go" : "no-go";
const interpretation = result.decision.pass ?
  "The result supports accumulation or checkpoint selection as a major cause of the update-200 failure." :
  "The result supports a graded-profile language-safety failure already present by update 100.";
const markdown = `# Q2.8 update-100 diagnostic language gate

Decision: **${decision}**

| Screen | Candidate | Frozen threshold | Result |
| --- | ---: | ---: | --- |
| BLiMP raw accuracy | ${blimp.raw_accuracy.toFixed(6)} | ≥ 0.522000 | ${result.decision.checks.blimp_raw_accuracy.pass ? "pass" : "fail"} |
| TinyStories bits/byte | ${tiny.bits_per_byte.toFixed(6)} | ≤ 2.553140 | ${result.decision.checks.tinystories_bits_per_byte.pass ? "pass" : "fail"} |

The gate used the frozen 1,000-case screens with zero training updates.
${interpretation}

This is a mechanism diagnostic only. It cannot revise the final Q2.8 no-go and
does not authorize model promotion or additional training.
`;
fs.writeFileSync(output, markdown);
