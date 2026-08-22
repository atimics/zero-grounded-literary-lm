#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/sero-latent-v3-bootstrap.log
exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1
set -x

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' \
  "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error \
    --header "X-aws-ec2-metadata-token: $TOKEN" \
    "$IMDS/meta-data/$1"
}
tag() { metadata "tags/instance/$1"; }

RUN_ID=$(tag RunId)
MODE=$(tag Mode)
SEED=$(tag Seed)
SOURCE_COMMIT=$(tag Commit)
SOURCE_KEY=$(tag SourceKey)
SOURCE_SHA256=$(tag SourceSha256)
TRAINING_BUCKET=$(tag TrainingBucket)
CORPUS_BUCKET=$(tag CorpusBucket)
DATASET_PREFIX=$(tag DatasetPrefix)
DATASET_DIGEST=$(tag DatasetDigest)
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
RESULT_PREFIX="experiments/sero-latent-v3/${RUN_ID}"
STATUS_FILE=/tmp/sero-latent-v3-status.json

export AWS_DEFAULT_REGION SERO_SOURCE_COMMIT="$SOURCE_COMMIT"

test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = g5.xlarge
test "$DATASET_DIGEST" = 6919a2a55495ff3364381d0861f6295412362f6dcf5fff46fda751b779a6d6b6
test "$HOURLY_PRICE" = 1.006
[[ "$RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$MODE" =~ ^(calibration|full)$ ]]
[[ "$SEED" =~ ^[012]$ ]]
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
[[ "$MAX_INSTANCE_SECONDS" =~ ^[0-9]+$ ]]
awk -v seconds="$MAX_INSTANCE_SECONDS" 'BEGIN { exit !(seconds > 0 && seconds <= 25200) }'
awk -v cost="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost > 0 && cost <= 7.042) }'
if [ "$MODE" = calibration ]; then
  test "$MAX_INSTANCE_SECONDS" = 3600
  test "$MAX_COMPUTE_USD" = 1.006
else
  test "$MAX_INSTANCE_SECONDS" = 25200
  test "$MAX_COMPUTE_USD" = 7.042
fi

remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s)))
test "$remaining" -gt 0
( sleep "$remaining"; shutdown -h now ) &

PHASE=bootstrap
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

elapsed_seconds() {
  value=$(($(date +%s) - LAUNCH_EPOCH))
  test "$value" -ge 0
  printf '%s\n' "$value"
}

estimated_cost() {
  awk -v seconds="$1" -v price="$HOURLY_PRICE" \
    'BEGIN { printf "%.12f", seconds * price / 3600 }'
}

write_status() {
  status=$1
  exit_code=$2
  result_key=${3:-}
  result_sha256=${4:-}
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  jq -n --arg status "$status" --arg phase "$PHASE" --arg mode "$MODE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg instance_type "$INSTANCE_TYPE" --arg git_commit "$SOURCE_COMMIT" \
    --arg dataset_digest "$DATASET_DIGEST" --arg started_at "$STARTED_AT" \
    --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --argjson seed "$SEED" --argjson exit_code "$exit_code" \
    --argjson elapsed "$elapsed" --argjson cost "$cost" \
    '{
      schema: "sero.latent_v3_aws_status.v1",
      status: $status,
      phase: $phase,
      mode: $mode,
      run_id: $run_id,
      seed: $seed,
      instance_id: $instance_id,
      instance_type: $instance_type,
      git_commit: $git_commit,
      dataset_digest: $dataset_digest,
      started_at: $started_at,
      finished_at: $finished_at,
      exit_code: $exit_code,
      elapsed_instance_seconds: $elapsed,
      estimated_ec2_usd: $cost,
      result_key: (if $result_key == "" then null else $result_key end),
      result_sha256: (if $result_sha256 == "" then null else $result_sha256 end)
    }' > "$STATUS_FILE"
}

upload_status() {
  aws s3 cp "$STATUS_FILE" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" --only-show-errors
}

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$BOOT_LOG" \
      "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/bootstrap.log" --only-show-errors
    if [ "$exit_code" -ne 0 ]; then
      PHASE=${PHASE:-bootstrap}
      write_status failed "$exit_code"
      upload_status
    fi
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl jq python3 python3-venv unzip
if ! command -v aws >/dev/null 2>&1; then
  AWS_CLI_VERSION=2.34.7
  AWS_CLI_SHA256=d6b6e2291456704a441e970bbdb69466629510dd0b578e8812f7856ac64abba1
  curl --fail --silent --show-error --location \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
    --output /tmp/awscliv2.zip
  echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum --check
  unzip -q /tmp/awscliv2.zip -d /tmp/awscliv2
  /tmp/awscliv2/aws/install --bin-dir /usr/local/bin --install-dir /usr/local/aws-cli
