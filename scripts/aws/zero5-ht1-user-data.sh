#!/bin/bash

set -Eeuo pipefail

bootstrap_finish() {
  exit_code=$?
  trap - EXIT
  set +e
  shutdown -h now
  exit "$exit_code"
}
trap bootstrap_finish EXIT

BOOT_LOG=/var/log/zero5-ht1-bootstrap.log
exec > >(tee -a "$BOOT_LOG" >/dev/console) 2>&1
set -x

IMDS=http://169.254.169.254/latest
TOKEN=$(curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
  --request PUT --header 'X-aws-ec2-metadata-token-ttl-seconds: 21600' \
  "$IMDS/api/token")
metadata() {
  curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --header "X-aws-ec2-metadata-token: $TOKEN" "$IMDS/meta-data/$1"
}
tag() { metadata "tags/instance/$1"; }

RUN_ID=$(tag RunId)
SERIES_ID=$(tag SeriesId)
ATTEMPT=$(tag Attempt)
SOURCE_COMMIT=$(tag Commit)
SOURCE_KEY=$(tag SourceKey)
SOURCE_SHA256=$(tag SourceSha256)
ASSET_KEY=$(tag AssetKey)
ASSET_SHA256=$(tag AssetSha256)
TRAINING_BUCKET=$(tag TrainingBucket)
AUTHORIZATION_SHA256=$(tag AuthorizationSha256)
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
APPROVAL_ID=$(tag ApprovalId)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
PREFIX="experiments/zero5-ht1-mergetree-v1/${SERIES_ID}"
RESULT_PREFIX="${PREFIX}/attempts/${ATTEMPT}"
STATE_PREFIX="${PREFIX}/state"
STATUS_FILE=/tmp/zero5-ht1-status.json
TERMINAL_WRITTEN=0
PHASE=bootstrap
OUT=/opt/zero/repo/build/zero5-ht1-mergetree-v1/run

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = c6i.4xlarge
test "$MAX_INSTANCE_SECONDS" = 9000
test "$MAX_COMPUTE_USD" = 1.7
test "$HOURLY_PRICE" = 0.68
test "$APPROVAL_ID" = zero5-ht1-mergetree-aws-2026-09-04-v1
[[ "$RUN_ID" =~ ^ht1-[a-z0-9-]{8,40}-a[1-5]$ ]]
[[ "$SERIES_ID" =~ ^ht1-[a-z0-9-]{8,40}$ ]]
[[ "$ATTEMPT" =~ ^[1-5]$ ]]
[[ "$SOURCE_COMMIT" =~ ^[0-9a-f]{40}$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$AUTHORIZATION_SHA256" =~ ^[0-9a-f]{64}$ ]]
awk -v seconds="$MAX_INSTANCE_SECONDS" -v price="$HOURLY_PRICE" \
  -v ceiling="$MAX_COMPUTE_USD" \
  'BEGIN { exit !(seconds * price / 3600 <= ceiling &&
    (seconds + 1) * price / 3600 > ceiling) }'

