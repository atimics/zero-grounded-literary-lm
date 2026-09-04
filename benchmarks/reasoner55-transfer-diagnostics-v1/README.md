# Reasoner 5.5: source choices and search costs

Status: development evidence, 4 September 2026.

The local guide retains the lower paired verification cost across all eight
random source-solution variants. The timing sample points to enumeration and
ranking as the next part of the search to improve.

## What this measures

Reasoner 5.5 studies transfer between small program-solving tasks. Each task has
eight operations on three numbers modulo five. The solver chooses a four-step
program from 4,096 candidates. An adapter recovers each operation's role. A
small source guide ranks programs using role counts and adjacent role pairs.
The verifier checks a proposed answer on all 125 possible inputs.

The source guide currently learns the first exact solution found for each
source task. This experiment compares that choice with eight fixed random
choices and the last exact solution. Every choice contributes one solution per
task. Each guide receives the same 64 source tasks and has the same size.

There are 128 source tasks and eight target tasks. Each target has two source
generator views and two tie repeats. All 15 methods use these same 32 episodes.
The random seed indexes are 0 through 7. Selection uses rejection sampling from
the complete list of exact solutions, in syntax order. The native code and
independent JavaScript checker replay the selection from each source seed.

## Results

58 source tasks have several exact solutions. Their counts range from two to
12. Every alternate guide changes all 32 proposal orders. All 480 search rows
produce exact answers and reject the injected wrong answer.

| Method | Verification checks, total | Paired cost ratio to local guide |
| --- | ---: | ---: |
| Target only | 583 | 1.657 |
| Adapter only | 583 | 1.657 |
| Raw lexical guide | 393 | 0.958 |
| Original source guide | 407 | 1.165 |
| Frequency lexical guide | 419 | 1.003 |
| Local guide | 380 | 1.000 |
| Eight random source choices, range | 378–470 | 1.046–1.380 |
| Last exact source choice | 387 | 1.023 |

The paired ratio uses `log((method_checks + 1) / (local_checks + 1))` for each
episode. It averages the four views within a target, then averages the eight
target values and takes the exponential. A lower ratio is better. The target
is the unit of comparison. Source views and tie repeats stay within that unit.
The files contain each target's ratio. These are descriptive development
results. The original registered analysis retains its development no-go result.

The random variants average a ratio of 1.184 across the eight seeds. Their full
range is reported because choosing a seed using these targets would introduce
selection bias. One variant uses 378 checks in total while its paired ratio is
1.046. The two measures weight the tasks differently.

## Timing sample

The sample used an Apple M4 Max, macOS 25.3.0, with the default C build flags
`-O2 -std=c11 -Wall -Wextra -Wpedantic`. Each method ran in a fresh process. It
had one warmup pass, then three measured passes. The table sums the median
time for each of the 32 episodes.

| Method | Full measured search | Adapter | Local guide construction |
| --- | ---: | ---: | ---: |
| Target only | 14.761 ms | 0 | 0 |
| Original source guide | 15.727 ms | 0.096 ms | 0 |
| Local guide | 17.028 ms | 0.096 ms | 1.338 ms |

Full measured search includes public episode setup, adapter recovery and its
domain audit when used, local guide construction when used, candidate
enumeration, ranking, exact verification, fallback, and search receipt hashes.
The native search stage combines enumeration, ranking, and verification.
Their separate costs are a useful next measurement.

The local guide uses 380 checks across these episodes. Target-only search uses
583. The local guide rebuilds its guide for every episode. Its measured full
search takes longer than the other two
methods on this host. Search-time gains deserve their own comparison alongside
verification counts. The method order was fixed. Additional process orderings
and hosts can measure timing variation.

The source audit enumerates all 4,096 programs per source task for every method.
It costs about 17.5 ms for both source generators here. `training_ns` measures
that diagnostic construction, including exact-solution enumeration and guide
serialization. The original first-solution trainer can stop enumeration early.
Source-free methods use their target evidence during measured search; their
source audit is fixture preparation. These preparation times are recorded
separately from episode timing.

Peak RSS is reported for each process. It includes corpus generation, source
audit, warmup, and measured search. It measures the whole diagnostic process.
The timing file records the host, binary digest, raw timing samples, method
order, and result digest. Repeated timings may vary with the host load.

## How to reproduce

```sh
make -f Makefile.reasoner55 reasoner55-diagnostics
make -f Makefile.reasoner55 reasoner55-diagnostics-check
```

The separate make file extends the build. The main Makefile is recorded by the
R5.9a contract. A separate workflow runs the experiment checks on Linux and macOS.
The first command writes the two result files. The second rebuilds and compares
all deterministic native rows. It independently reconstructs the source guides
and replays all 480 search rows with the existing R5.5 replay code. It also
tests altered source choices, altered costs, altered proposal orders, and
duplicate episodes. Timing checks validate the saved structure and arithmetic.

- [DIAGNOSTICS.json](DIAGNOSTICS.json): source choices, source guides, search
  rows, target-level comparisons, and source file digests.
- [TIMING.json](TIMING.json): host-specific preparation and search timings.
- [Original development result](../reasoner55-generated-primitive-transfer-v1/DEVELOPMENT.md).

## Next experiment

Use the current task and intermediate execution values to guide search. Start
with a small feature model and an exact semantic index as a comparison. Measure
candidate construction, scoring, sorting, and verification separately. Reuse
the same verification contract and count source preparation separately.

This follows the task and execution features used by
[BUSTLE](https://arxiv.org/abs/2007.14381) and
[CrossBeam](https://arxiv.org/abs/2203.10452). The present diagnostic supports
testing a richer guide: changing the source solution alone leaves the local
guide ahead on paired verification cost. A later experiment can give every
equivalent source solution equal weight within its task.

Fresh evaluation families should follow a frozen experiment design. The
current eight targets serve development and diagnosis.
