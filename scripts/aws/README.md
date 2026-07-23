# AWS experiment runner

There is currently no authorized compute workflow. The one-time diagnostic
`openblas-e2e-calibration-v1` consumed its 25-minute/$0.29 authorization after
100 accepted optimizer updates and four sentinel evaluations, during the first
500-case full evaluation. Its `COMPLETED` sentinel and S3 lock prevent another
launch. It did not invoke the scientific driver or evaluate the promotion
split. The prior `openblas-pilot-v1` completed 97 attempts inside its
15-minute/$0.17 boundary, and its `COMPLETED` sentinel plus S3 lock likewise
prevent another launch.
The former unbudgeted Q2.2-R/Q2.6-R launcher is retired after a frozen
portable-C Q2.6-R seed reached its 11-hour limit without producing a result.
Historical `train.sh`, `user-data.sh`, and the collection workflow remain for
provenance and diagnostics; they are not launch paths.

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

Teacher binaries, their registry, and `corpus/literary.bpe` are tracked and
arrive in the immutable source archive. Generated replay streams are ignored
and must be uploaded to the private artifact bucket before dispatch:

```sh
python3 scripts/verify_teacher_artifacts.py
aws s3 sync corpus/bpe/ "s3://$AWS_BUCKET/assets/corpus/bpe/"
aws s3 sync corpus/channel/ "s3://$AWS_BUCKET/assets/corpus/channel/"
```

The instance downloads those paths and verifies every frozen teacher against
`teachers/registry.json` before training.

## Completed end-to-end calibration

The calibration has no mutable experiment, seed, instance-type, duration,
attempt, cadence, or price inputs. Those values come from the checked
`benchmarks/openblas-e2e-calibration-v1/budget.json` contract. GitHub Actions
only archives inputs, launches and observes EC2, enforces the independent
launch-relative deadline, downloads results, and terminates the instance. All
measured computation runs on EC2. An atomic S3 lock limits the authorization
to one execution.

The diagnostic driver records separate timings for cold start and build,
baseline replay evaluations, optimizer transactions, four recovery/sentinel
evaluations, one full evaluation, checkpoint copies, and verification. A
bounded result shows the serial quantity evaluator dominates end-to-end cost.
The planning estimate is about 7h46m/$5.28 per seed before contingency. Q2.6-R
still requires a new combined budget and manual authorization.

## Completed pilot lifecycle

The pilot has no mutable experiment, seed, instance-type, duration, attempt, or
price inputs. Those values come from the checked
`benchmarks/openblas-pilot-v1/budget.json` contract:

- one `c6i.4xlarge` in `us-east-1`;
- OpenBLAS with 16 threads;
- diagnostic seed 89 and no more than 100 optimizer attempts;
- 900 seconds and $0.17 maximum instance compute; and
- 840 seconds maximum workload time, preserving publication time.

GitHub Actions only archives inputs, launches EC2, observes S3, enforces the
launch-relative deadline, downloads the result, and terminates the instance.
The measured computation runs on EC2. EC2 user data starts an independent
900-second shutdown watchdog, while the workload owns a third shorter
deadline. The schema sets `scientific_inference_allowed` to false.

Run `30005889393` completed 97 attempts in 776 seconds after an 89-second cold
start. Sustained throughput was 0.125 attempts/second, projecting the full
1,400-attempt workload at 11,200 seconds and $2.1156, excluding cold start.
The `COMPLETED` sentinel and atomic S3 lock close this workflow. A full run
requires a new authorization and executable budget.

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
