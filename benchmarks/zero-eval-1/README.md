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
Actions executions are mechanics tests. The initial AWS calibration reported
only runtimes, case counts, byte counts, and deterministic result hashes; its
scores were sealed from interpretation. The later bounded screen was separately
authorized, completed, and published.

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
larger estimate, projected 23,709 seconds (6h35m09s) for both models. The
historical [`full-run budget proposal`](full-budget-proposal.json) added 25%
contingency, cold-start/build allowance, publication reserve, and rounding
headroom for an 8h30m/$5.78 hard ceiling.

## Bounded screen and full-run decision

The separately frozen 1,000-case-per-task screen completed in 2,502
launch-relative seconds for $0.4726:

| Metric | ZERO.3 | ZERO.4 | ZERO.4 − ZERO.3 |
| --- | ---: | ---: | ---: |
| BLiMP raw accuracy | 0.532 | 0.537 | +0.005 |
| TinyStories bits/byte ↓ | 2.527861 | 2.570353 | +0.042492 |
| HellaSwag normalized accuracy | 0.271 | 0.266 | -0.005 |
| adapted LAMBADA exact accuracy | 0 | 0 | 0 |

The bounded interpretation is mixed: the small BLiMP gain did not carry into
TinyStories or HellaSwag, and neither model solved the adapted LAMBADA
diagnostic. The [`full-run decision`](full-run-decision.json) therefore closes
the proposed full evaluation as `do_not_run`. This does not claim equivalence
or general capability, and it does not make a claim about the unexecuted full
datasets.

The replacement is the candidate-only
[`ZERO language-preservation gate v1`](../zero-language-gate-v1/README.md).
It retains BLiMP and TinyStories only, reuses the frozen ZERO.3 aggregate, and
is proposed at 600 seconds/$0.12 per candidate. It is not yet authorized.

## Development commands

```sh
make external-eval
node scripts/prepare_zero_eval1.mjs --self-test
node scripts/check_zero_eval1.mjs --self-test
make zero-eval1-full-budget-check
make zero-eval1-full-run-decision-check
make zero-language-gate-check
```

Full bundle preparation requires the four exact upstream files named in the
contract. CI uses small generated fixtures and never downloads benchmark data.
