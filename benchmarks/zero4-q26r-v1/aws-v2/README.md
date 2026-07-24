# Q2.6-R bounded AWS replacement

Status: **corrective recovery-3 authorized once**, 2026-07-24.

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

The first recovery also failed safely before training. Its immutable
[`second preflight failure record`](preflight-failure-30118477546.json) records
the missing `ec2:DescribeInstanceAttribute` permission, the immediately
terminated seed 1 instance, absent seed 3 instance, and second reserved
60-second minimum.

Recovery-2 then launched both instances but failed safely before training
because its bootstrap still asserted the former `$1.18` cost cap. The
[`bootstrap failure record`](bootstrap-failure-30119938666.json) freezes both
infrastructure-error statuses, shutdown receipts, hashes, and 167 observed
instance-seconds.

The approved corrective recovery-3:

- adds only `ec2:DescribeInstanceAttribute` to the GitHub Actions role;
- proves that permission with a zero-compute AWS dry run;
- regression-tests the bootstrap guards against the frozen budget;
- validates all prior write-once locks and recovery-2 failure receipts;
- acquires exactly one `recovery-3.lock`;
- starts two independently capped AWS instances at 6,190 seconds/$1.17 each;
- caps all-in worst-case compute at $2.394211111111111;
- captures shutdown behavior from the correct EC2 attribute API.

The short-lived launch workflow does not wait for training. Long computation
remains on AWS. The collector is also short-lived, never waits, and never
launches or restarts compute.

Run the local registration checks with:

```sh
make zero4-q26r-aws-v2-check
```
