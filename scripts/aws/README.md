# AWS experiment runner

The only executable compute workflow is now the five-minute
`openblas-calibration-v1` performance experiment. The former unbudgeted
Q2.2-R/Q2.6-R launcher is retired after a frozen portable-C Q2.6-R seed reached
its 11-hour limit without producing a result. Historical `train.sh`,
`user-data.sh`, and the collection workflow remain for provenance and
diagnostics; they are not launch paths.

## Provision once

Run with administrator credentials:

```sh
AWS_REGION=us-east-1 \
ZERO_GITHUB_REPOSITORY=atimics/zero-grounded-literary-lm \
./scripts/aws/provision.sh
```

The default repository also pins its stable, ID-qualified GitHub OIDC identity
(`atimics@210085965/zero-grounded-literary-lm@1303249204`). This is the subject
GitHub currently places in AWS web-identity tokens. For a different repository,
set both `ZERO_GITHUB_REPOSITORY` and `ZERO_GITHUB_REPOSITORY_SUBJECT`; the
latter must use GitHub's `owner@owner_id/repository@repository_id` form.

If the account has no default VPC, also set `ZERO_VPC_ID` and
`ZERO_SUBNET_ID`. Copy the five printed values into the GitHub `aws`
environment secrets.

## Restore ignored assets

Teacher binaries and generated replay streams are intentionally not stored in
Git. Upload them to the private artifact bucket before dispatch:

```sh
python3 scripts/verify_teacher_artifacts.py
aws s3 sync teachers/ "s3://$AWS_BUCKET/assets/teachers/" --exclude registry.json
aws s3 sync corpus/bpe/ "s3://$AWS_BUCKET/assets/corpus/bpe/"
aws s3 sync corpus/channel/ "s3://$AWS_BUCKET/assets/corpus/channel/"
```

The instance downloads those paths and verifies every frozen teacher against
`teachers/registry.json` before training.

## Budgeted calibration lifecycle

Dispatch `.github/workflows/openblas-calibration.yml`. It has no mutable
experiment, seed, instance-type, duration, or price inputs. Those values come
from the checked
`benchmarks/openblas-calibration-v1/budget.json` contract:

- one `c6i.4xlarge` in `us-east-1`;
- OpenBLAS with 16 threads;
- diagnostic seed 89 and no more than eight optimizer attempts;
- 300 seconds and $0.06 maximum instance compute; and
- 240 seconds maximum workload time, preserving publication time.

GitHub Actions only archives inputs, launches EC2, observes S3, enforces the
launch-relative deadline, downloads the result, and terminates the instance.
The measured computation runs on EC2. EC2 user data also starts an independent
five-minute shutdown watchdog, while the workload owns a third shorter
deadline. A complete or budget-exhausted result is valid calibration evidence,
but the schema sets `scientific_inference_allowed` to false.

The result reports cold-start time, complete optimizer attempts, attempt
throughput, and a linear 1,400-attempt runtime/cost projection. A zero-attempt
result still says that cold start does not fit the budget. The 15-minute pilot
and two-hour ceiling are documented cost stages only and cannot be dispatched
without a new authorization.

Run the validators before dispatch:

```sh
make experiment-budget-check
```

The collection workflow is retained only for already-launched historical
instances. It never starts compute.

The GitHub role can use regional AMIs, subnets, security groups, network
interfaces, and volumes only as resources of `RunInstances`. The separately
authorized instance resource must carry `Project=zero` at launch, and the role
can terminate only instances carrying that tag.
