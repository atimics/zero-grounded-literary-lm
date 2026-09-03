# HT1 implementation review

The HT1 trainer and depth scorer are ready for review. This record follows the
original preregistration in `contract.json` and `SPEC.md`. Those files keep the
design as it stood at registration. `implementation.json` records this stage.

## Model

The trainer includes the frozen C5.1 model source. It builds the recursive mean
for each merge in vocabulary order. One depth gate scales each token's mean.
Input lookup and output scoring share the resulting table. Backward flow adds
the direct embedding gradient, the gate gradient, and each child gradient.
Repeated children receive both contributions.

The full model has 4,852,992 base parameters and 249 gates. Gates start at zero.
Gate creation preserves the random state. Gates use the existing AdamW update
and global gradient clipping. Their weight decay is zero. Slots for unused
depths keep their initial zero value.

The grouped training path uses the existing C5.1 worker pool, masks, pack order,
answer weights, dropout order, and warmup/cosine schedule. The checkpoint stores
the ordinary model and appends the gate weights and AdamW state. It stores the
random state, group cursor, validation selection, and run hash in the existing
header. Each save uses the existing atomic replacement path.

## Checks

Run `make zero5-ht1-mergetree-check`. It uses small synthetic inputs.

- Ten fixed-zero-gate updates match the base model's outputs and loss.
- Grouped runs match every shared weight and AdamW tensor with one and two workers.
- Random state, group cursor, and validation selection match the control.
- Learned gates receive a gradient at zero and change during training.
- Numerical gradient checks cover gates, ordinary embeddings, and merge descendants.
- Repeated-child gradients and future-token causality pass.
- A four-update save followed by six updates matches an uninterrupted run exactly.
- The byte tokenizer round trip covers all 256 byte values and UTF-8 text.
- Depth counts cover masked targets, structural targets, and repeated children.
- Gate tests cover task loss, retention, compute, wall time, and sealed-test state.

## Evaluation

`--depth-eval` scores every active validation target once. It assigns targets to
depth 0, depth 1, or depth 2+. Structural tokens contribute loss and zero raw
bytes. Escaped byte tokens contribute one raw byte. Padding follows the stored
target mask. Byte lengths add through the merge tree. Loss uses the existing
probability floor of `1e-20`.

`scripts/evaluate_zero5_ht1_mergetree.mjs` checks the frozen tokenizer, validation
packs, C5.1 private result, and selected control checkpoint hashes. It scores both
checkpoints on the same depth surface. It can combine those scores with a
checkpoint-bound task report from the existing C5.1 evaluator. Cloze preservation
uses the existing top-1 token accuracy. The existing exact-match score remains
available in that task report.

Example, with private artifact paths supplied by the operator:

```sh
node scripts/evaluate_zero5_ht1_mergetree.mjs \
  --checkpoint HT1_SELECTED_CHECKPOINT \
  --control-checkpoint C51_SELECTED_CHECKPOINT \
  --control-result C51_PRIVATE_RESULT \
  --tokenizer FROZEN_TOKENIZER \
  --validation FROZEN_VALIDATION_PACKS \
  --candidate-tasks C51_EVALUATOR_REPORT \
  --evidence HT1_PREFLIGHT_EVIDENCE \
  --out PRIVATE_HT1_REPORT
```

## Next review

The synthetic checks establish implementation mechanics. The next stage runs the
ten-update comparison from the actual C2 checkpoint and C5.1 packs. It also needs
a measured operation-count and wall-time proof on a matched machine. Both ratios
must meet the frozen 1.03 limit.

`scripts/preflight_zero5_ht1_mergetree.mjs` runs that stage. It verifies the
frozen hashes before execution. It writes separate base and gate-off HT1
checkpoints after ten updates, then compares every shared weight, optimizer
slot, random-state field, and schedule field. The HT1 identity evaluator hashes
every selected validation probability and loss bit from both checkpoints. The
runner also checks the actual tokenizer round trip.

Resource evidence uses three paired timing trials after a warmup on the frozen
C5.1 backend and thread count. Trials alternate arm order. The operation ratio
uses the executed pack-group shapes. It counts the base dense matrix operations
and every added MergeTree scalar operation. Other base operations stay outside
the denominator, which makes the ratio conservative.

The committed `zero.ht1_preflight_evidence.v1` record binds the initial model,
training and validation packs, tokenizer, both diagnostic checkpoints, both
trainers, and the shared-state digest. Its mechanics section contains the six
boolean checks and the ten-update count. Its resource section contains the
compute and wall-time ratios. Its test section contains the six sealed-test
fields. The later evaluator binds the selected control and pilot checkpoints
separately.

The actual artifact preflight passed on Apple M4 Max with the frozen four-thread
Accelerate backend. All shared training state and the validation identity digest
matched. The conservative operation ratio was `1.00005011948993`. The median
wall-time ratio was `0.8879536174606378` across three paired trials. Both pass
the registered `1.03` limits.

The series launcher keeps its separate run-authorization boundary. A reviewed
preflight record, a bound launch path, and one-run authority precede the seed-0
pilot. The experiment run count remains zero. Training, replication, promotion,
publication, and sealed-test access remain unauthorized.
