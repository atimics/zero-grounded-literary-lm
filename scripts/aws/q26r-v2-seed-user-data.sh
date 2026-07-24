#!/bin/bash
# EC2 bootstrap for one independently bounded Q2.6-R replacement seed.

set -Eeuo pipefail

HARD_INSTANCE_SECONDS=6300
HARD_WORKLOAD_SECONDS=6180
PUBLICATION_RESERVE_SECONDS=120
BOOTSTRAP_LOG=/var/log/zero-q26r-v2-bootstrap.log
BOOTSTRAP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec > >(tee -a "$BOOTSTRAP_LOG" >/dev/console) 2>&1
set -x

# Fail closed even if the metadata bootstrap itself cannot initialize.
trap 'shutdown -h now' EXIT

# Anchor the watchdog to the control-plane launch timestamp before package
# installation. Capture the AWS instance ID from IMDS, not from a mutable tag.
read -r BOOT_LAUNCH_EPOCH BOOT_INSTANCE_ID < <(python3 - <<'PY'
from urllib.request import Request, urlopen

root = "http://169.254.169.254/latest"
request = Request(
    f"{root}/api/token",
    method="PUT",
    headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"},
)
with urlopen(request, timeout=5) as response:
    token = response.read().decode()

def get(path):
    request = Request(
        f"{root}/{path}",
        headers={"X-aws-ec2-metadata-token": token},
    )
    with urlopen(request, timeout=5) as response:
        return response.read().decode()

print(
    get("meta-data/tags/instance/LaunchEpoch"),
    get("meta-data/instance-id"),
)
PY
)
[[ "$BOOT_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
[[ "$BOOT_INSTANCE_ID" =~ ^i-[0-9a-f]+$ ]]
watchdog_seconds=$((BOOT_LAUNCH_EPOCH + HARD_INSTANCE_SECONDS - $(date +%s)))
if [ "$watchdog_seconds" -le 0 ]; then
  shutdown -h now
  exit 124
fi
(
  sleep "$watchdog_seconds"
  echo "Q2.6-R AWS v2 local instance deadline reached"
  shutdown -h now
) &

write_shutdown_intent() {
  local_status=$1
  requested_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  status_sha256=$(sha256sum "$local_status" | awk '{print $1}')
  ZERO_REQUESTED_AT="$requested_at" ZERO_STATUS_SHA256="$status_sha256" \
    python3 - <<'PY'
import json
import os

record = {
    "schema": "zero.aws_q26r_shutdown_intent.v2",
    "experiment": "zero4-q26r-aws-v2",
    "seed": int(os.environ["ZERO_SEED"]),
    "instance_id": os.environ["ZERO_INSTANCE_ID"],
    "ci_run_id": os.environ["ZERO_RUN_ID"],
    "git_commit": os.environ["ZERO_COMMIT"],
    "budget_sha256": os.environ["ZERO_BUDGET_SHA256"],
    "status_sha256": os.environ["ZERO_STATUS_SHA256"],
    "requested_at": os.environ["ZERO_REQUESTED_AT"],
    "action": "instance-initiated-shutdown",
    "configured_shutdown_behavior": "terminate",
}
with open("/tmp/zero-q26r-v2-shutdown-intent.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
  aws s3api put-object \
    --bucket "$ZERO_BUCKET" \
    --key "jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/shutdown-intent.json" \
    --body /tmp/zero-q26r-v2-shutdown-intent.json \
    --content-type application/json \
    --if-none-match '*' \
    --no-cli-pager >/dev/null
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1 \
      && [ -n "${ZERO_BUCKET:-}" ] \
      && [ -n "${ZERO_RUN_ID:-}" ] \
      && [ -n "${ZERO_SEED:-}" ]; then
    aws s3 cp "$BOOTSTRAP_LOG" \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/zero-q26r-v2-bootstrap.log" \
      --no-cli-pager
    local_status="/tmp/zero-q26r-v2-seed${ZERO_SEED}-status.json"
    if ! aws s3api head-object \
        --bucket "$ZERO_BUCKET" \
        --key "jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/status.json" \
        --no-cli-pager >/dev/null 2>&1; then
      finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      finished_epoch=$(date +%s)
      run_status=infrastructure-error
      case "$exit_code" in
        124|137|143) run_status=budget-exhausted ;;
      esac
      ZERO_EXIT_CODE="$exit_code" ZERO_FINISHED_AT="$finished_at" \
        ZERO_FINISHED_EPOCH="$finished_epoch" ZERO_RUN_STATUS="$run_status" \
        STATUS_FILE="$local_status" python3 - <<'PY'
import json
import os

elapsed = max(
    0,
    int(os.environ["ZERO_FINISHED_EPOCH"])
    - int(os.environ["ZERO_LAUNCH_EPOCH"]),
)
record = {
    "schema": "zero.aws_q26r_seed_status.v2",
    "experiment": "zero4-q26r-aws-v2",
    "seed": int(os.environ["ZERO_SEED"]),
    "instance_id": os.environ["ZERO_INSTANCE_ID"],
    "status": os.environ["ZERO_RUN_STATUS"],
    "phase": "bootstrap-or-workload-hard-limit",
    "exit_code": int(os.environ["ZERO_EXIT_CODE"]),
    "started_at": os.environ["BOOTSTRAP_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "git_commit": os.environ.get("ZERO_COMMIT", ""),
    "budget_sha256": os.environ.get("ZERO_BUDGET_SHA256", ""),
    "scientific_result_available": False,
    "observed_instance_seconds": elapsed,
    "max_instance_seconds": int(os.environ["HARD_INSTANCE_SECONDS"]),
    "max_compute_usd": float(os.environ["ZERO_MAX_COMPUTE_USD"]),
}
with open(os.environ["STATUS_FILE"], "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
      aws s3api put-object \
        --bucket "$ZERO_BUCKET" \
        --key "jobs/${ZERO_RUN_ID}/seed${ZERO_SEED}/status.json" \
        --body "$local_status" \
        --content-type application/json \
        --if-none-match '*' \
        --no-cli-pager >/dev/null
    fi
    if [ -s "$local_status" ]; then
      write_shutdown_intent "$local_status" || true
    fi
  fi
  shutdown -h now
  exit "$exit_code"
}
export BOOTSTRAP_STARTED_AT HARD_INSTANCE_SECONDS
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
ZERO_EXECUTION_ID="$(tag Experiment)"
ZERO_BUDGET_FILE="$(tag BudgetFile)"
ZERO_BUDGET_SHA256="$(tag BudgetSha256)"
ZERO_SOURCE_SHA256="$(tag SourceArchiveSha256)"
ZERO_LAUNCH_EPOCH="$(tag LaunchEpoch)"
ZERO_MAX_INSTANCE_SECONDS="$(tag MaxInstanceSeconds)"
ZERO_WORKLOAD_TIMEOUT_SECONDS="$(tag WorkloadTimeoutSeconds)"
ZERO_MAX_COMPUTE_USD="$(tag MaxComputeUsd)"
ZERO_HOURLY_RATE_USD="$(tag HourlyRateUsd)"
ZERO_INSTANCE_ID="$BOOT_INSTANCE_ID"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_COMMIT ZERO_SEED ZERO_EXECUTION_ID
export ZERO_BUDGET_FILE ZERO_BUDGET_SHA256 ZERO_LAUNCH_EPOCH
export ZERO_SOURCE_SHA256
export ZERO_MAX_INSTANCE_SECONDS ZERO_WORKLOAD_TIMEOUT_SECONDS
export ZERO_MAX_COMPUTE_USD ZERO_HOURLY_RATE_USD ZERO_INSTANCE_ID
export AWS_DEFAULT_REGION

case "$ZERO_SEED" in 1|3) ;; *) exit 1 ;; esac
test "$ZERO_EXECUTION_ID" = "zero4-q26r-aws-v2"
test "$ZERO_MAX_INSTANCE_SECONDS" = "$HARD_INSTANCE_SECONDS"
test "$ZERO_WORKLOAD_TIMEOUT_SECONDS" = "$HARD_WORKLOAD_SECONDS"
test "$ZERO_BUDGET_FILE" = "benchmarks/zero4-q26r-v1/aws-v2/budget.json"
test "$ZERO_MAX_COMPUTE_USD" = "1.19"
[[ "$ZERO_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
test "$ZERO_LAUNCH_EPOCH" = "$BOOT_LAUNCH_EPOCH"

install -d -m 0755 /opt/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/q26r-v2-seed.sh" \
  /opt/zero/q26r-v2-seed.sh \
  --no-cli-pager
chmod 0755 /opt/zero/q26r-v2-seed.sh

# Reserve 120 seconds for durable status, shutdown-intent publication, and
# instance-initiated termination within the absolute launch-relative cap.
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
  "${remaining}s" /opt/zero/q26r-v2-seed.sh