remaining=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s)))
test "$remaining" -gt 0
( sleep "$remaining"; shutdown -h now ) &
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
  elapsed=$(elapsed_seconds)
  cost=$(estimated_cost "$elapsed")
  jq -n --arg status "$status" --arg phase "$PHASE" \
    --arg series_id "$SERIES_ID" --arg run_id "$RUN_ID" \
    --arg instance_id "$INSTANCE_ID" --arg git_commit "$SOURCE_COMMIT" \
    --arg authorization_sha256 "$AUTHORIZATION_SHA256" \
    --arg result_key "$result_key" --arg result_sha256 "$result_sha256" \
    --argjson attempt "$ATTEMPT" --argjson exit_code "$exit_code" \
    --argjson elapsed "$elapsed" --argjson cost "$cost" \
    '{schema:"zero.ht1_aws_status.v1",status:$status,phase:$phase,
      series_id:$series_id,run_id:$run_id,attempt:$attempt,
      instance_id:$instance_id,git_commit:$git_commit,
      authorization_sha256:$authorization_sha256,exit_code:$exit_code,
      elapsed_instance_seconds:$elapsed,estimated_ec2_usd:$cost,
      result_key:(if $result_key=="" then null else $result_key end),
      result_sha256:(if $result_sha256=="" then null else $result_sha256 end)}' \
    > "$STATUS_FILE"
}
upload_status() {
  aws s3 cp "$STATUS_FILE" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" --only-show-errors
}
sync_state() {
  aws s3 sync "$OUT/" "s3://${TRAINING_BUCKET}/${STATE_PREFIX}/" \
    --only-show-errors
}
finish() {
  exit_code=$?
  trap - EXIT
  set +e
  aws s3 cp "$BOOT_LOG" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/bootstrap.log" \
    --only-show-errors
  if [ "$TERMINAL_WRITTEN" -eq 0 ]; then
    write_status failed "$exit_code"
    upload_status
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential ca-certificates curl jq \
  libopenblas-dev nodejs pkg-config unzip
if ! command -v aws >/dev/null 2>&1; then
  AWS_CLI_VERSION=2.34.7
  AWS_CLI_SHA256=d6b6e2291456704a441e970bbdb69466629510dd0b578e8812f7856ac64abba1
  curl --fail --silent --show-error --location \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
    --output /tmp/awscliv2.zip
  echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum --check
  unzip -q /tmp/awscliv2.zip -d /tmp/awscliv2
  /tmp/awscliv2/aws/install --bin-dir /usr/local/bin \
    --install-dir /usr/local/aws-cli
fi

PHASE=source
write_status running 0
upload_status
install -d -m 0755 /opt/zero/repo
aws s3 cp "s3://${TRAINING_BUCKET}/${SOURCE_KEY}" /tmp/source.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/source.tar.gz | awk '{print $1}')" = "$SOURCE_SHA256"
tar -xzf /tmp/source.tar.gz -C /opt/zero/repo
cd /opt/zero/repo
test "$(cat SOURCE_COMMIT)" = "$SOURCE_COMMIT"
AUTH=benchmarks/zero5-ht1-mergetree-v1/authorization-aws.json
test "$(sha256sum "$AUTH" | awk '{print $1}')" = "$AUTHORIZATION_SHA256"
test "$(jq -r .authorization_id "$AUTH")" = "$APPROVAL_ID"
test "$(jq -r .launch_readiness.ready "$AUTH")" = true
test "$(jq -r .scope.source_upload_authorized "$AUTH")" = true
test "$(jq -r .scope.private_artifact_upload_authorized "$AUTH")" = true

PHASE=assets
write_status running 0
upload_status
aws s3 cp "s3://${TRAINING_BUCKET}/${ASSET_KEY}" /tmp/assets.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/assets.tar.gz | awk '{print $1}')" = "$ASSET_SHA256"
tar -xzf /tmp/assets.tar.gz -C /opt/zero/repo

PHASE=environment
write_status running 0
upload_status
export LITERARY_BACKEND=openblas
export OPENBLAS_DYNAMIC=0
export OPENBLAS_NUM_THREADS=16
export OMP_NUM_THREADS=16
make zero5_ht1_mergetree_lm
./zero5_ht1_mergetree_lm --self-test
node scripts/check_zero5_hierarchical_tokenization.mjs
node scripts/check_zero5_ht1_authorization.mjs
node scripts/check_zero5_ht1_aws.mjs
node scripts/evaluate_zero5_ht1_authorized.mjs --self-test

install -d -m 0700 "$OUT"
aws s3 sync "s3://${TRAINING_BUCKET}/${STATE_PREFIX}/" "$OUT/" \
  --only-show-errors
TOKENIZER=build/zero5-c0-v1/corpus-one/byte-bpe512.sero
INITIAL=build/zero5-c2-v1/run/best.ckpt
TRAIN=build/zero5-c51-v1/import-final/train.mixed.grouped.z5pack
VALIDATION=build/zero5-c43-v1/import-final/frozen-validation/validation.z5pack
CONTROL_CHECKPOINT=build/zero5-c51-statebridge-v1/control/best.ckpt
CONTROL_RESULT=build/zero5-c51-statebridge-v1/control/result.json
BINARY=./zero5_ht1_mergetree_lm

