# AWS training runner

The AWS runner executes only frozen Q2.2-R or Q2.6-R replications for
outstanding seeds 1 and 3. It does not expose unfinished saturation
experiments. Q2.6-R always archives science commit
`3ee802c29ddf47982477a6b6dd635eaedede7bb7`; later workflow commits may change
orchestration, but cannot change the experiment source.

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

## Dispatch and lifecycle

Dispatch `.github/workflows/train.yml` with experiment `q22r` or `q26r` and
the declared `c6i.4xlarge` instance type. Q2.6-R requires one dispatch each for
seed `1` and seed `3`, giving each prospective run its own ephemeral instance;
Q2.2-R also retains its legacy `1,3` combined-dispatch option. The dispatch
workflow is intentionally short-lived:

1. uploads an immutable source archive and training script for the dispatched commit;
2. launches a tagged instance with the `zero-training-ec2` profile;
3. commits a launch receipt and exits.

AWS then owns the long-running phase. The instance executes the frozen
pipeline, evaluates promotion only when authorized, uploads both scientific
results and an explicit infrastructure status to S3, and terminates itself.
Its independent 11-hour wall-clock limit prevents an orphaned training process.

After the instance is terminal, dispatch
`.github/workflows/collect-training.yml` with the launch receipt values. This
short collection workflow refuses to wait on a running instance, validates the
immutable instance tags and remote status, runs the frozen result checker,
records source and collection provenance, and commits the result records.

A scientific no-go has exit status zero because it is a completed experiment.
Missing assets, invalid schemas, failed commands, or absent status records are
infrastructure errors and fail the workflow.

The GitHub role can use regional AMIs, subnets, security groups, network
interfaces, and volumes only as resources of `RunInstances`. The separately
authorized instance resource must carry `Project=zero` at launch, and the role
can terminate only instances carrying that tag.
