# ZERO.5 C4.3 preparation tooling

The governed Braid C4.3 v0.1.1 release is available. These tools verify its
real handoff, build deterministic private packs, and run the development-only
weight pilot. The primary run now has a separate, hash-bound local
authorization. Paid compute, promotion, publication, independent retries, and
sealed-test access remain unauthorized.

## Private import

Run the importer twice into two new directories. It verifies every Braid
artifact, rebuilds the exact grouped packs, copies only the already-frozen C4.2
validation binaries, and refuses any test content:

```bash
node scripts/prepare_zero5_c43.mjs \
  --release /absolute/path/to/c43-release \
  --handoff /absolute/path/to/zero-handoff.json \
  --braid-root /absolute/path/to/braid \
  --c42-import /absolute/path/to/zero5-c42-v1/import-final \
  --tokenizer-tool /absolute/path/to/sero_tokenizer \
  --import-id zero5-c43-private-a \
  --out /private/path/to/import-a
```

Repeat with a distinct import ID and output directory, then use the generated
`release-report.json` and `import.json` files in the intake checker below.

## Release intake

After ZERO produces two independent imports, run:

```bash
node scripts/check_zero5_c43_release.mjs \
  --release /absolute/path/to/c43-release \
  --report /absolute/path/to/import-a/release-report.json \
  --import-a /absolute/path/to/import-a.json \
  --import-b /absolute/path/to/import-b.json
```

The checker fails closed on:

- release, manifest, membership, pack-plan, tokenizer, or artifact drift
- missing marker-free or 512-token declarations
- wrong compute exposure or any data wrap
- insufficient cloze count, share, length reporting, or context recovery
- weak retrieval-negative coverage or a failed answer-only shortcut audit
- missing mirror orientations, position imbalance, or cross-group pairs
- development overlap with train, validation, or test
- incomplete provenance, attribution, rights, or hash records
- nondeterministic imports
- changed validation identities or any test access

The normalized ZERO report shape is defined by
`schemas/zero5-c43-release-report.schema.json` and demonstrated by the
synthetic fixture at `tests/fixtures/zero5-c43-release/report.json`. Import
receipts use `zero.c43_import_receipt.v1`, as shown beside the report. The
manual checker enforces cross-field rules that JSON Schema cannot express,
including totals, ratios, hash verification, deterministic imports, and fixed
validation identity.

## Development-only pilot selection

The pilot trainer will produce one result for each preregistered answer-weight
variant. Select between one or two completed variants with:

```bash
node scripts/select_zero5_c43_pilot.mjs \
  --release /absolute/path/to/c43-release \
  --report /absolute/path/to/import-a/release-report.json \
  --import-a /absolute/path/to/import-a.json \
  --import-b /absolute/path/to/import-b.json \
  --variant /absolute/path/to/pilot-a.json \
  --variant /absolute/path/to/pilot-b.json \
  --out /absolute/path/to/pilot-selection.json
```

The selector accepts only development results with at most 2,800 optimizer
groups. It rejects claim-choice regression, answer weights above 8, weighted
task imbalance above 10%, frozen-validation scoring, test access, or any claim
that a pilot can promote a model. Selection order is cloze exact accuracy,
retrieval choice accuracy, claim choice accuracy, then stable variant ID.

Create each result with `scripts/run_zero5_c43_pilot.mjs`. The runner accepts
only a preregistered Braid variant, starts from the frozen C2 checkpoint, uses
the development pack only, verifies exact zero-wrap accounting, and writes no
promotion claim. Pass `--release` to the selector so it can recheck the source
artifacts.

## Contract candidate

After pilot selection, build a still-blocked contract candidate:

```bash
node scripts/build_zero5_c43_contract_candidate.mjs \
  --release /absolute/path/to/c43-release \
  --report /absolute/path/to/import-a/release-report.json \
  --import-a /absolute/path/to/import-a.json \
  --import-b /absolute/path/to/import-b.json \
  --pilot-selection /absolute/path/to/pilot-selection.json \
  --out /absolute/path/to/contract-candidate.json
```

The generated candidate binds the release, both imports, selected weights,
fixed model, C2 initialization, C4.2 validation identities, corrected gates,
and sealed-test policy. It remains unauthorized with no cost ceiling. A later
PR must freeze implementation and runtime hashes. Paid compute needs a separate
explicit approval before launch.

## Frozen primary contract

The completed intake and pilot are frozen in `contract.json` with hash-only
evidence under `evidence/`. `cloze-plus-five-v1` is the selected answer-weight
variant. The primary run is fixed at 28,707 pair-atomic update groups and
19,337,216 compute-token exposures, starting again from C2.

The local Apple Silicon venue is frozen from the two measured pilot runs. The
slower pilot rate projects about 31.2 minutes for the primary exposure, and the
runner enforces a one-hour hard stop. Authorization
`zero5-c43-local-2026-08-28-v1` permits exactly one primary execution from the
frozen C2 checkpoint with the selected `cloze-plus-five-v1` weights. AWS, paid
compute, promotion, publication, independent retries, and test access remain
unauthorized. Check the authorized contract with:

```bash
make zero5-c43-contract-check
```

The next step is zero-compute local preflight followed by the single authorized
primary execution. Scale remains a fallback only; any later paid venue would
need separate authorization and a cost ceiling.

## Local verification

Run all proposal and synthetic failure-path checks with:

```bash
make zero5-c43-prep-check
```
