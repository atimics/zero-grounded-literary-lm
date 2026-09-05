# Reasoner 5.5 fixed transfer: results

The fixed guide improves verification cost on the fresh cohort. Full CPU and
elapsed costs call for further research. The main cost rule returns
`further_research`.

The guide's family-weighted verifier ratio is **0.825**, with a two-sided 95%
interval of **0.707 to 0.952**, against the original local guide. Its CPU ratio
is **1.204**, with an interval of **1.122 to 1.269**. Its elapsed ratio is
**1.203**, with an interval of **1.118 to 1.268**. A ratio below 1 favors the
method being measured.

## Fixed design and fresh tasks

The [design](SPEC.md) was committed as `524b2b0` before the new targets were
generated. The implementation was committed before measurement. The learned
artifact stays at 1,863 bytes and keeps its original SHA-256:
`db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a`.

There are 128 fresh families, 32 in each combination of:

- the original operation sampler or dense mixing operations;
- four distinct operation roles or the repeated pattern A B A B.

The dense mixing matrices are invertible and have nine nonzero entries. The
original mixing sampler has four. The other six operation roles keep their
original sampling rules. The full set of eight operation maps is new in each
family. Target behavior is distinct from all 136 earlier source and development
families and from every earlier target in this cohort.

The chosen role sequences exclude 259 earlier sequences: all exact source
solutions and all intended source and development sequences. Selection uses
only the fixed composition, novelty, and operation rules. Every accepted nonce
and rejection count is recorded. Exact minimum-length enumeration finds one
three-step task and 127 four-step tasks.

Each family has two fixed source-guide views and two tie orders. Six methods
give 3,072 search rows. All answers are exact, and all injected wrong answers
are rejected. Native and independent JavaScript implementations reproduce
family selection, shortest lengths, rankings, verifier counts, and fallback.

## Search and full pipeline costs

The original local guide remains the fixed primary reference. Each paired
ratio averages log ratios within a family and then weights all families equally.
The bootstrap resamples families within the four cells and keeps repeated
settings together. There are 5,000 fixed draws. [ANALYSIS.json](ANALYSIS.json)
contains the intervals, every family, all four cells, and both source views.

| Method | Total checks | Paired check ratio | Paired CPU ratio | Paired elapsed ratio |
| --- | ---: | ---: | ---: | ---: |
| Target only | 6,848 | 0.878 | 0.826 | 0.820 |
| Original local guide | 17,355 | 1.000 | 1.000 | 1.000 |
| Group-size scores | 6,990 | 0.909 | 1.180 | 1.220 |
| Fixed task guide | 6,389 | 0.825 | 1.204 | 1.203 |
| Task guide with lexical roles | 6,495 | 0.820 | 1.199 | 1.190 |
| Task guide without source-score feature | 6,632 | 0.843 | 1.197 | 1.196 |

The original local guide uses fallback in eight episodes, reaching as many as
1,418 checks in one episode. The other methods finish within their proposal
budget; their maximum check counts range from 39 to 45. These expensive
fallbacks explain why pooled totals and family-weighted ratios differ.

Target-only search has the lowest measured CPU cost in every cell. The task
guide's descriptive paired CPU ratio against target-only search is about
1.46. The lexical control reaches a similar verifier ratio to the correct
roles. Attribution to semantic role transfer remains an open question.

## Where the guide helps

| Operations and composition | Task-guide check ratio | Task-guide CPU ratio |
| --- | ---: | ---: |
| Original sampler, four distinct roles | 0.661 | 1.131 |
| Original sampler, A B A B | 1.006 | 1.283 |
| Dense mixing, four distinct roles | 0.574 | 1.168 |
| Dense mixing, A B A B | 1.215 | 1.241 |

The guide carries a useful preference for distinct-role compositions into the
new operation set. Repeated compositions deserve a different search strategy.
The source-score feature adds a small improvement to the pooled verifier ratio;
the task and composition features account for much of the measured benefit.

## Timing, preparation, and memory

Twelve passes balance process order: each method occupies each position twice.
Each process warms up every episode once, then measures the same shuffled
episode order as the other methods in that pass. Timing includes the existing
full search and audit pipelines. Corpus generation, model loading, and training
have separate records. JSON output is outside episode time.

The recorded host is an Apple M4 Max. Sums of per-episode medians across 512
episodes are 532.8 ms of CPU for target-only search, 783.8 ms for the original
local guide, and 779.8 ms for the task guide. Their elapsed totals are 538.9 ms,
808.4 ms, and 794.2 ms. These pooled figures weight expensive episodes by their
absolute cost; the main paired analysis weights families equally.

The task guide spends about 462.1 ms on full feature and ordering hashes,
150.3 ms on sorting, 58.9 ms on enumeration, 44.8 ms on scoring, and 6.0 ms on
verification and fallback. The original and grouped methods produce different
audit records, so these figures measure their actual existing pipelines.

Across the 12 whole-pass totals, the task guide's CPU ratio to the local guide
ranges from 0.695 to 1.051, with a median of 0.992. This describes timing
variation separately from the family bootstrap. All raw samples are saved in
[TIMING.json](TIMING.json), including a slow group-size pass.

Reproducing both source fits takes median times of 449.5 ms of CPU and 451.9 ms
elapsed. The task-guide process loads the model in about 0.25 ms. On the pooled
median totals, the small observed saving would repay training and one model
load after about 58,383 episodes by CPU time, or 16,245 by elapsed time. These
are conditional point estimates for a resident model and the same task mix.
The family-weighted cost rule remains the primary decision.

Native process peak RSS ranges from about 1.7 to 3.2 MB across methods and
passes, including preparation and warmup. Source-free methods have zero model,
loading, and training charges. The independent replay checker releases each
family's candidate caches after checking all six methods.

## Reproduction and checks

```sh
make -f Makefile.reasoner55 reasoner55-fixed-transfer
make -f Makefile.reasoner55 reasoner55-fixed-transfer-check
```

The first command writes all results after independent replay. It saves an
intermediate collection in the ignored build directory before replay. The
second command checks the stored evidence, regenerates the cohort, replays all
3,072 rows, reproduces the fixed training result, and compares fresh native
runs. It also checks altered selection, costs, timing order, invalid command
arguments, and a changed model artifact.

Native parity checks all 524,288 new program maps and prefix features. The
earlier parity, fallback, and cap tests remain part of this command. The new
native self-test and a full task-guide pass also pass AddressSanitizer and
UndefinedBehaviorSanitizer. A separate Python arithmetic audit matches all
18 paired ratios and all 54 interval bounds.

The build reuses the merged C solvers through a generated header that changes
the earlier CLI's symbol name. The result binds the original sources, the new
runner, the design, and the model. Timing binds the resulting binary. The
original solver, model, and development records retain their exact bytes.

- [RESULTS.json](RESULTS.json): full families, selection records, model identity,
  source digests, and all search outcomes.
- [TIMING.json](TIMING.json): 72 process records, 36,864 timing samples, and three
  separate training measurements.
- [ANALYSIS.json](ANALYSIS.json): costs, intervals, cell and source-view results,
  per-pass totals, and conditional training repayment.

## Next research step

Improve reuse of exact program behavior and reduce the measured sorting and
audit costs. Keep target-only search in the next comparison alongside the
original local guide. A later routed system can then choose methods from their
measured cost on each kind of task. This benchmark provides a fixed reference
for that work.
