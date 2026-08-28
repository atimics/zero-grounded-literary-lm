# ZERO.5 C4.3 preparation tooling

This directory is blocked while Braid prepares the governed C4.3 corpus. The
tools here make the handoff deterministic without authorizing training, paid
compute, promotion, or sealed-test access.

## Release intake

After Braid provides its release report and ZERO produces two independent
imports, run:

```bash
node scripts/check_zero5_c43_release.mjs \
  --report /absolute/path/to/c43-release/report.json \
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

The required Braid report shape is defined by
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
  --report /absolute/path/to/c43-release/report.json \
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

This tool selects already completed pilot results. The exact training command
cannot be frozen until Braid supplies the real pack plan and development
artifact.

## Contract candidate

After pilot selection, build a still-blocked contract candidate:

```bash
node scripts/build_zero5_c43_contract_candidate.mjs \
  --report /absolute/path/to/c43-release/report.json \
  --import-a /absolute/path/to/import-a.json \
  --import-b /absolute/path/to/import-b.json \
  --pilot-selection /absolute/path/to/pilot-selection.json \
  --out /absolute/path/to/contract-candidate.json
```

The generated candidate binds the release, both imports, selected weights,
fixed model, C2 initialization, C4.2 validation identities, corrected gates,
and sealed-test policy. It remains unauthorized with no cost ceiling. A later
PR must freeze implementation and runtime hashes and record an explicit paid
compute approval before launch.

## Local verification

Run all proposal and synthetic failure-path checks with:

```bash
make zero5-c43-prep-check
```
