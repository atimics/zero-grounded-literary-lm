# ZERO.5 vector-math validation result

## Result

**GNU libmvec `tanh` and `exp` made the AWS CPU trainer 30.48% faster over
1,000 updates.** The same ten validation checks reported exactly the same loss
in both arms at the stored precision.

| Arm | Effective throughput | Time | Final validation loss |
| --- | ---: | ---: | ---: |
| Scalar-array baseline | 4,892.62 tok/s | 418.59 s | 1.8291 |
| GNU libmvec vector path | **6,384.04 tok/s** | **320.80 s** | **1.8291** |

For fixed work, this removes 23.36% of trainer time. A five-million-token run
now takes about 13.1 minutes of measured trainer time. Startup, asset loading,
validation, and shutdown make 15–18 minutes a safer end-to-end estimate.

## Gates and decision

All eight frozen model gates passed. The exact math backends and checkpoint
version matched, every metric was finite, the speed gain exceeded 15%, and
the final, mean, and worst single-point validation-loss deltas were all zero.
The sealed test set stayed closed.

The vector path is eligible to become the GNU/Linux production default. This
result records eligibility only; it does not change the default by itself.
This was a performance validation replay, not a new model result or a
scientific C3.3 replication.

## Cost

The `c6i.4xlarge` instance ran for 806 seconds and cost an estimated
**$0.15224**, below the approved $0.17 limit. It terminated automatically.

The machine-readable contract, launch receipt, terminal status, result,
comparison, and hashes are beside this file. Verify them with
`make zero5-vector-validation-aws-result-check`.
