# ZERO-EVAL-1

ZERO-EVAL-1 is an evaluation-only comparison of the frozen ZERO.3 and ZERO.4
quantized generative cores. It does not train, sample, invoke a faculty
controller, or execute deterministic arithmetic.

The suite contains four externally established tasks:

- BLiMP full-sentence minimal-pair likelihood;
- HellaSwag zero-shot continuation likelihood;
- an explicitly context-truncated LAMBADA final-word diagnostic; and
- bits per byte on a deterministic TinyStories validation sample.

The exact upstream revisions, source hashes, normalization, context policy,
task order, models, and permitted interpretation are frozen in
`contract.json`. The prepared data are derived artifacts and are not committed.
The preparation command verifies every downloaded source before it writes a
bundle, and the bundle checker requires the frozen derived hashes.

## Scientific boundary

Reportable measurements run only on the declared AWS venue. Local and GitHub
Actions executions are mechanics tests. The initial AWS calibration may report
only runtimes, case counts, byte counts, and deterministic result hashes; its
scores are sealed from interpretation. A full evaluation requires a new budget
derived from that calibration and explicit authorization.

ZERO.4 has a 512-character context and a 128-character normalized vocabulary.
Consequently, this suite does not pretend that all tasks are standard modern
LLM measurements. BLiMP remains a clean likelihood ranking. HellaSwag retains
its standard choice construction but uses the declared context truncation.
LAMBADA is an adapted boundary diagnostic and must never be presented as a
standard full-context result. TinyStories is out-of-domain narrative modeling,
not evidence that ZERO was trained on or optimized for that corpus.

## Score-sealed calibration result

GitHub Actions run
[`30135007168`](https://github.com/atimics/zero-grounded-literary-lm/actions/runs/30135007168)
completed the one authorized calibration on merged commit `ee140954...`.
The frozen 16-process timing samples were:

| Task shape | Cases | Elapsed | Cases/second |
| --- | ---: | ---: | ---: |
| BLiMP | 64 | 2.992 s | 21.394 |
| TinyStories | 64 | 15.610 s | 4.100 |
| HellaSwag | 64 | 48.717 s | 1.314 |
| adapted LAMBADA | 64 | 10.060 s | 6.362 |

The workload completed after 167 launch-relative seconds for an estimated
$0.031544. Its result passed the independent score-field seal, the instance
terminated, and the one-time authorization is consumed. The immutable
[`completion record`](aws-calibration/COMPLETED) binds the launch, status,
result, source archive, artifact digest, commit, and budget.

Scaling each task by both case count and prepared input bytes, taking the
larger estimate, projects 23,709 seconds (6h35m09s) for both models. The
[`full-run budget proposal`](full-budget-proposal.json) adds 25% contingency,
cold-start/build allowance, publication reserve, and rounding headroom for an
8h30m/$5.78 hard ceiling. It is deliberately marked
`proposed_not_authorized`; no full workflow or execution is authorized yet.

## Development commands

```sh
make external-eval
node scripts/prepare_zero_eval1.mjs --self-test
node scripts/check_zero_eval1.mjs --self-test
make zero-eval1-full-budget-check
```

Full bundle preparation requires the four exact upstream files named in the
contract. CI uses small generated fixtures and never downloads benchmark data.
