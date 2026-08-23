#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/sero2-curriculum-bootstrap.log
exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1
set -x

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --request PUT \
  --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error \
    --header "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/$1"
}
tag() { metadata "tags/instance/$1"; }

RUN_ID=$(tag RunId)
EXPERIMENT=$(tag Experiment)
MODE=$(tag Mode)
SEED=$(tag Seed)
SOURCE_COMMIT=$(tag Commit)
SOURCE_KEY=$(tag SourceKey)
SOURCE_SHA256=$(tag SourceSha256)
TRAINING_BUCKET=$(tag TrainingBucket)
CORPUS_BUCKET=$(tag CorpusBucket)
DATASET_PREFIX=$(tag DatasetPrefix)
DATASET_DIGEST=$(tag DatasetDigest)
RESUME_KEY=$(tag ResumeKey)
RESUME_SHA256=$(tag ResumeSha256)
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
RESULT_PREFIX="experiments/${EXPERIMENT}/${RUN_ID}"
STATUS_FILE=/tmp/sero2-curriculum-status.json

export AWS_DEFAULT_REGION SERO_SOURCE_COMMIT="$SOURCE_COMMIT"
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = g5.xlarge
test "$DATASET_DIGEST" = dcad26c0cc44f449d87eb8af0d62d0518dc120a62aad049ff541c2fc149a35d8
test "$HOURLY_PRICE" = 1.006
test "$SEED" = 0
[[ "$RUN_ID" =~ ^[a-z0-9-]{12,100}$ ]]
[[ "$EXPERIMENT" =~ ^sero2-curriculum(-consolidation)?-v1$ ]]
[[ "$MODE" =~ ^(calibration|full)$ ]]
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
[[ "$MAX_INSTANCE_SECONDS" =~ ^[0-9]+$ ]]
case "$MODE" in
  calibration)
    test "$MAX_INSTANCE_SECONDS" = 1800
    test "$MAX_COMPUTE_USD" = 0.503
    ;;
  full)
    if [ "$EXPERIMENT" = sero2-curriculum-consolidation-v1 ]; then
      test "$MAX_INSTANCE_SECONDS" = 7200
      test "$MAX_COMPUTE_USD" = 2.012
    else
      test "$MAX_INSTANCE_SECONDS" = 10800
      test "$MAX_COMPUTE_USD" = 3.018
    fi
    ;;
esac
if [ "$EXPERIMENT" = sero2-curriculum-consolidation-v1 ]; then
  test "$MODE" = calibration || test "$MODE" = full
  test "$RESUME_KEY" != none
  [[ "$RESUME_SHA256" =~ ^[0-9a-f]{64}$ ]]
fi

remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s)))
test "$remaining" -gt 0
( sleep "$remaining"; shutdown -h now ) &

PHASE=bootstrap
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
elapsed_seconds() { printf '%s\n' "$(($(date +%s) - LAUNCH_EPOCH))"; }
estimated_cost() {
  awk -v seconds="$1" -v price="$HOURLY_PRICE" \
    'BEGIN { printf "%.12f", seconds * price / 3600 }'
}
write_status() {
  status=$1
  exit_code=$2
  result_key=${3:-}
  result_sha256=${4:-}
  model_key=${5:-}
  model_sha256=${6:-}
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  jq -n --arg status "$status" --arg phase "$PHASE" --arg mode "$MODE" \
    --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg instance_type "$INSTANCE_TYPE" --arg git_commit "$SOURCE_COMMIT" \
    --arg dataset_digest "$DATASET_DIGEST" --arg started_at "$STARTED_AT" \
    --arg finished_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --arg model_key "$model_key" --arg model_sha256 "$model_sha256" \
    --argjson seed "$SEED" --argjson exit_code "$exit_code" \
    --argjson elapsed "$elapsed" --argjson cost "$cost" \
    '{schema:"sero.curriculum_pretrain_aws_status.v1",status:$status,phase:$phase,
      mode:$mode,run_id:$run_id,seed:$seed,instance_id:$instance_id,
      instance_type:$instance_type,git_commit:$git_commit,dataset_digest:$dataset_digest,
      started_at:$started_at,finished_at:$finished_at,exit_code:$exit_code,
      elapsed_instance_seconds:$elapsed,estimated_ec2_usd:$cost,
      result_key:(if $result_key=="" then null else $result_key end),
      result_sha256:(if $result_sha256=="" then null else $result_sha256 end),
      model_key:(if $model_key=="" then null else $model_key end),
      model_artifact_sha256:(if $model_sha256=="" then null else $model_sha256 end)}' \
    > "$STATUS_FILE"
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
install -d -m 0755 build/sero-pretrain-curriculum-v1
aws s3 sync "s3://${CORPUS_BUCKET}/${DATASET_PREFIX}" \
  build/sero-pretrain-curriculum-v1 --only-show-errors
