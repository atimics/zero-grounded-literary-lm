#!/bin/bash
# EC2 bootstrap for the bounded Q2.7 diagnostic seed.

set -Eeuo pipefail

HARD_INSTANCE_SECONDS=6190
HARD_WORKLOAD_SECONDS=6130
PUBLICATION_RESERVE_SECONDS=60
BOOTSTRAP_LOG=/var/log/zero-q27-bootstrap.log
BOOTSTRAP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
test "$((HARD_WORKLOAD_SECONDS + PUBLICATION_RESERVE_SECONDS))" -eq \
  "$HARD_INSTANCE_SECONDS"

exec > >(tee -a "$BOOTSTRAP_LOG" >/dev/console) 2>&1
set -x
trap 'shutdown -h now' EXIT

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
[ "$watchdog_seconds" -gt 0 ] || exit 124
(
  sleep "$watchdog_seconds"
  shutdown -h now
) &

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
  --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli

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
ZERO_EXPERIMENT="$(tag Experiment)"
ZERO_BUDGET_FILE="$(tag BudgetFile)"
ZERO_BUDGET_SHA256="$(tag BudgetSha256)"
ZERO_WORKLOAD_SHA256="$(tag WorkloadSha256)"
ZERO_SOURCE_SHA256="$(tag SourceArchiveSha256)"
ZERO_LAUNCH_EPOCH="$(tag LaunchEpoch)"
ZERO_MAX_INSTANCE_SECONDS="$(tag MaxInstanceSeconds)"
ZERO_WORKLOAD_TIMEOUT_SECONDS="$(tag WorkloadTimeoutSeconds)"
ZERO_MAX_COMPUTE_USD="$(tag MaxComputeUsd)"
ZERO_HOURLY_RATE_USD="$(tag HourlyRateUsd)"
ZERO_INSTANCE_ID="$BOOT_INSTANCE_ID"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_COMMIT ZERO_EXPERIMENT
export ZERO_BUDGET_FILE ZERO_BUDGET_SHA256 ZERO_WORKLOAD_SHA256
export ZERO_SOURCE_SHA256 ZERO_LAUNCH_EPOCH ZERO_MAX_INSTANCE_SECONDS
export ZERO_WORKLOAD_TIMEOUT_SECONDS ZERO_MAX_COMPUTE_USD
export ZERO_HOURLY_RATE_USD ZERO_INSTANCE_ID AWS_DEFAULT_REGION

test "$ZERO_EXPERIMENT" = zero4-q27-aws-v1
test "$ZERO_BUDGET_FILE" = benchmarks/zero4-q27-v1/aws-v1/budget.json
test "$ZERO_MAX_INSTANCE_SECONDS" = "$HARD_INSTANCE_SECONDS"
test "$ZERO_WORKLOAD_TIMEOUT_SECONDS" = "$HARD_WORKLOAD_SECONDS"
test "$ZERO_MAX_COMPUTE_USD" = 1.17

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  aws s3 cp "$BOOTSTRAP_LOG" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/seed2/zero-q27-bootstrap.log" \
    --no-cli-pager
  if ! aws s3api head-object \
      --bucket "$ZERO_BUCKET" \
      --key "jobs/${ZERO_RUN_ID}/seed2/status.json" \
      --no-cli-pager >/dev/null 2>&1; then
    status=infrastructure-error
    case "$exit_code" in 124|137|143) status=budget-exhausted ;; esac
    finished_epoch=$(date +%s)
    jq -n \
      --arg status "$status" \
      --arg instance_id "$ZERO_INSTANCE_ID" \
      --arg git_commit "$ZERO_COMMIT" \
      --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
      --arg started_at "$BOOTSTRAP_STARTED_AT" \
      --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --argjson exit_code "$exit_code" \
      --argjson observed_instance_seconds \
        "$((finished_epoch - ZERO_LAUNCH_EPOCH))" \
      '{
        schema: "zero.aws_q27_seed2_status.v1",
        experiment: "zero4-q27-aws-v1",
        seed: 2,
        status: $status,
        phase: "bootstrap-or-workload-hard-limit",
        instance_id: $instance_id,
        git_commit: $git_commit,
        budget_sha256: $budget_sha256,
        started_at: $started_at,
        finished_at: $finished_at,
        exit_code: $exit_code,
        scientific_result_available: false,
        scientific_decision: null,
        result_sha256: null,
        observed_instance_seconds: $observed_instance_seconds,
        max_instance_seconds: 6190,
        max_compute_usd: 1.17
      }' > /tmp/zero-q27-bootstrap-status.json
    aws s3api put-object \
      --bucket "$ZERO_BUCKET" \
      --key "jobs/${ZERO_RUN_ID}/seed2/status.json" \
      --body /tmp/zero-q27-bootstrap-status.json \
      --content-type application/json \
      --if-none-match '*' --no-cli-pager >/dev/null
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

install -d -m 0755 /opt/zero
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/q27-seed2.sh" \
  /opt/zero/q27-seed2.sh --no-cli-pager
test "$(sha256sum /opt/zero/q27-seed2.sh | awk '{print $1}')" = \
  "$ZERO_WORKLOAD_SHA256"
chmod 0755 /opt/zero/q27-seed2.sh

ZERO_WORKLOAD_DEADLINE_EPOCH=$((ZERO_LAUNCH_EPOCH + HARD_WORKLOAD_SECONDS))
remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - $(date +%s)))
[ "$remaining" -gt 0 ] || exit 124
export ZERO_WORKLOAD_DEADLINE_EPOCH
timeout --signal=TERM --kill-after=15s \
  "${remaining}s" /opt/zero/q27-seed2.sh
