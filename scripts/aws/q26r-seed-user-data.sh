#!/bin/bash
# EC2 bootstrap for one independently bounded Q2.6-R replication seed.

set -Eeuo pipefail

HARD_INSTANCE_SECONDS=13620
HARD_WORKLOAD_SECONDS=13500
PUBLICATION_RESERVE_SECONDS=120
BOOTSTRAP_LOG=/var/log/zero-q26r-bootstrap.log
BOOTSTRAP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec > >(tee -a "$BOOTSTRAP_LOG" >/dev/console) 2>&1
set -x

# Fail closed even if the metadata bootstrap itself cannot initialize.
trap 'shutdown -h now' EXIT

# The watchdog is anchored to the control-plane launch timestamp before any
# package installation. It is local to this seed, cannot borrow time from the
# other seed, and remains effective if every external observer disappears.
BOOT_LAUNCH_EPOCH=$(python3 - <<'PY'
from urllib.request import Request, urlopen

root = "http://169.254.169.254/latest"
request = Request(
    f"{root}/api/token",
    method="PUT",
    headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
)
with urlopen(request, timeout=5) as response:
    token = response.read().decode()
request = Request(
    f"{root}/meta-data/tags/instance/LaunchEpoch",
    headers={"X-aws-ec2-metadata-token": token},
)
with urlopen(request, timeout=5) as response:
    print(response.read().decode())
PY
)
[[ "$BOOT_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
watchdog_seconds=$((BOOT_LAUNCH_EPOCH + HARD_INSTANCE_SECONDS - $(date +%s)))
if [ "$watchdog_seconds" -le 0 ]; then
  shutdown -h now
  exit 124
fi
(
  sleep "$watchdog_seconds"
  echo "Q2.6-R local instance deadline reached"
  shutdown -h now
) &

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1 \
      && [ -n "${ZERO_BUCKET:-}" ] \
      && [ -n "${ZERO_RUN_ID:-}" ] \
      && [ -n "${ZERO_SEED:-}" ]; then
    aws s3 cp "$BOOTSTRAP_LOG" \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/zero-q26r-bootstrap.log" \
      --no-cli-pager
    if ! aws s3api head-object \
        --bucket "$ZERO_BUCKET" \
        --key "jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/status.json" \
        --no-cli-pager >/dev/null 2>&1; then
      finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      run_status=infrastructure-error
      case "$exit_code" in
        124|137|143) run_status=budget-exhausted ;;
      esac
      ZERO_EXIT_CODE="$exit_code" ZERO_FINISHED_AT="$finished_at" \
        ZERO_RUN_STATUS="$run_status" python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.aws_q26r_seed_status.v1",
    "experiment": "zero4-q26r-aws-v1",
    "seed": int(os.environ["ZERO_SEED"]),
    "status": os.environ["ZERO_RUN_STATUS"],
    "phase": "bootstrap-or-workload-hard-limit",
    "exit_code": int(os.environ["ZERO_EXIT_CODE"]),
    "started_at": os.environ["BOOTSTRAP_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ.get("ZERO_COMMIT", ""),
    "budget_sha256": os.environ.get("ZERO_BUDGET_SHA256", ""),
    "scientific_result_available": False,
}
with open("/tmp/zero-q26r-bootstrap-status.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
      aws s3 cp /tmp/zero-q26r-bootstrap-status.json \
        "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/status.json" \
        --no-cli-pager
    fi
  fi
  shutdown -h now
  exit "$exit_code"
}
export BOOTSTRAP_STARTED_AT
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  build-essential ca-certificates curl jq libopenblas-dev nodejs npm \
  pkg-config python3 unzip

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
ZERO_SEED="$(tag Seed)"
ZERO_BUDGET_FILE="$(tag BudgetFile)"
ZERO_BUDGET_SHA256="$(tag BudgetSha256)"
ZERO_LAUNCH_EPOCH="$(tag LaunchEpoch)"
ZERO_MAX_INSTANCE_SECONDS="$(tag MaxInstanceSeconds)"
ZERO_WORKLOAD_TIMEOUT_SECONDS="$(tag WorkloadTimeoutSeconds)"
ZERO_MAX_COMPUTE_USD="$(tag MaxComputeUsd)"
ZERO_HOURLY_RATE_USD="$(tag HourlyRateUsd)"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_COMMIT ZERO_SEED
export ZERO_BUDGET_FILE ZERO_BUDGET_SHA256 ZERO_LAUNCH_EPOCH
export ZERO_MAX_INSTANCE_SECONDS ZERO_WORKLOAD_TIMEOUT_SECONDS
export ZERO_MAX_COMPUTE_USD ZERO_HOURLY_RATE_USD AWS_DEFAULT_REGION

case "$ZERO_SEED" in 1|3) ;; *) exit 1 ;; esac
test "$ZERO_MAX_INSTANCE_SECONDS" = "$HARD_INSTANCE_SECONDS"
test "$ZERO_WORKLOAD_TIMEOUT_SECONDS" = "$HARD_WORKLOAD_SECONDS"
test "$ZERO_BUDGET_FILE" = "benchmarks/zero4-q26r-v1/aws-v1/budget.json"
test "$ZERO_MAX_COMPUTE_USD" = "2.58"
[[ "$ZERO_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
test "$ZERO_LAUNCH_EPOCH" = "$BOOT_LAUNCH_EPOCH"

install -d -m 0755 /opt/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/q26r-seed.sh" \
  /opt/zero/q26r-seed.sh \
  --no-cli-pager
chmod 0755 /opt/zero/q26r-seed.sh

# Cold start consumes the seed's fixed budget. Reserve 120 seconds for durable
# S3 publication and shutdown within the absolute launch-relative cap.
now=$(date +%s)
remaining=$((ZERO_LAUNCH_EPOCH
  + HARD_INSTANCE_SECONDS
  - now
  - PUBLICATION_RESERVE_SECONDS))
if [ "$remaining" -gt "$HARD_WORKLOAD_SECONDS" ]; then
  remaining=$HARD_WORKLOAD_SECONDS
fi
if [ "$remaining" -le 30 ]; then
  exit 124
fi

ZERO_WORKLOAD_DEADLINE_EPOCH=$((now + remaining - 20))
export ZERO_WORKLOAD_DEADLINE_EPOCH
timeout --signal=TERM --kill-after=20s \
  "${remaining}s" /opt/zero/q26r-seed.sh
