#!/bin/bash
# EC2 bootstrap for the bounded Q2.6 end-to-end OpenBLAS calibration.

set -Eeuo pipefail

HARD_INSTANCE_SECONDS=1500
HARD_WORKLOAD_SECONDS=1440
HARD_MAX_ATTEMPTS=100
BOOTSTRAP_LOG=/var/log/zero-q26-e2e-calibration-bootstrap.log
BOOTSTRAP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec > >(tee -a "$BOOTSTRAP_LOG" >/dev/console) 2>&1
set -x

# GitHub independently enforces the launch-relative cap. This local watchdog
# protects the budget if the control-plane observer fails.
(
  sleep "$HARD_INSTANCE_SECONDS"
  echo "Q2.6 end-to-end calibration local instance deadline reached"
  shutdown -h now
) &

finish() {
  exit_code=$?
  trap - EXIT
  set +e

  if command -v aws >/dev/null 2>&1 \
      && [ -n "${ZERO_BUCKET:-}" ] \
      && [ -n "${ZERO_RUN_ID:-}" ]; then
    aws s3 cp "$BOOTSTRAP_LOG" \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-q26-e2e-calibration-bootstrap.log" \
      --no-cli-pager
    if [ "$exit_code" -ne 0 ] \
        && ! aws s3api head-object \
          --bucket "$ZERO_BUCKET" \
          --key "jobs/${ZERO_RUN_ID}/status.json" \
          --no-cli-pager >/dev/null 2>&1; then
      finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      ZERO_EXIT_CODE="$exit_code" ZERO_STARTED_AT="$BOOTSTRAP_STARTED_AT" \
        ZERO_FINISHED_AT="$finished_at" python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.aws_q26_e2e_calibration_status.v1",
    "status": "infrastructure-error",
    "phase": "bootstrap-or-workload-hard-limit",
    "exit_code": int(os.environ["ZERO_EXIT_CODE"]),
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ.get("ZERO_COMMIT", ""),
    "budget_sha256": os.environ.get("ZERO_BUDGET_SHA256", ""),
    "scientific_inference_allowed": False,
}
with open("/tmp/zero-q26-e2e-status.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
      aws s3 cp /tmp/zero-q26-e2e-status.json \
        "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
        --no-cli-pager
    fi
  fi

  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  build-essential ca-certificates curl libopenblas-dev nodejs npm pkg-config \
  python3 unzip

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
ZERO_COMMIT="$(tag Commit)"
ZERO_BUDGET_FILE="$(tag BudgetFile)"
ZERO_BUDGET_SHA256="$(tag BudgetSha256)"
ZERO_LAUNCH_EPOCH="$(tag LaunchEpoch)"
ZERO_MAX_INSTANCE_SECONDS="$(tag MaxInstanceSeconds)"
ZERO_WORKLOAD_TIMEOUT_SECONDS="$(tag WorkloadTimeoutSeconds)"
ZERO_MAX_ATTEMPTS="$(tag MaxOptimizerAttempts)"
ZERO_MAX_COMPUTE_USD="$(tag MaxComputeUsd)"
ZERO_HOURLY_RATE_USD="$(tag HourlyRateUsd)"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_COMMIT ZERO_BUDGET_FILE ZERO_BUDGET_SHA256
export ZERO_LAUNCH_EPOCH ZERO_MAX_INSTANCE_SECONDS
export ZERO_WORKLOAD_TIMEOUT_SECONDS ZERO_MAX_ATTEMPTS
export ZERO_MAX_COMPUTE_USD ZERO_HOURLY_RATE_USD
export AWS_DEFAULT_REGION

test "$ZERO_MAX_INSTANCE_SECONDS" = "$HARD_INSTANCE_SECONDS"
test "$ZERO_WORKLOAD_TIMEOUT_SECONDS" = "$HARD_WORKLOAD_SECONDS"
test "$ZERO_MAX_ATTEMPTS" = "$HARD_MAX_ATTEMPTS"
test "$ZERO_BUDGET_FILE" = \
  "benchmarks/openblas-e2e-calibration-v1/budget.json"
test "$ZERO_MAX_COMPUTE_USD" = "0.29"
[[ "$ZERO_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]

install -d -m 0755 /opt/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/q26-e2e-calibration.sh" \
  /opt/zero/q26-e2e-calibration.sh \
  --no-cli-pager
chmod 0755 /opt/zero/q26-e2e-calibration.sh

# Reserve 20 seconds before the launch-relative deadline for S3 publication
# and shutdown. Slow bootstrap consumes measurement time, never extra budget.
now=$(date +%s)
remaining=$((ZERO_LAUNCH_EPOCH + HARD_INSTANCE_SECONDS - now - 20))
if [ "$remaining" -gt "$HARD_WORKLOAD_SECONDS" ]; then
  remaining=$HARD_WORKLOAD_SECONDS
fi
if [ "$remaining" -le 15 ]; then
  echo "Cold start exhausted the calibration budget before workload launch"
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ZERO_FINISHED_AT="$finished_at" python3 - <<'PY'
import json
import os

status = {
    "schema": "zero.aws_q26_e2e_calibration_status.v1",
    "status": "budget-exhausted",
    "phase": "cold-start",
    "exit_code": 124,
    "started_at": "",
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
    "scientific_inference_allowed": False,
}
with open("/tmp/zero-q26-e2e-status.json", "w", encoding="utf-8") as handle:
    json.dump(status, handle, indent=2)
    handle.write("\n")
PY
  aws s3 cp /tmp/zero-q26-e2e-status.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
    --no-cli-pager
  exit 0
fi

ZERO_WORKLOAD_DEADLINE_EPOCH=$((now + remaining - 15))
export ZERO_WORKLOAD_DEADLINE_EPOCH
timeout --signal=TERM --kill-after=10s \
  "${remaining}s" /opt/zero/q26-e2e-calibration.sh
