# ZERO.5 CPU phase profile

This experiment measures where the winning four-worker C trainer spends its
time on AWS. It does not change the model, data, training order, optimizer, or
checkpoint format.

## Binaries

- `zero5_c32_lm_fast` is the unchanged production baseline.
- `zero5_c32_lm_profile` uses the same compiler flags and adds phase timers
  behind `USE_PHASE_PROFILE`.

The profile binary emits one `phase-profile` JSON record after training. The
normal binary contains no timers or profile state.

## Measurements

Wall-clock update phases:

- input and dropout setup;
- parallel forward/backward wave;
- private-gradient merge; and
- AdamW preparation and update.

Summed CPU time across all sequence workers:

- total forward and backward;
- linear forward and backward;
- attention forward and backward;
- RMSNorm forward and backward;
- GELU forward and backward;
- rotary positions;
- output softmax and loss; and
- remaining worker work.

Worker CPU seconds are summed across four concurrent workers and can therefore
be greater than wall seconds.

## Frozen mechanics controls

- Four sequence workers and one BLAS thread per worker.
- Dynamic BLAS and OpenMP threading disabled.
- Same frozen C2 checkpoint, C3.3 packs, tokenizer, seed, and schedule.
- The profiled checkpoint must be bit-identical to the fast baseline.
- Reported loss and gradient metrics must match.
- Profiler elapsed overhead is reported and must be at most 5% before using the
  phase proportions to select an optimization.
- The sealed test set stays closed.

The first AWS measurement should use 100 updates on `c6i.4xlarge`, followed by
Linux `perf stat` counters for cycles, instructions, cache misses, branches,
context switches, and CPU migrations. No EC2 launch is authorized here; it
requires a fresh explicit dollar cap.

Run the Linux benchmark with:

```sh
node scripts/benchmark_zero5_profile.mjs \
  --asset-root /path/to/frozen-assets \
  --updates 100 \
  --out /tmp/zero5-phase-profile.json
```

Verify mechanics with `make zero5-cpu-profile-check`.
