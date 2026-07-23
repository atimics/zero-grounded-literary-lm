#!/bin/bash
# Five-minute EC2 bootstrap for the budgeted OpenBLAS calibration.

set -Eeuo pipefail

HARD_INSTANCE_SECONDS=300
HARD_WORKLOAD_SECONDS=240
BOOTSTRAP_LOG=/var/log/zero-openblas-bootstrap.log
BOOTSTRAP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec > >(tee -a "$BOOTSTRAP_LOG" >/dev/console) 2>&1
set -x

# This watchdog is deliberately hard-coded in the source submitted to EC2. The
# GitHub observer independently enforces the same cap from launch-request time.
(
  sleep "$HARD_INSTANCE_SECONDS"
  echo "OpenBLAS calibration local instance deadline reached"
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
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-openblas-bootstrap.log" \
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
    "schema": "zero.aws_openblas_calibration_status.v1",
    "status": "infrastructure-error",
    "phase": "bootstrap-or-workload-hard-limit",
    "exit_code": int(os.environ["ZERO_EXIT_CODE"]),
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ.get("ZERO_COMMIT", ""),
    "budget_sha256": os.environ.get("ZERO_BUDGET_SHA256", ""),
    "scientific_inference_allowed": False,
}
with open("/tmp/zero-openblas-status.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
      aws s3 cp /tmp/zero-openblas-status.json \
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

# Ubuntu 24.04 does not publish the awscli apt package. Keep the same pinned,
# hash-verified AWS CLI bundle used by the historical training runner.
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
ZERO_BUDGET_SHA256="$(tag BudgetSha256)"
ZERO_LAUNCH_EPOCH="$(tag LaunchEpoch)"
ZERO_MAX_INSTANCE_SECONDS="$(tag MaxInstanceSeconds)"
ZERO_WORKLOAD_TIMEOUT_SECONDS="$(tag WorkloadTimeoutSeconds)"
ZERO_HOURLY_RATE_USD="$(tag HourlyRateUsd)"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_COMMIT ZERO_BUDGET_SHA256
export ZERO_LAUNCH_EPOCH ZERO_MAX_INSTANCE_SECONDS
export ZERO_WORKLOAD_TIMEOUT_SECONDS ZERO_HOURLY_RATE_USD
export AWS_DEFAULT_REGION

test "$ZERO_MAX_INSTANCE_SECONDS" = "$HARD_INSTANCE_SECONDS"
test "$ZERO_WORKLOAD_TIMEOUT_SECONDS" = "$HARD_WORKLOAD_SECONDS"
[[ "$ZERO_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]

install -d -m 0755 /opt/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/openblas-calibration.sh" \
  /opt/zero/openblas-calibration.sh \
  --no-cli-pager
chmod 0755 /opt/zero/openblas-calibration.sh

# Leave 20 seconds before the launch-relative deadline for S3 publication and
# shutdown. A slow cold start therefore consumes benchmark time instead of
# silently increasing the bill.
now=$(date +%s)
remaining=$((ZERO_LAUNCH_EPOCH + HARD_INSTANCE_SECONDS - now - 20))
if [ "$remaining" -gt "$HARD_WORKLOAD_SECONDS" ]; then
  remaining=$HARD_WORKLOAD_SECONDS
fi
if [ "$remaining" -le 15 ]; then
  echo "Cold start exhausted the five-minute budget before workload launch"
  mkdir -p /tmp/zero-openblas-cold-start
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  finished_epoch=$(date +%s)
  ZERO_FINISHED_AT="$finished_at" ZERO_FINISHED_EPOCH="$finished_epoch" \
    python3 - <<'PY'
import json
import os

elapsed = max(
    0, int(os.environ["ZERO_FINISHED_EPOCH"]) - int(os.environ["ZERO_LAUNCH_EPOCH"])
)
result = {
    "schema": "zero.openblas_calibration_result.v1",
    "id": "openblas-calibration-v1",
    "status": "budget-exhausted",
    "phase": "cold-start",
    "started_at": "",
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
    "scientific_inference_allowed": False,
    "venue": {
        "provider": "aws",
        "region": os.environ["AWS_DEFAULT_REGION"],
        "instance_type": "c6i.4xlarge",
        "backend": "not-observed",
        "openblas_threads": 16,
        "on_demand_usd_per_hour": float(os.environ["ZERO_HOURLY_RATE_USD"]),
    },
    "budget": {
        "max_instance_seconds": int(os.environ["ZERO_MAX_INSTANCE_SECONDS"]),
        "workload_timeout_seconds": int(os.environ["ZERO_WORKLOAD_TIMEOUT_SECONDS"]),
        "max_compute_usd": 0.06,
    },
    "measurement": {
        "seed": 89,
        "attempt_cap": 8,
        "completed_optimizer_attempts": 0,
        "training_wall_seconds": 0,
        "cold_start_seconds": elapsed,
        "total_observed_instance_seconds": elapsed,
        "training_exit_code": 124,
        "attempts_per_second": None,
    },
    "projection": {
        "target_optimizer_attempts": 1400,
        "estimated_wall_seconds": None,
        "estimated_compute_usd": None,
        "method": "unavailable because cold start exhausted the calibration budget",
    },
}
status = {
    "schema": "zero.aws_openblas_calibration_status.v1",
    "status": "budget-exhausted",
    "exit_code": 124,
    "started_at": "",
    "finished_at": result["finished_at"],
    "git_commit": result["git_commit"],
    "budget_sha256": result["budget_sha256"],
    "scientific_inference_allowed": False,
    "result": "results/result.json",
}
with open("/tmp/zero-openblas-cold-start/result.json", "w", encoding="utf-8") as handle:
    json.dump(result, handle, indent=2)
    handle.write("\n")
with open("/tmp/zero-openblas-cold-start/status.json", "w", encoding="utf-8") as handle:
    json.dump(status, handle, indent=2)
    handle.write("\n")
PY
  aws s3 cp /tmp/zero-openblas-cold-start/result.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/results/result.json" \
    --no-cli-pager
  aws s3 cp /tmp/zero-openblas-cold-start/status.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
    --no-cli-pager
  exit 0
fi
ZERO_WORKLOAD_DEADLINE_EPOCH=$((now + remaining - 15))
export ZERO_WORKLOAD_DEADLINE_EPOCH

timeout --signal=TERM --kill-after=10s \
  "${remaining}s" /opt/zero/openblas-calibration.sh