for entry in \
  "$TOKENIZER:$(jq -r .pilot.tokenizer_sha256 "$AUTH")" \
  "$INITIAL:$(jq -r .pilot.initial_checkpoint_sha256 "$AUTH")" \
  "$TRAIN:$(jq -r .pilot.training_packs_sha256 "$AUTH")" \
  "$VALIDATION:$(jq -r .pilot.validation_packs_sha256 "$AUTH")" \
  "$CONTROL_CHECKPOINT:$(jq -r .pilot.control_checkpoint_sha256 "$AUTH")" \
  "$CONTROL_RESULT:$(jq -r .pilot.control_result_sha256 "$AUTH")"; do
  file=${entry%%:*}
  expected=${entry#*:}
  test "$(sha256sum "$file" | awk '{print $1}')" = "$expected"
done

run_with_sync() {
  log_file=$1
  shift
  set +e
  "$@" >>"$log_file" 2>&1 &
  process_id=$!
  while kill -0 "$process_id" 2>/dev/null; do
    sync_state || true
    sleep 30
  done
  wait "$process_id"
  status=$?
  sync_state
  return "$status"
}
recoverable() {
  exit_code=$1
  PHASE=$2
  write_status recoverable "$exit_code"
  upload_status
  TERMINAL_WRITTEN=1
  exit 0
}
phase_seconds() {
  available=$((LAUNCH_EPOCH + MAX_INSTANCE_SECONDS - $(date +%s) - 180))
  if [ "$available" -lt 120 ]; then
    recoverable 0 "$PHASE"
  fi
  printf '%s\n' "$available"
}

updates=0
if [ -s "$OUT/training-progress.json" ]; then
  updates=$(jq -r .updates "$OUT/training-progress.json")
fi
if [ "$updates" -lt 28707 ]; then
  PHASE=training
  write_status running 0
  upload_status
  model_flag=--init
  model_file=$INITIAL
  if [ -s "$OUT/active.ckpt" ]; then
    model_flag=--resume
    model_file=$OUT/active.ckpt
  fi
  seconds=$(phase_seconds)
  set +e
  run_with_sync "$OUT/training.log" timeout --signal=TERM --kill-after=90s \
    "${seconds}s" "$BINARY" "$model_flag" "$model_file" \
    --tokenizer "$TOKENIZER" --packed-train "$TRAIN" \
    --packed-validation "$VALIDATION" \
    --run-contract-sha256 "$(jq -r .bindings.contract_sha256 "$AUTH")" \
    --steps 28707 --batch 2 --parallel-batch 2 --seed 0 --warmup 1000 \
    --report 500 --validation 64 --save-every 250 \
    --lr 0.0003 --weight-decay 0.01 --clip 1 --dropout 0.1 \
    --claim-answer-weight 2.229423406 --cloze-answer-weight 5.253416128 \
    --retrieval-answer-weight 1.429401038 --require-math-backend openblas \
    --require-attention-backend dense-blas --save "$OUT/active.ckpt" \
    --best "$OUT/best.ckpt"
  train_status=$?
  set -e
  progress=$(grep '"schema":"zero.ht1_training_progress.v1"' \
    "$OUT/training.log" | tail -n 1)
  test -n "$progress"
  printf '%s\n' "$progress" > "$OUT/training-progress.json"
  sync_state
  updates=$(jq -r .updates "$OUT/training-progress.json")
  if [ "$train_status" -ne 0 ] && [ "$train_status" -ne 124 ] && \
      [ "$train_status" -ne 137 ] && [ "$train_status" -ne 143 ]; then
    exit "$train_status"
  fi
  if [ "$updates" -lt 28707 ]; then
    recoverable "$train_status" training
  fi
fi
test "$updates" = 28707
test -s "$OUT/best.ckpt"
if [ ! -s "$OUT/training-complete.json" ]; then
  jq -n --arg experiment zero5-ht1-mergetree-v1 \
    --arg authorization_sha256 "$AUTHORIZATION_SHA256" \
    --arg contract_sha256 "$(jq -r .bindings.contract_sha256 "$AUTH")" \
    --arg source_commit "$SOURCE_COMMIT" \
    --arg best_sha256 "$(sha256sum "$OUT/best.ckpt" | awk '{print $1}')" \
    --argjson best_bytes "$(stat -c %s "$OUT/best.ckpt")" \
    --arg active_sha256 "$(sha256sum "$OUT/active.ckpt" | awk '{print $1}')" \
    --argjson active_bytes "$(stat -c %s "$OUT/active.ckpt")" \
    --argjson seed 0 --argjson updates "$updates" \
    --argjson compute_token_exposures \
      "$(jq -r .compute_token_exposures "$OUT/training-progress.json")" \
    '{schema:"zero.ht1_training_complete.v1",experiment:$experiment,
      authorization_sha256:$authorization_sha256,
      contract_sha256:$contract_sha256,source_commit:$source_commit,
      seed:$seed,updates:$updates,
      compute_token_exposures:$compute_token_exposures,
      best_checkpoint:{sha256:$best_sha256,bytes:$best_bytes},
      active_checkpoint:{sha256:$active_sha256,bytes:$active_bytes}}' \
    > "$OUT/training-complete.json"
  sync_state
fi