fi

PHASE=source
write_status running 0
upload_status
install -d -m 0755 /opt/sero/repo
aws s3 cp "s3://${TRAINING_BUCKET}/${SOURCE_KEY}" /tmp/sero-source.tar.gz --only-show-errors
test "$(sha256sum /tmp/sero-source.tar.gz | awk '{print $1}')" = "$SOURCE_SHA256"
tar -xzf /tmp/sero-source.tar.gz -C /opt/sero/repo
cd /opt/sero/repo
test "$(cat SOURCE_COMMIT)" = "$SOURCE_COMMIT"

PHASE=dataset
write_status running 0
upload_status
install -d -m 0755 build/sero-pretrain-v1
aws s3 sync "s3://${CORPUS_BUCKET}/${DATASET_PREFIX}" build/sero-pretrain-v1 \
  --only-show-errors
python3 scripts/verify_zero_dataset.py --root build/sero-pretrain-v1 \
  --digest "$DATASET_DIGEST"

PHASE=environment
write_status running 0
upload_status
python3 -m venv build/sero-latent-v3/aws-venv
build/sero-latent-v3/aws-venv/bin/pip install --disable-pip-version-check \
  --no-input -r experiments/sero-latent-v3/requirements.txt
nvidia-smi > build/sero-latent-v3/nvidia-smi.txt
build/sero-latent-v3/aws-venv/bin/python - <<'PY'
import torch
if not torch.cuda.is_available():
    raise RuntimeError("CUDA is unavailable")
print(torch.cuda.get_device_name(0))
PY
build/sero-latent-v3/aws-venv/bin/pip freeze \
  > build/sero-latent-v3/aws-pip-freeze.txt
build/sero-latent-v3/aws-venv/bin/python experiments/sero-latent-v3/tests.py \
  --manifest build/sero-pretrain-v1/manifest.json

PHASE=training
write_status running 0
upload_status
if [ "$MODE" = calibration ]; then
  RESULT_FILE=build/sero-latent-v3/aws-calibration/seed0.json
  ARTIFACT_DIR=build/sero-latent-v3/aws-calibration/artifacts
  TRAIN_ARGS=(--budgets 1048576 --validation-byte-limit 131072)
else
  RESULT_FILE="benchmarks/sero-latent-v3/seed${SEED}.json"
  ARTIFACT_DIR="build/sero-latent-v3/seed${SEED}"
  TRAIN_ARGS=()
fi
mkdir -p "$(dirname "$RESULT_FILE")" "$ARTIFACT_DIR"
remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 180))
test "$remaining" -gt 0
timeout --signal=TERM --kill-after=30s "${remaining}s" \
  build/sero-latent-v3/aws-venv/bin/python experiments/sero-latent-v3/train.py \
    --manifest build/sero-pretrain-v1/manifest.json \
    --output "$RESULT_FILE" --artifact-dir "$ARTIFACT_DIR" \
    --seed "$SEED" --device cuda "${TRAIN_ARGS[@]}"

PHASE=publication
RESULT_KEY="${RESULT_PREFIX}/result.json"
RESULT_SHA256=$(sha256sum "$RESULT_FILE" | awk '{print $1}')
aws s3 cp "$RESULT_FILE" "s3://${TRAINING_BUCKET}/${RESULT_KEY}" --only-show-errors
aws s3 sync "$ARTIFACT_DIR" \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/artifacts" --only-show-errors
aws s3 cp build/sero-latent-v3/nvidia-smi.txt \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/nvidia-smi.txt" --only-show-errors
aws s3 cp build/sero-latent-v3/aws-pip-freeze.txt \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/pip-freeze.txt" --only-show-errors
PHASE=complete
write_status complete 0 "$RESULT_KEY" "$RESULT_SHA256"
cost=$(jq -r .estimated_ec2_usd "$STATUS_FILE")
awk -v cost="$cost" -v ceiling="$MAX_COMPUTE_USD" \
  'BEGIN { exit !(cost <= ceiling) }'
upload_status

