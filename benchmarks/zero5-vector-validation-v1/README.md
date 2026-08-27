# ZERO.5 vector-math validation replay

The 100-update calibration found a 28.14% throughput gain from GNU libmvec
`tanh` and `exp`. This follow-up tests whether that faster math path keeps the
same useful validation-loss trajectory over 1,000 updates.

It runs two arms from the same C2 checkpoint and the same frozen C3.3 training
and validation packs:

- the current Linux fast trainer with `math-backend=scalar-array`;
- the candidate trainer with `math-backend=gnu-libmvec-tanh-exp`.

Both arms use checkpoint version 6 and require the declared backend. They run
1,000 updates, report every 100 updates, and evaluate 16 fixed validation
sequences at each report. The replay opens no test data and cannot claim a new
model result or a scientific C3.3 replication.

The candidate must retain at least a 15% speed gain. Its final and mean
validation loss may be at most 0.01 nats/token worse than the scalar arm, and
no measured validation point may be more than 0.02 worse. These are practical
promotion guards, not proof that both floating-point trajectories are equal.

Check the parser and comparison mechanics with:

```sh
node scripts/benchmark_zero5_vector_validation.mjs --self-test
```

The AWS execution contract will be frozen separately after this benchmark
implementation is committed. No compute is authorized by this file.