if [ ! -s "$OUT/candidate-tasks.json" ]; then
  PHASE=candidate-tasks
  write_status running 0
  upload_status
  seconds=$(phase_seconds)
  set +e
  run_with_sync "$OUT/candidate-tasks.log" timeout --signal=TERM \
    --kill-after=90s "${seconds}s" node scripts/evaluate_zero5_c51.mjs \
    --trainer "$BINARY" --checkpoint "$OUT/best.ckpt" \
    --baseline-checkpoint "$INITIAL" --tokenizer "$TOKENIZER" \
    --import-dir build/zero5-c51-v1/import-final \
    --c43-import build/zero5-c43-v1/import-final \
    --atlas-train build/zero5-c2-v1/import-final/atlas.train.byte-bpe512.tok \
    --atlas-validation build/zero5-c2-v1/import-final/atlas.validation.byte-bpe512.tok \
    --anchor-train build/zero5-c0-v1/corpus-one/train.byte-bpe512.tok \
    --anchor-validation build/zero5-c0-v1/corpus-one/validation.byte-bpe512.tok \
    --out "$OUT/candidate-tasks.json"
  task_status=$?
  set -e
  if [ "$task_status" -ne 0 ]; then
    if [ "$task_status" -eq 124 ] || [ "$task_status" -eq 137 ] || \
        [ "$task_status" -eq 143 ]; then
      recoverable "$task_status" candidate-tasks
    fi
    exit "$task_status"
  fi
  sync_state
fi

if [ ! -s "$OUT/candidate-depth.json" ]; then
  PHASE=candidate-depth
  write_status running 0
  upload_status
  seconds=$(phase_seconds)
  set +e
  run_with_sync "$OUT/candidate-depth.log" timeout --signal=TERM \
    --kill-after=90s "${seconds}s" "$BINARY" --init "$OUT/best.ckpt" \
    --tokenizer "$TOKENIZER" --depth-eval "$VALIDATION"
  depth_status=$?
  set -e
  if [ "$depth_status" -ne 0 ]; then
    if [ "$depth_status" -eq 124 ] || [ "$depth_status" -eq 137 ] || \
        [ "$depth_status" -eq 143 ]; then
      recoverable "$depth_status" candidate-depth
    fi
    exit "$depth_status"
  fi
  grep '"schema":"zero.ht1_depth_eval.v1"' "$OUT/candidate-depth.log" | \
    tail -n 1 > "$OUT/candidate-depth.json"
  jq -e '.schema == "zero.ht1_depth_eval.v1"' \
    "$OUT/candidate-depth.json" >/dev/null
  sync_state
fi

if [ ! -s "$OUT/control-depth.json" ]; then
  PHASE=control-depth
  write_status running 0
  upload_status
  seconds=$(phase_seconds)
  set +e
  run_with_sync "$OUT/control-depth.log" timeout --signal=TERM \
    --kill-after=90s "${seconds}s" "$BINARY" --init "$CONTROL_CHECKPOINT" \
    --tokenizer "$TOKENIZER" --depth-eval "$VALIDATION"
  control_status=$?
  set -e
  if [ "$control_status" -ne 0 ]; then
    if [ "$control_status" -eq 124 ] || [ "$control_status" -eq 137 ] || \
        [ "$control_status" -eq 143 ]; then
      recoverable "$control_status" control-depth
    fi
    exit "$control_status"
  fi
  grep '"schema":"zero.ht1_depth_eval.v1"' "$OUT/control-depth.log" | \
    tail -n 1 > "$OUT/control-depth.json"
  jq -e '.schema == "zero.ht1_depth_eval.v1"' \
    "$OUT/control-depth.json" >/dev/null
  sync_state
fi

PHASE=result
write_status running 0
upload_status
node scripts/evaluate_zero5_ht1_authorized.mjs \
  --authorization "$AUTH" --checkpoint "$OUT/best.ckpt" \
  --control-checkpoint "$CONTROL_CHECKPOINT" --control-result "$CONTROL_RESULT" \
  --tokenizer "$TOKENIZER" --validation "$VALIDATION" \
  --candidate-tasks "$OUT/candidate-tasks.json" \
  --candidate-depth "$OUT/candidate-depth.json" \
  --control-depth "$OUT/control-depth.json" \
  --training-complete "$OUT/training-complete.json" --trainer "$BINARY" \
  --out "$OUT/result.json"
sync_state
result_sha256=$(sha256sum "$OUT/result.json" | awk '{print $1}')
result_key="${RESULT_PREFIX}/result.json"
aws s3 cp "$OUT/result.json" "s3://${TRAINING_BUCKET}/${result_key}" \
  --only-show-errors
PHASE=complete
write_status complete 0 "$result_key" "$result_sha256"
awk -v cost="$(jq -r .estimated_ec2_usd "$STATUS_FILE")" \
  -v ceiling="$MAX_COMPUTE_USD" 'BEGIN { exit !(cost <= ceiling) }'
upload_status
TERMINAL_WRITTEN=1
exit 0
