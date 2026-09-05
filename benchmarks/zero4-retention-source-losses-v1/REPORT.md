# ZERO.4 retention losses by source

The five-arm runner now keeps each retention source's loss, weight, scored
window count, and change from the initial model. It also records the largest
source regression. This makes a loss increase visible when gains elsewhere
keep the combined mean steady.

The native evaluator writes `zero.literary_eval.v2`. It collects source losses
during the existing forward passes. The controller checks the ordered source
roster, input digests, source kinds, finite losses, weights, window counts, and
agreement with the combined mean. The mean check allows float32 rounding.

The original training guard still uses its historical six-slice mean. Fresh
retention gates and thresholds belong in the next study's frozen manifest.

## Native evidence

Eleven focused tests passed. One fixture keeps the mean at one while a single
source rises from one to two; the recorded worst-source regression is 100%.
Other checks reject partial source lists, altered order or kind, invalid loss,
incorrect coverage, an inconsistent mean, and a mismatched baseline.

A mixed native probe uses foundation, text, and channel inputs with weights
one through six. Each of its six source losses exactly matches a separate
evaluation of that source. Model bytes and learned-state digests remain equal.
Requesting thirteen windows across six sources scores twelve: the existing
balanced sampler takes two per source. The new output records both counts.

The complete five-arm smoke passes 79 native processes. All sixteen scored
training checkpoints remain available, and all four active arms match the
historical trainer's final checkpoint bytes, including optimizer and RNG state.
The 35-check native self-test passes. The earlier toy result remains visible:
5/5 oracle arithmetic, 0/5 correct final artifacts, and inactive projection in
the four-attempt training fixture.

[SMOKE.json](SMOKE.json) binds the nineteen source files at commit
`e294805c233fe0cb95bdf7f5508b8a8cec6bd58a`. Its SHA-256 is
`284d9da82f27e7aad6a867e11813505a4e7854714d4debe8228307a01c4752d9`.
The original `literary_lm.c` and shared `Makefile` retain their earlier digests.
The separately patched trainer has SHA-256
`79d7b277a958ace1b5a952bf4c6a0cd731c2344e17fc67db332d5be571082fba`.

## Failure retained

The first mixed probe used UTF-8 literary files with byte values above the
toy model's 128-token vocabulary. Native validation rejected them before
scoring. [FAILURES.json](FAILURES.json) preserves the failed process and stderr
digests. The corrected fixture uses two fixed ASCII strings. These inputs
serve engineering checks; fresh language evidence remains a separate study.

## Reproduce

```bash
make -f Makefile.zero4-retention LITERARY_BACKEND=portable \
  literary_lm build/literary_retention_lm freeze_literary_teacher \
  export_literary quantity_request_eval
python3 scripts/check_zero4_retention_controls.py --out /tmp/retention-source-smoke
```

Use a new output directory. It keeps the complete process receipts, full
checkpoints, per-source results, mixed-source probe, and separate reference
evaluations. Local timings serve engineering diagnosis. A scientific comparison
still needs frozen fresh cohorts, common machine and cost limits, and its
declared final-answer and retention gates.
