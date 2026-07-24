#!/bin/bash
# EC2 bootstrap for the bounded score-sealed ZERO-EVAL-1 calibration.

set -Eeuo pipefail

HARD_INSTANCE_SECONDS=600
HARD_WORKLOAD_SECONDS=540
BOOTSTRAP_LOG=/var/log/zero-eval1-calibration-bootstrap.log
BOOTSTRAP_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

exec > >(tee -a "$BOOTSTRAP_LOG" >/dev/console) 2>&1
set -x

(
  sleep "$HARD_INSTANCE_SECONDS"
  echo "ZERO-EVAL-1 calibration local instance deadline reached"
  shutdown -h now
) &

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1 &&
      [ -n "${ZERO_BUCKET:-}" ] && [ -n "${ZERO_RUN_ID:-}" ]; then
    aws s3 cp "$BOOTSTRAP_LOG" \
      "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-eval1-calibration-bootstrap.log" \
      --no-cli-pager
    if [ "$exit_code" -ne 0 ] &&
        ! aws s3api head-object \
          --bucket "$ZERO_BUCKET" \
          --key "jobs/${ZERO_RUN_ID}/status.json" \
          --no-cli-pager >/dev/null 2>&1; then
      jq -n \
        --arg status infrastructure-error \
        --arg phase bootstrap-or-workload-hard-limit \
        --argjson exit_code "$exit_code" \
        --arg started_at "$BOOTSTRAP_STARTED_AT" \
        --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg git_commit "${ZERO_COMMIT:-}" \
        --arg budget_sha256 "${ZERO_BUDGET_SHA256:-}" \
        '{
          schema: "zero.aws_external_eval_calibration_status.v1",
          status: $status,
          phase: $phase,
          exit_code: $exit_code,
          started_at: $started_at,
          finished_at: $finished_at,
          git_commit: $git_commit,
          budget_sha256: $budget_sha256,
          scientific_inference_allowed: false
        }' > /tmp/zero-eval1-bootstrap-status.json
      aws s3 cp /tmp/zero-eval1-bootstrap-status.json \
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
  build-essential ca-certificates curl jq nodejs npm unzip

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
ZERO_WORKLOAD_SHA256="$(tag WorkloadSha256)"
ZERO_LAUNCH_EPOCH="$(tag LaunchEpoch)"
ZERO_MAX_INSTANCE_SECONDS="$(tag MaxInstanceSeconds)"
ZERO_WORKLOAD_TIMEOUT_SECONDS="$(tag WorkloadTimeoutSeconds)"
ZERO_MAX_COMPUTE_USD="$(tag MaxComputeUsd)"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_COMMIT ZERO_BUDGET_FILE ZERO_BUDGET_SHA256
export ZERO_WORKLOAD_SHA256
export ZERO_LAUNCH_EPOCH ZERO_MAX_INSTANCE_SECONDS
export ZERO_WORKLOAD_TIMEOUT_SECONDS ZERO_MAX_COMPUTE_USD AWS_DEFAULT_REGION

test "$ZERO_MAX_INSTANCE_SECONDS" = "$HARD_INSTANCE_SECONDS"
test "$ZERO_WORKLOAD_TIMEOUT_SECONDS" = "$HARD_WORKLOAD_SECONDS"
test "$ZERO_BUDGET_FILE" = \
  "benchmarks/zero-eval-1/aws-calibration/budget.json"
test "$ZERO_MAX_COMPUTE_USD" = "0.12"
[[ "$ZERO_LAUNCH_EPOCH" =~ ^[0-9]+$ ]]

install -d -m 0755 /opt/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-eval1-calibration.sh" \
  /opt/zero/zero-eval1-calibration.sh \
  --no-cli-pager
test "$(sha256sum /opt/zero/zero-eval1-calibration.sh | awk '{print $1}')" = \
  "$ZERO_WORKLOAD_SHA256"
chmod 0755 /opt/zero/zero-eval1-calibration.sh

now=$(date +%s)
ZERO_WORKLOAD_DEADLINE_EPOCH=$((ZERO_LAUNCH_EPOCH + HARD_WORKLOAD_SECONDS))
remaining=$((ZERO_WORKLOAD_DEADLINE_EPOCH - now))
if [ "$remaining" -le 0 ]; then
  jq -n \
    --arg status budget-exhausted \
    --arg phase cold-start \
    --argjson exit_code 124 \
    --arg started_at "$BOOTSTRAP_STARTED_AT" \
    --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg git_commit "$ZERO_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    '{
      schema: "zero.aws_external_eval_calibration_status.v1",
      status: $status,
      phase: $phase,
      exit_code: $exit_code,
      started_at: $started_at,
      finished_at: $finished_at,
      git_commit: $git_commit,
      budget_sha256: $budget_sha256,
      scientific_inference_allowed: false
    }' > /tmp/zero-eval1-cold-start-status.json
  aws s3 cp /tmp/zero-eval1-cold-start-status.json \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
    --no-cli-pager
  exit 0
fi

export ZERO_WORKLOAD_DEADLINE_EPOCH
timeout --signal=TERM --kill-after=10s \
  "${remaining}s" /opt/zero/zero-eval1-calibration.sh
