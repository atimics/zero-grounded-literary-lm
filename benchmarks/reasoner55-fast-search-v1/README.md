# Reasoner 5.5: hashing and sorting results

The combined change reduces the task guide's paired CPU cost by **51.0%** and
elapsed time by **50.8%** on the fixed 128-family benchmark. Every answer,
verification count, candidate-order digest, and feature digest stays exact.
The engineering check returns `met`.

The improved guide also has **19.3% lower CPU cost** than target-only search
with the same hashing and sorting improvements. Its CPU ratio is 0.807, with a
two-sided 95% family interval of 0.796 to 0.818. It has the lowest paired CPU
cost in each of the four task cells among these eight conditions.

## What changed

Small SHA-256 updates collect in a 4,096-byte buffer. Full buffers go to the
system SHA-256 library: [CommonCrypto on macOS](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/CC_SHA256.3cc.html)
and [OpenSSL EVP on Linux](https://docs.openssl.org/3.0/man3/EVP_DigestInit/).
Every input byte keeps its original order. The original portable SHA-256 remains
an independent native test reference.

The new sort compares 16-bit indexes with the original comparison functions.
It sorts short runs, merges their indexes, and applies the final permutation
in cycles. Large candidate and semantic-group records move into place once.
The full order and full audit hashes remain part of each measured episode.

The same changes apply to target-only and local search. Hash-only and sort-only
builds measure each contribution to the task guide's cost.

## Comparison

The [design](SPEC.md) was committed as `444d8ee` before implementation. The
implementation was committed as `c3b3fec` before timing. All ratios below compare
methods remeasured in the same balanced run on an Apple M4 Max with Apple clang
17 and `-O2`. The original measurements retain their own records.

| Condition | Paired CPU ratio to original task guide | Paired elapsed ratio | Sum of episode CPU medians, ms |
| --- | ---: | ---: | ---: |
| Original task guide | 1.000 | 1.000 | 406.0 |
| System hashing | 0.511 | 0.513 | 207.1 |
| Typed sorting | 0.956 | 0.956 | 387.9 |
| Both changes | 0.490 | 0.492 | 198.7 |
| Original target-only search | 0.682 | 0.679 | 275.8 |
| Improved target-only search | 0.607 | 0.606 | 245.4 |
| Original local guide | 0.792 | 0.790 | 386.4 |
| Improved local guide | 0.657 | 0.655 | 286.0 |

System hashing alone reduces paired CPU cost by 48.9%. Typed sorting alone
reduces it by 4.4%. The combined CPU ratio is **0.490**, with a two-sided 95%
interval of **0.488 to 0.492**. Its elapsed ratio is **0.492**, with an interval
of **0.490 to 0.494**. One-sided 95% upper ratios are 0.491 and 0.494.

Against the improved local guide, the combined task guide has a CPU ratio of
0.746, with a two-sided interval of 0.708 to 0.775. Its verifier ratio stays
0.825, exactly matching the earlier search result. Against improved target-only
search, its verifier ratio is 0.940, with an interval of 0.877 to 1.009.

| Operations and composition | CPU ratio to original task guide | CPU ratio to improved target-only search |
| --- | ---: | ---: |
| Original sampler, four distinct roles | 0.489 | 0.793 |
| Original sampler, A B A B | 0.490 | 0.825 |
| Dense mixing, four distinct roles | 0.487 | 0.810 |
| Dense mixing, A B A B | 0.492 | 0.800 |

These paired ratios average the four views within each family and weight all
128 families equally. Pooled time totals weight expensive episodes by their
absolute cost. The local guide's eight fallback episodes remain in both versions.

## Cost and timing variation

Across 512 episodes, the task guide's audit-hash elapsed total falls from
240.1 ms to 37.0 ms. Its sorting total falls from 89.9 ms to 80.2 ms. Hashing
accounts for the largest measured improvement. Sorting becomes the largest
remaining stage in the combined guide, at about 40% of its elapsed total.

All 16 passes are retained. Whole-pass CPU ratios for the combined guide against
the original guide range from 0.433 to 0.675, with a median of 0.469. Against
improved target-only search, they range from 0.705 to 1.181, with a median of
0.767. These pass-level figures describe timing variation separately from the
family intervals, which use each episode's median over the 16 passes.

The fixed 1,863-byte model is reused. Its SHA-256 remains
`db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a`.
Loading the combined guide takes a median of about 0.15 ms per process. Corpus
preparation has separate records. Per-process peak RSS, including preparation,
warmup, and search, ranges from about 2.59 to 3.03 MiB for the combined guide.
The original guide ranges from about 2.56 to 3.00 MiB. All method records include
their loading and memory figures.

The measurements describe this public workload on the recorded Mac host. Linux
CI checks the OpenSSL build, exact replay, and analysis arithmetic. The existing
model and task set provide a fixed engineering comparison for this change.

## Reproduction and validation

```sh
make -f Makefile.reasoner55 reasoner55-fast-search
make -f Makefile.reasoner55 reasoner55-fast-search-check
```

Linux builds need OpenSSL development headers and `libcrypto`. macOS builds use
the CommonCrypto headers supplied with the development tools. The original
portable binaries retain their original build path.

The timing run uses eight conditions and 16 passes. Each condition occupies
each process position twice. Each process warms all 512 episodes once and then
measures the same episode order as the other conditions in that pass. This gives
65,536 measured samples. Each full result row is compared with the original
benchmark during collection.

The standalone checker passed locally. It checks 4,096 fresh native rows against
the original complete results, all stored result digests, timing order, arithmetic,
altered artifacts, and invalid arguments. Each new binary passes 119 SHA vectors
against both the original C hash and Node crypto, plus 448 sort boundary cases.
Each also reproduces the fixed training digest and passes the inherited native
program-map, feature, fallback, and cap checks.

AddressSanitizer and UndefinedBehaviorSanitizer passed the new primitive checks
and a full combined task-guide pass. All 512 sanitized result rows match the
optimized reference records. A separate Python calculation matches all 36 paired
point estimates and all 108 confidence bounds.

The R5.5 workflow runs the existing diagnostics, semantic guide, fixed transfer,
and new speed checks on Linux and macOS. It accepts pull requests against working
branches so this separate PR receives the same development checks.

The build generates explicit copies of the reference source files with checked
replacement sites. The original solvers, model, benchmark records, main Makefile,
and original CI workflow retain their exact bytes. The new results bind all new
source inputs and the original evidence. Timing binds every measured binary.

- [RESULTS.json](RESULTS.json): source bindings, fixed model identity, condition
  result digests, and exact-row totals.
- [TIMING.json](TIMING.json): all 128 process records and 65,536 timing samples.
- [ANALYSIS.json](ANALYSIS.json): intervals, task cells, source views, per-family
  ratios, whole-pass totals, loading, and peak RSS.

The next cost target is the guide's full sort. This result also gives later
method-selection work a faster exact guide and stronger baseline implementations.
