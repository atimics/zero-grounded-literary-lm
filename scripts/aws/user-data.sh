#!/bin/bash
# EC2 bootstrap. Configuration is read from launch-time instance tags through IMDSv2.

set -euo pipefail

BOOTSTRAP_LOG=/var/log/zero-bootstrap.log
BOOTSTRAP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Keep bootstrap failures visible in both the instance console and the log that
# is copied to S3 when the AWS CLI is available.
exec > >(tee -a "$BOOTSTRAP_LOG" >/dev/console) 2>&1
set -x

finish() {
  exit_code=$?
  trap - EXIT
  if [ "$exit_code" -eq 0 ]; then
    exit 0
  fi

  set +e
  echo "ZERO bootstrap failed with exit code $exit_code"
  if command -v aws >/dev/null 2>&1 \
      && [ -n "${ZERO_BUCKET:-}" ] \
      && [ -n "${ZERO_RUN_ID:-}" ]; then
    finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    ZERO_EXIT_CODE="$exit_code" ZERO_STARTED_AT="$BOOTSTRAP_STARTED_AT" \
      ZERO_FINISHED_AT="$finished_at" python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.aws_training_status.v1",
    "status": "infrastructure-error",
    "phase": "bootstrap",
    "exit_code": int(os.environ["ZERO_EXIT_CODE"]),
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "experiment": os.environ.get("ZERO_EXPERIMENT", ""),
    "seeds": os.environ.get("ZERO_SEEDS", ""),
    "git_commit": os.environ.get("ZERO_COMMIT", ""),
}
with open("/tmp/zero-training-status.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
    aws s3 cp "$BOOTSTRAP_LOG" \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-bootstrap.log" \
      --no-cli-pager
    aws s3 cp /tmp/zero-training-status.json \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
      --no-cli-pager
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl python3 unzip

# Ubuntu 24.04 does not publish the awscli apt package. Pin and verify the
# official AWS CLI v2 bundle instead of relying on the mutable latest URL.
AWS_CLI_VERSION=2.34.7
AWS_CLI_SHA256=d6b6e2291456704a441e970bbdb69466629510dd0b578e8812f7856ac64abba1
curl --fail --silent --show-error --location \
  "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
  --output /tmp/awscliv2.zip
echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum --check
unzip -q /tmp/awscliv2.zip -d /tmp/awscliv2
/tmp/awscliv2/aws/install \
  --bin-dir /usr/local/bin \
  --install-dir /usr/local/aws-cli
aws --version

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' \
  "$IMDS/api/token")

tag() {
  curl --fail --silent --show-error \
    --header "X-aws-ec2-metadata-token: $TOKEN" \
    "$IMDS/meta-data/tags/instance/$1"
}

ZERO_BUCKET="$(tag Bucket)"
ZERO_RUN_ID="$(tag RunId)"
ZERO_EXPERIMENT="$(tag Experiment)"
ZERO_SEEDS="$(tag Seeds)"
ZERO_COMMIT="$(tag Commit)"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_EXPERIMENT ZERO_SEEDS ZERO_COMMIT
export AWS_DEFAULT_REGION

install -d -m 0755 /opt/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/train.sh" \
  /opt/zero/train.sh \
  --no-cli-pager
chmod 0755 /opt/zero/train.sh
# AWS owns the long-running phase. Keep its wall-clock cap independent of the
# short GitHub dispatch and collection workflows.
exec timeout --signal=TERM --kill-after=5m 11h /opt/zero/train.sh
