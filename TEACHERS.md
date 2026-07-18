# ZERO.4 Teacher Stable

Status: frozen weight artifacts and evaluation record, 2026-07-16.

ZERO.4 has exactly three teacher models. Faculty subjects such as logic,
geometry, physics, and art are channels with checked corpora; they are not new
teacher checkpoints. A channel may consult an eligible mixture of the same
three frozen functions.

| Teacher | Immutable artifact | Source update | Faculty role |
| --- | --- | ---: | --- |
| ZERO.1 | `teachers/zero1-foundation.teacher` | 20,000 | narrow foundation constraint through the existing vocabulary adapter |
| ZERO.2 | `teachers/zero2-literary.teacher` | 12,600 | literary/history specialist and pre-ZERO.3 anchor |
| ZERO.3 | `teachers/zero3-balanced-final.teacher` | 16,600 | strongest generalist, channel participant, and ZERO.4 initialization |

The exact artifact hashes, source records, and evaluations are in
`teachers/registry.json`. Binary teacher artifacts are intentionally ignored by
Git and must be restored by their recorded SHA-256 identity.

## Why ZERO.3-final is promoted

On the frozen 48-batch matched validation, ZERO.3-final scored `1.7424`, nearly
identical to the earlier ZERO.3 best checkpoint at `1.7415`, and materially
better than ZERO.2 at `1.8325`. It beat ZERO.2 on every measured source. On the
channel benchmark it retained `13/18` transcript and recovered `18/24`
recurrent decisions, with better mean positive bits and margin than both
ZERO.2 and ZERO.3-best.

ZERO.3-best remains a diagnostic comparison, not a fourth teacher. The final
checkpoint is a better multi-objective faculty function because it recovers
recurrent channel behavior without a meaningful aggregate validation loss.

## Artifact safety

`ZEROTCH1` artifacts contain architecture, provenance update, and model weights
only. They have no AdamW moments and no RNG state. The training binary accepts
them through:

```text
zero_lm --load FILE  sample the actual frozen ZERO.1 artifact
--teacher FILE  frozen distillation function
--init FILE     initial weights with a fresh optimizer and seeded RNG
--eval-only     validation without an update or save
```

`--resume` remains reserved for deliberate continuation of a resumable
checkpoint. It must not be used to initialize ZERO.4.

During the results audit, an earlier zero-learning-rate validation workaround
advanced the metadata and optimizer/RNG state of the three inspected full
checkpoints. Comparison of pre- and post-probe quantized exports found exactly
one differing header byte and byte-identical quantized weights. The frozen
teacher artifacts reproduce the pre-probe export hashes exactly. The inspected
full checkpoints are therefore valid weight sources but are marked unsafe for
training resume.

## ZERO.4 launch gate

Do not start the shared student merely because teacher files exist. Launch only
after all of the following are frozen:

1. channel record and atomic switch fixtures;
2. train/validation/promotion splits by latent object before surface creation;
3. independent checkers for quantity, logic, and geometry plus the bounded
   physics simulator and art scene-constraint checker;
4. the teacher-by-channel competence matrix and hard-only ablations;
5. channel loss weights, with unsupported teacher mass returned to hard data;
6. three seeds and the best/final/quantized reporting contract.

The first runnable ZERO.4 experiment should cover foundation, literary,
participation, logic, quantity, and geometry. Physics follows after units and
geometry transfer pass. Art enters first as symbolic scene composition and
constraint-grounded critique; human preference is a separately attributable
layer.

## Router v2 implementation

The trainer now loads both frozen same-architecture teachers alongside the
ZERO.1 adapter. Repeatable `--teacher` options bind ZERO.2 and ZERO.3, while a
per-source `--distill ZERO1,ZERO2,ZERO3` route controls eligibility and weight.
Structured `@tags` and executable `@request` spans always receive hard loss;
teacher probabilities can regularize only eligible semantic content spans.

ZERO.4-Q2 exercised all three artifacts without changing their recorded
hashes. ZERO.1 was limited to foundation replay, ZERO.2 to literary replay,
and ZERO.3 to compatible replay plus student initialization. Quantity requests
were hard-only and the kernel was not counted as a fourth teacher. The seed-1
router passed operation selection but the student failed numeric argument
copying, so no updated teacher checkpoint was created.

ZERO.4-Q2.1 kept the same routing and hashes, then narrowed the neural contract
to operation selection while the controller bound source arguments. Seed 1
passed all gates. Seed 2 reached 500/500 exact operation requests, controller
bindings, kernel calculations, and committed artifacts, but replay regressed
2.011% against the fixed 2.000% ceiling. The aggregate is therefore a no-go;
seed 3 was not run and no teacher or default-model artifact was changed.

ZERO.4-Q2.2 added joint quantity/replay checkpoint selection without changing
the model, teachers, or router. Its first seed-2 replay evaluation was invalid
because the adapter restored a 2x foundation sampling weight; that result is
quarantined and is not evidence about the student. Under the corrected
equal-source replay functional, retained updates 300 and 400 were jointly
feasible.

ZERO.4-Q2.2-R repaired those branches with replay only and fresh optimizer/RNG
state. Seed 2 selected source update 400 plus 100 repair updates, then passed
the one-time promotion evaluation at 488/500 exact operation requests and
commits, zero rejected-state mutations, and 1.919% replay regression. This is a
seed-level go only. Seeds 1 and 3 remain required; no teacher, browser model, or
promoted ZERO.4 artifact changed.

## Restoring ignored artifacts

The registry hashes identify artifacts but the repository does not provide a
public download location. CI and AWS training restore them from the private,
versioned project artifact store at
`s3://$AWS_BUCKET/assets/teachers/`. Commands requiring `teachers/*.teacher`
or historical `.ckpt` files are reproducible only after the binaries have been
restored and verified with:

```sh
shasum -a 256 teachers/*.teacher
```

Compare the resulting identities with `teachers/registry.json` before training.
A matching hash authorizes weight initialization or teacher evaluation; it does
not make a full historical checkpoint safe for `--resume`.

The standard automated check is:

```sh
python3 scripts/verify_teacher_artifacts.py
```

Ordinary pull-request CI validates only the committed registry metadata.
Artifact-dependent smoke testing is a manual workflow-dispatch job that first
restores the private assets and then compares two complete smoke checkpoints
byte for byte.
