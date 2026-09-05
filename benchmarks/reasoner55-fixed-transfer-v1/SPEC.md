# Reasoner 5.5 fixed transfer and timing benchmark

This design is fixed before generating or measuring the new targets. It tests
the model from PR #233 on fresh behavior and composition, with repeated timing
in balanced process orders. This is a separate, public benchmark.

## Fixed model and references

Use main commit `ade43d3a2be97316d26183851eead7207d7eeb0a` as the reference.
Load the existing 1,863-byte `reasoner55-semantic-guide-v1/MODEL.hex` artifact.
Its SHA-256 is
`db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a`.
Both sets of four weights and the original source counts stay fixed. Reproduce
source training separately to report its time and confirm the same model.

Preserve the original affine domain, eight operation roles, four-step program
space, one public example, 32 adapter queries, exact 125-input verifier,
64 proposals, injected wrong candidate, canonical fallback, and 4,096-check cap.

## New families

Generate 128 target families, 32 in each cell of two crossed factors:

| Operations | Composition |
| --- | --- |
| Original operation sampler | Four distinct roles |
| Original operation sampler | Alternating roles, A B A B |
| Dense mixing operations | Four distinct roles |
| Dense mixing operations | Alternating roles, A B A B |

Number cells 0 through 3 in table order and families 0 through 127. Start with
`r55_generate_family`, generator 0, root `0x5533667265736831`, the global family
ordinal, and nonce 0. Increase the nonce until the rules below hold; cap attempts
at 65,536 per family. Record the accepted nonce and every rejection reason.

For cells 2 and 3, replace roles 6 and 7 with random invertible 3-by-3 matrices
whose nine entries are in 1 through 4. Use the existing RNG with the family seed
and stream `0x64656e73652d7631 + role`. Draw row-major entries and reject zero
determinants modulo five, with a 1,024-attempt limit. Role 6 has zero bias.
Role 7 then draws three bias entries in 1 through 4. These matrices have nine
nonzero entries; the original mixing sampler has four.

Draw a role permutation by the existing descending Fisher-Yates algorithm,
using the family seed and stream `0x636f6d702d763031`. Use its first four roles
for distinct compositions, or its first two as A B A B. Require a mixing role
(6 or 7) in the chosen sequence. Recompute the target and example output.

Reject a sequence if it exactly solves any of the 128 original source tasks,
or equals an intended sequence from the 136 original source and development
families. Reject a target behavior already present among those 136 families
or an earlier accepted new family. Also require a new complete set of eight
operation maps relative to the original and earlier accepted families.
These are the complete selection rules; selection is independent of search
cost and model scores. Repeated sequences across new operation sets are valid.

Report the true shortest solution length from 0 through 4 by exhaustive
enumeration. This describes difficulty separately from the generating sequence.
Keep the original development outcomes as their own records.

## Comparisons

Run six arms in this order: `target_only`, `source_free_jit`,
`semantic_frequency`, `task_guide`, `raw_lexical_task_guide`, and
`task_without_prior_feature`. Use both fixed source guides and both original
tie repeats for each target. This gives 512 episodes per arm and 3,072 rows.
The main reference is `source_free_jit`. The grouped frequency arm is also the
complete source-removal path. Preserve the original implementations and costs.

Independently reproduce family generation, selection, minimum lengths, model
bytes, candidate features and order, exact outcomes, counts, and fallback.
Verify every operation reconstruction and all program maps and prefix features.

## Timing and memory

Use 12 measured passes. In pass p, rotate the six-arm list left by p modulo 6;
reverse the rotated list for passes 6 through 11. Each arm occupies each process
position twice. Every arm starts in a fresh process. Within pass p, shuffle the
512 episode indexes using the existing RNG, seed `0x74696d652d763031` and stream
p. Use this same episode order for every arm in that pass.

Each process loads the fixed model and generates the fixed corpus. Report
those preparation times separately. Warm up every episode once, then measure
one full pass. Include public episode setup, allocation, adapter work, local
guide construction, enumeration, scoring, sorting, all existing audit hashes,
verification, fallback, and release. JSON output and benchmark corpus generation
are outside episode time. Record CPU and elapsed time per episode, native stage
times where available, process peak RSS, process order, host, build flags, and
binary digest. Peak RSS includes preparation and warmup.

The original guide and grouped guide produce different audit records. Report
their actual full pipeline cost and the grouped guide's audit stage explicitly.
Training uses three separate processes and reports median CPU and elapsed time.
Report model loading and the number of tasks needed to repay training and setup
when a positive measured saving exists. Source-free arms have zero model size,
model-loading cost, and training charge.

## Analysis and decision

Take the median of 12 timing samples per episode. Average paired log cost ratios
over the four source/tie settings within a target. Weight the 128 targets equally.
Use `(checks + 1)` for verification ratios; use measured positive costs for CPU
and elapsed ratios. Report every target, cell, and source-guide view.

Use 5,000 stratified bootstrap draws: sample 32 target families with replacement
within each cell and keep their repeated settings together. Use the existing RNG,
seed `0x626f6f742d763031` and stream 0. Report the 2.5th, 95th, and 97.5th percentile
ratios using the nearest-rank rule. Timing uncertainty across passes is reported
separately from uncertainty across families.

The fixed-cohort cost rule requires every answer to be exact and the task guide's
one-sided 95% upper ratios for CPU, elapsed time, and verifier checks to be below
1 against the original local guide. Report the lexical control alongside this
rule when interpreting semantic role transfer. This rule supports a conclusion
about the declared benchmark distribution. Record the outcome and all costs
whether the guide meets it or requires further research.
