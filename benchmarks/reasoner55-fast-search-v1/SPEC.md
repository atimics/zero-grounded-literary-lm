# Reasoner 5.5: exact hashing and sorting speed experiment

The reference is benchmark commit `b81a1b3bdca3fba81de5621cbf3e3d9987be00dc`.
Keep its 128 families, model, search budgets, verifier, scores, candidate order,
feature digests, and accepted-answer digests exact. This measures engineering
cost on the existing public benchmark. It supports claims about that workload.

## Changes

Use the system SHA-256 implementation through CommonCrypto on macOS and OpenSSL
EVP on Linux. Buffer small updates before calling the library. Preserve every
hashed byte and its order. Use the original portable SHA-256 as a test reference.

Sort candidate and semantic-group indexes with a typed merge sort. Move the
records once after ordering the indexes. Preserve each original comparison key
and its direction. Keep full ordering and full audit hashes in measured time.

Build through generated copies of the reference sources. The original sources
and benchmark records retain their exact bytes. Generate each copy through
explicit, checked replacement sites. Hash all source inputs in the new evidence.

## Fixed comparison

Run these eight conditions in this order:

1. Original task guide.
2. Task guide with system hashing.
3. Task guide with typed sorting.
4. Task guide with both changes.
5. Original target-only search.
6. Target-only search with both changes.
7. Original local guide.
8. Local guide with both changes.

Use the original fixed-transfer binary for conditions 1, 5, and 7. Build hash,
sort, and combined variants for the other conditions. The model stays at 1,863
bytes with SHA-256
`db0afc1e460df5192917fac1f8129a2ec1e753ddb67939a975076fae5579bb7a`.
Each condition has 512 episodes: 128 families, two source views, and two tie orders.

Use 16 timing passes. For pass p, rotate the condition list left by p modulo 8.
Reverse it in passes 8 through 15. Each condition occupies each process position
twice. Run each condition in a fresh process, using the original native pass
argument p modulo 8. All conditions share the episode order in each pass. Each
process warms every episode once before measurement. This gives 65,536 samples.

Compare every measured result with the corresponding complete row from the
fixed-transfer benchmark. Store each condition's result digest and every pass's
result digest. Save all timings, process order, model loading, corpus preparation,
peak RSS, compiler, flags, library backend, and binary digests. Episode time
includes the full search pipeline, audit work, allocation, and release. JSON
output, corpus preparation, and model loading have separate scopes.

## Analysis

Take the median timing for each episode across 16 passes. Average paired log
ratios over the four views within a family, then weight the 128 families equally.
Use measured CPU and elapsed time, and `(checks + 1)` for verifier ratios.

Compare every condition with the original task guide. Also compare the combined
task guide with original target-only search, original local guidance, improved
target-only search, and improved local guidance. Report all four task cells,
per-family ratios, source views, whole-pass totals, loading, and peak RSS.

Use the earlier stratified bootstrap: 5,000 draws, 32 families per cell, all views
together, RNG seed `0x626f6f742d763031`, stream 0. Report nearest-rank 2.5th, 95th,
and 97.5th percentiles. Family intervals describe task variation. Whole-pass
ratios describe timing variation separately.

The primary engineering check requires exact result parity and one-sided 95%
upper CPU and elapsed ratios below 1 for the combined task guide against the
original task guide. Report its cost against both forms of target-only and local
search independently. Record the measured outcome in every case.

## Validation

Test SHA-256 against the original C implementation and Node's crypto library.
Cover empty input, SHA padding boundaries, buffer boundaries, large messages,
and split updates. Test typed sorting against the original comparator and qsort,
including count boundaries, reversed order, equal leading keys, and integer
extremes. Compare every search row and full audit digest on the fixed cohort.

Run the existing fixed-transfer checker and native parity, fallback, and cap
checks. Reproduce the fixed training digest in every new binary. Run sanitizers
over the new hash/sort checks and a complete combined task-guide pass. Run the
development checks on Linux and macOS. Timing fixtures belong to the recorded
host; CI checks result parity and analysis arithmetic.
