# ZERO.4 retention controls

Question: how much retained capability comes from replay, its acceptance guard,
and projection, at a common compute budget?

This runner prepares the next comparison after the three Q2.6 runs. Those runs
accepted all 1,900 updates at full scale and applied projection on 1,084 trials.
The original records keep their dates, methods, and decisions. This comparison
uses a separately frozen manifest and a common constant learning schedule.

## Arms

| Arm | Training input and update |
| --- | --- |
| Frozen | Evaluate the initial teacher. |
| Task only | Train on the new quantity task. |
| Replay | Mix the task with the six replay sources and their frozen teacher routes. |
| Replay with guard | Add the original cumulative guard and geometric backtracking. |
| Replay with guard and projection | Add the original tangent projection to the guarded arm. |

The last pair isolates projection. Its training arguments differ only in the
transaction mode. The extra guard arm separates the effects of the guard from
those of projection. All replay arms must consume matching training windows
over their common attempt prefix. The native trace records each range, offset,
context length, and token hash, including targets consumed in that window.

## Measurements

The runner starts every arm from the same frozen rotary teacher. Each seed gets
a fresh optimizer and RNG state. Each training arm advances in equal attempt
chunks. Arm order rotates with the seed index. Chunk size, source order,
weights, teacher routes, batch size, learning rate, seeds, and all file hashes
belong in the manifest before a run starts.

Every completed snapshot contains:

- Full-precision native retention loss on six evaluation files.
- Chosen-request and final-artifact counts from the quantity evaluator.
- Controller argument-binding and oracle arithmetic counts as separate fields.
- Source model, quantized model, and learned-state identities.
- Accumulated CPU cost through the completed evaluation.

Native evaluation verifies its learned-state digest before and after scoring.
The controller also verifies the model file remains identical. It keeps each
quantized checkpoint and each evaluation record. The active training checkpoint
holds the current optimizer state; each snapshot records its model digest.

CPU cost includes child user and system CPU, controller work assigned to that
arm, and a full charge for the shared initial file checks. The overall record
also retains actual total child CPU, controller CPU, and elapsed wall time.
The shared setup charge represents the cost each arm would incur as a separate
run; sum the overall fields for the cost of executing the whole comparison.

At each common CPU ceiling, use the latest fully evaluated snapshot whose cost
fits. Snapshot choice depends on cost and attempt order. A point whose completed
cost exceeds the ceiling remains in the record. The child and controller wall
limits bound execution separately from these CPU selection ceilings. A failed
process keeps its command, output, terminal state, and completed CPU work.

## Engineering smoke

The smoke uses a small rotary model with one layer, width eight, and context
256. It initializes the fixture for one update and gives each active arm four
attempts. Its large learning rate exercises backtracking. It repeats a known
text across the six replay slots and uses a different known text for retention.
The task generator uses seed 55321, and training uses seed 71. These fixture
choices serve branch and data-flow checks.

The numerical self-test separately exercises active projection with a forced
conflicting gradient. The native training smoke records whether projection
fires on its actual attempts. Both outcomes remain in the report.

```bash
make LITERARY_BACKEND=portable literary_lm freeze_literary_teacher export_literary quantity_request_eval
python3 scripts/check_zero4_retention_controls.py --out build/zero4-retention-smoke
```

The output directory must be new. It holds the full process records, copied
manifest, checkpoints, sample traces, and compact smoke report. CI runs the same
check on Linux and macOS. Local timing stays in the engineering output; the
committed smoke summary contains behavioral evidence.

## Cloud package still to freeze

The source runner accepts a manifest through:

```bash
python3 scripts/run_zero4_retention_controls.py --manifest MANIFEST.json --root PACKAGE_ROOT --out NEW_OUTPUT
```

The smoke writes a complete example manifest. A prospective manifest needs six
distinct replay files, six separate retention files, and bound fresh-data and
machine records. These bindings support package preparation. A reviewed cloud
receipt establishes the venue and actual machine identity for timing evidence.

Before the scientific run, freeze fresh task and retention cohorts, their
overlap audit, model and teacher lineage, repeated arm order, CPU ceilings,
checkpoint spacing, answer gates, retention threshold, and analysis. Include
the package digest, executable hashes, compiler, instance, worker count,
storage, watchdog, runtime ceiling, and maximum cost. The common question is
the number of correct final artifacts at a given total work budget while
retention stays within its fixed threshold.
