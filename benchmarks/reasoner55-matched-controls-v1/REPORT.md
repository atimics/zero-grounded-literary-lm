# Matched controls: runner preparation

The new runner puts all six Reasoner 5.5 arms on one executable with the faster
hash and sort implementation. It generates new target behaviors and primitive
sets, preserves the fixed guide, and records every warmup and measured search.

The local check passed on four families with all four source/tie views:

- 384 native episodes across six arms and two implementations, including warmup.
- Exact agreement between the plain and fast search receipts for every arm.
- 96 measured rows replayed by the independent JavaScript search implementation.
- Independent reconstruction of the family seed, maps, composition, and example.
- Exclusion checks against the 136 source/development families and the earlier
  128-family public cohort.
- Tests that preserve partial output after an injected exit, timeout, or missing
  model, plus tests that reject changed rows, ordering, timing, and identities.

The [smoke record](SMOKE.json) binds its source files and stable receipts.
It records an engineering check on a separate seed. The cloud seed remains
reserved for the full comparison.

## Question carried forward

The earlier speed study measured task guidance, target-only search, and
source-free guidance. The original pipeline also had lexical and prior-feature
controls. Its task-versus-lexical CPU ratio was about 1.0046 in the
[shared mechanism audit](https://github.com/cenetex/ilXyr/blob/c12a5496a697784218850b4767fa07519680d24f/experiments/research-step-4/REPORT.md).
That close result makes the lexical comparison the primary question here.

The [plan](PLAN.md) requires lower CPU and verifier work against the lexical
control, with both one-sided upper confidence bounds below one. It keeps the
other four comparisons, family outcomes, and four strata visible. Composition
patterns follow the previous design; the new families change target behaviors
and primitive sets within that design.

The controller retains failed search rows and child terminal records before
stopping. Warmup, preparation, model loading, and complete process costs stay
available beside the per-episode comparison. Synthetic timing tests cover both
a passing effect and a failed effect. Their values serve only as test fixtures.

## Run path

```bash
make -f Makefile.reasoner55-matched reasoner55-matched-check
```

CI runs this small check on Linux and macOS. The full controller command is:

```bash
node scripts/run_reasoner55_matched.mjs --run /path/to/new-output-directory
```

It uses 128 families, six arms, and 12 passes. Every pass has the same episode
order across arms. It writes raw outputs, terminal records, source/model/binary
identities, progress, an independent replay count, and the final analysis.
The 60-second child limit and 45-minute controller limit bound execution.

The next step is an immutable cloud package with compiler settings, machine
identity, shutdown watchdog, storage destination, and cost ceiling. That package
provides the concrete object for compute approval. The current deliverable is
the tested comparison runner and its frozen plan.
