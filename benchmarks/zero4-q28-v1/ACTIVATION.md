# Q2.8 fixed graded-plasticity pilot activation

This activation implements the preregistered 200-update diagnostic without
authorizing a run. It is bound to audited merge
`ea5242d0f65dd1e604c553a4d9aca9856347757e` and fixed profile SHA-256
`de858b2cddc21cacb25a831e63ab30eba2e4ea9e944b3010d8ba6759653a0e4e`.

## Mechanics

The pilot starts from the immutable ZERO.3 teacher with fresh AdamW moments.
Its data paths, seed, update ceiling, batch size, learning rate, weight decay,
gradient clip, and measurement cadence are compile-time constants. The binary
accepts output paths and an authorization-record digest; it accepts no model,
training-data, profile, seed, step-count, resume, evaluation, language-gate, or
promotion override.

Every update averages two deterministic seed-2 quantity samples. The replay
gradient averages one deterministic sample from each of the six frozen replay
training ranges. AdamW first proposes the complete displacement, including
weight decay. The immutable coefficient for each parameter group scales that
complete displacement, after which the profile-weighted replay projection
removes positive first-order replay drift. AdamW moments produced by the update
are retained, but only inside this one fixed-profile trajectory.

Checkpoints and measurements are produced only at updates 0, 100, and 200. The
route has no resume mode, so it cannot turn the diagnostic into an unbounded or
adaptively extended training program.

## Prospective candidate selection

Checkpoint selection sees only four fixed samples from the quantity training
range and from each replay training range. Updates 100 and 200 are eligible if:

- quantity training loss improves by at least 0.5% relative to update 0; and
- replay training loss regresses by no more than 2% relative to update 0.

Eligible checkpoints are ranked by largest quantity improvement, then lowest
replay loss, then earliest update. That ranking freezes at most one candidate.
Public quantity rows, promotion rows, BLiMP, TinyStories, and language metrics
cannot select the checkpoint.

The activation driver stops after writing a frozen-candidate or no-go result.
It never executes the conditional language gate and never promotes a model.

## Authorization boundary

Issue #74 authorizes this implementation and its regression tests only. The
tracked budget remains explicitly unauthorized, with zero executable update
and dollar caps. The driver requires a separate one-execution authorization
record that binds:

- the exact merged activation commit;
- the exact profile SHA-256;
- the 200-update ceiling;
- the $0.50 quantity-compute ceiling; and
- the conditional $0.12 language-gate ceiling.

The quantity pilot and conditional language gate are separate stages. Even an
authorized quantity run cannot execute the language gate itself. A candidate
must first be frozen and satisfy the preregistered criteria; promotion remains
forbidden.