python3 scripts/verify_zero_dataset.py --root build/sero-pretrain-curriculum-v1 \
  --digest "$DATASET_DIGEST"

PHASE=environment
write_status running 0
upload_status
python3 -m venv build/sero2-curriculum/aws-venv
build/sero2-curriculum/aws-venv/bin/pip install --disable-pip-version-check \
  --no-input -r experiments/sero1-pretrain/requirements.txt
nvidia-smi > build/sero2-curriculum/nvidia-smi.txt
build/sero2-curriculum/aws-venv/bin/python - <<'PY'
import torch
if not torch.cuda.is_available():
    raise RuntimeError("CUDA is unavailable")
print(torch.cuda.get_device_name(0))
PY
build/sero2-curriculum/aws-venv/bin/pip freeze > build/sero2-curriculum/aws-pip-freeze.txt
CONTRACT=benchmarks/sero2-curriculum-v1/contract.json
if [ "$EXPERIMENT" = sero2-curriculum-consolidation-v1 ]; then
  CONTRACT=benchmarks/sero2-curriculum-consolidation-v1/contract.json
fi
build/sero2-curriculum/aws-venv/bin/python experiments/sero2-curriculum/tests.py \
  --manifest build/sero-pretrain-curriculum-v1/manifest.json --contract "$CONTRACT"

PHASE=training
write_status running 0
upload_status
RESULT_FILE="build/${EXPERIMENT}/${MODE}/seed0.json"
ARTIFACT_DIR="build/${EXPERIMENT}/${MODE}/artifacts"
TRAIN_ARGS=(--mode "$MODE")
if [ "$MODE" = calibration ]; then
  TRAIN_ARGS+=(--max-updates 128 --validation-byte-limit 131072)
fi
if [ "$EXPERIMENT" = sero2-curriculum-consolidation-v1 ]; then
  aws s3 cp "s3://${TRAINING_BUCKET}/${RESUME_KEY}" /tmp/sero2-parent-model.pt \
    --only-show-errors
  test "$(sha256sum /tmp/sero2-parent-model.pt | awk '{print $1}')" = "$RESUME_SHA256"
  TRAIN_ARGS+=(--resume /tmp/sero2-parent-model.pt)
fi
mkdir -p "$(dirname "$RESULT_FILE")" "$ARTIFACT_DIR"
remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 180))
test "$remaining" -gt 0
timeout --signal=TERM --kill-after=30s "${remaining}s" \
  build/sero2-curriculum/aws-venv/bin/python experiments/sero2-curriculum/train.py \
    --contract "$CONTRACT" \
    --manifest build/sero-pretrain-curriculum-v1/manifest.json \
    --tokenizer tokenizers/sero1-byte-bpe-4096.json \
    --output "$RESULT_FILE" --artifact-dir "$ARTIFACT_DIR" \
    --seed "$SEED" --device cuda "${TRAIN_ARGS[@]}"

PHASE=publication
RESULT_KEY="${RESULT_PREFIX}/result.json"
MODEL_KEY="${RESULT_PREFIX}/artifacts/model-final.pt"
RESULT_SHA256=$(sha256sum "$RESULT_FILE" | awk '{print $1}')
MODEL_SHA256=$(jq -r .model.artifact_sha256 "$RESULT_FILE")
test "$MODEL_SHA256" = "$(sha256sum "$ARTIFACT_DIR/model-final.pt" | awk '{print $1}')"
aws s3 cp "$RESULT_FILE" "s3://${TRAINING_BUCKET}/${RESULT_KEY}" --only-show-errors
aws s3 sync "$ARTIFACT_DIR" \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/artifacts" --only-show-errors
aws s3 cp build/sero2-curriculum/nvidia-smi.txt \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/nvidia-smi.txt" --only-show-errors
aws s3 cp build/sero2-curriculum/aws-pip-freeze.txt \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/pip-freeze.txt" --only-show-errors
PHASE=complete
write_status complete 0 "$RESULT_KEY" "$RESULT_SHA256" "$MODEL_KEY" "$MODEL_SHA256"
cost=$(jq -r .estimated_ec2_usd "$STATUS_FILE")
awk -v cost="$cost" -v ceiling="$MAX_COMPUTE_USD" \
  'BEGIN { exit !(cost <= ceiling) }'
upload_status
