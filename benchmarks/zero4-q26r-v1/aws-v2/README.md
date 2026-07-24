# Q2.6-R bounded AWS replacement

Status: **bounded recovery authorized once**, 2026-07-24.

This directory contains the replacement execution envelope for Q2.6-R. It
exists because the first bounded AWS route lost its ephemeral EC2 identity
records before frozen collection. The scientific contract is unchanged.

The exact replacement rationale, observed-outcome disclosure, budget, and
provenance rules are in [`PREREGISTRATION.md`](PREREGISTRATION.md). The
machine-checked authorization is [`budget.json`](budget.json).

The original v2 launch failed safely before training. Its immutable
[`preflight failure record`](preflight-failure-30117320329.json) names the
control-plane defect, the immediately terminated seed 1 instance, the absent
seed 3 instance, and the reserved 60-second minimum bill.

The approved recovery:

- validates the failed run's original write-once lock and missing receipts;
- acquires exactly one `recovery-1.lock`;
- starts two independently capped AWS instances at 6,240 seconds/$1.18 each;
- keeps all-in worst-case compute below the original $2.38 ceiling;
- captures shutdown behavior from the correct EC2 attribute API.

The short-lived launch workflow does not wait for training. Long computation
remains on AWS. The collector is also short-lived, never waits, and never
launches or restarts compute.

Run the local registration checks with:

```sh
make zero4-q26r-aws-v2-check
```
