#!/bin/bash

set -Eeuo pipefail

BOOT_LOG=/var/log/zero5-c32-throughput.log
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
SOURCE_KEY=$(tag SourceKey)
SOURCE_SHA256=$(tag SourceSha256)
ASSET_KEY=$(tag AssetKey)
ASSET_SHA256=$(tag AssetSha256)
CHECKPOINT_KEY=$(tag CheckpointKey)
CHECKPOINT_SHA256=$(tag CheckpointSha256)
TRAINING_BUCKET=$(tag TrainingBucket)
CONTRACT_SHA256=$(tag BenchmarkContractSha256)
AWS_DEFAULT_REGION=$(tag Region)
LAUNCH_EPOCH=$(tag LaunchEpoch)
MAX_INSTANCE_SECONDS=$(tag MaxInstanceSeconds)
MAX_COMPUTE_USD=$(tag MaxComputeUsd)
PRIOR_COMPUTE_USD=$(tag PriorComputeUsd)
TOTAL_MAX_COMPUTE_USD=$(tag TotalMaxComputeUsd)
HOURLY_PRICE=$(tag HourlyPrice)
INSTANCE_ID=$(metadata instance-id)
INSTANCE_TYPE=$(metadata instance-type)
RESULT_PREFIX="experiments/zero5-c32-throughput-v1/${RUN_ID}"
RESULT_ROOT=/tmp/zero5-c32-throughput
STATUS_FILE="$RESULT_ROOT/status.json"
RESULT_FILE="$RESULT_ROOT/result.json"
TERMINAL_WRITTEN=0
PHASE=bootstrap
ERROR_LINE=0
ERROR_COMMAND=

export AWS_DEFAULT_REGION
test "$AWS_DEFAULT_REGION" = us-east-1
test "$INSTANCE_TYPE" = c6i.4xlarge
test "$MAX_INSTANCE_SECONDS" = 500
test "$MAX_COMPUTE_USD" = 0.095
test "$PRIOR_COMPUTE_USD" = 0.040989
test "$TOTAL_MAX_COMPUTE_USD" = 0.14
test "$HOURLY_PRICE" = 0.68
[[ "$RUN_ID" =~ ^zero5-c32-throughput-[a-z0-9-]+$ ]]
[[ "$SOURCE_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$ASSET_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CHECKPOINT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$CONTRACT_SHA256" =~ ^[0-9a-f]{64}$ ]]
[[ "$LAUNCH_EPOCH" =~ ^[0-9]+$ ]]
awk -v seconds="$MAX_INSTANCE_SECONDS" -v price="$HOURLY_PRICE" \
  -v ceiling="$MAX_COMPUTE_USD" -v prior="$PRIOR_COMPUTE_USD" \
  -v total="$TOTAL_MAX_COMPUTE_USD" \
  'BEGIN {
    attempt = seconds * price / 3600
    exit !(attempt <= ceiling && prior + attempt <= total)
  }'

mkdir -p "$RESULT_ROOT"
now_epoch=$(date +%s)
age=$((now_epoch - LAUNCH_EPOCH))
test "$age" -ge 0
test "$age" -lt "$MAX_INSTANCE_SECONDS"
remaining=$((MAX_INSTANCE_SECONDS - age))
( sleep "$remaining"; shutdown -h now ) &

publish_status() {
  status=$1
  phase=$2
  exit_code=${3:-0}
  elapsed=$(($(date +%s) - LAUNCH_EPOCH))
  attempt_cost=$(awk -v seconds="$elapsed" -v price="$HOURLY_PRICE" \
    'BEGIN { printf "%.6f", seconds * price / 3600 }')
  cumulative_cost=$(awk -v prior="$PRIOR_COMPUTE_USD" \
    -v attempt="$attempt_cost" \
    'BEGIN { printf "%.6f", prior + attempt }')
  jq -n --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
    --arg status "$status" --arg phase "$phase" \
    --arg error_command "$ERROR_COMMAND" --argjson error_line "$ERROR_LINE" \
    --argjson exit_code "$exit_code" --argjson elapsed "$elapsed" \
    --argjson attempt_cost "$attempt_cost" \
    --argjson cumulative_cost "$cumulative_cost" \
    '{schema:"zero.c32_throughput_status.v1",status:$status,phase:$phase,
      run_id:$run_id,instance_id:$instance_id,exit_code:$exit_code,
      error_line:$error_line,error_command:$error_command,
      elapsed_instance_seconds:$elapsed,attempt_compute_usd:$attempt_cost,
      cumulative_compute_usd:$cumulative_cost}' > "$STATUS_FILE"
  aws s3 cp "$STATUS_FILE" \
    "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" \
    --only-show-errors
}

trap 'ERROR_LINE=$LINENO; ERROR_COMMAND=$BASH_COMMAND' ERR

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  if command -v aws >/dev/null 2>&1; then
    if [ "$TERMINAL_WRITTEN" -eq 0 ]; then
      publish_status failed "$PHASE" "$exit_code"
    fi
    aws s3 cp "$BOOT_LOG" \
      "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/bootstrap.log" \
      --only-show-errors
    test ! -f "$RESULT_FILE" || aws s3 cp "$RESULT_FILE" \
      "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/result.json" \
      --only-show-errors
    test ! -f "$RESULT_ROOT/candidates.tsv" || \
      aws s3 cp "$RESULT_ROOT/candidates.tsv" \
        "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/candidates.tsv" \
        --only-show-errors
    for log in "$RESULT_ROOT"/*/training.log; do
      test -f "$log" || continue
      candidate=$(basename "$(dirname "$log")")
      aws s3 cp "$log" \
        "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/logs/${candidate}.log" \
        --only-show-errors
    done
    aws s3 cp "$STATUS_FILE" \
      "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/status.json" \
      --only-show-errors
  fi
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

export DEBIAN_FRONTEND=noninteractive
if ! command -v aws >/dev/null 2>&1; then
  AWS_CLI_VERSION=2.34.7
  AWS_CLI_SHA256=d6b6e2291456704a441e970bbdb69466629510dd0b578e8812f7856eac64abba1
  curl --fail --silent --show-error --location \
    "https://awscli.amazonaws.com/awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip" \
    --output /tmp/awscliv2.zip
  echo "${AWS_CLI_SHA256}  /tmp/awscliv2.zip" | sha256sum --check
  python3 -m zipfile -e /tmp/awscliv2.zip /tmp/awscliv2
  /tmp/awscliv2/aws/install --bin-dir /usr/local/bin \
    --install-dir /usr/local/aws-cli
fi

PHASE=dependencies
aws s3 cp "$BOOT_LOG" \
  "s3://${TRAINING_BUCKET}/${RESULT_PREFIX}/bootstrap.log" \
  --only-show-errors
apt-get update -qq
apt-get install -y -qq build-essential ca-certificates curl jq \
  libopenblas-dev nodejs pkg-config unzip

PHASE=source
publish_status running "$PHASE"

install -d -m 0755 /opt/zero/repo
aws s3 cp "s3://${TRAINING_BUCKET}/${SOURCE_KEY}" /tmp/source.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/source.tar.gz | awk '{print $1}')" = "$SOURCE_SHA256"
tar -xzf /tmp/source.tar.gz -C /opt/zero/repo
cd /opt/zero/repo
test "$(sha256sum benchmarks/zero5-c32-v1/contract.json | awk '{print $1}')" = \
  f47f9283ee8a111bb816079803824bee77de930eac9e4ef5ecdbb8733dd01b7e
PHASE=assets
publish_status running "$PHASE"
aws s3 cp "s3://${TRAINING_BUCKET}/${ASSET_KEY}" /tmp/assets.tar.gz \
  --only-show-errors
test "$(sha256sum /tmp/assets.tar.gz | awk '{print $1}')" = "$ASSET_SHA256"
tar -xzf /tmp/assets.tar.gz -C /opt/zero/repo
aws s3 cp "s3://${TRAINING_BUCKET}/${CHECKPOINT_KEY}" \
  "$RESULT_ROOT/input.ckpt" --only-show-errors
test "$(sha256sum "$RESULT_ROOT/input.ckpt" | awk '{print $1}')" = \
  "$CHECKPOINT_SHA256"

PHASE=compile
publish_status running "$PHASE"
export LITERARY_BACKEND=openblas
make zero5_c32_lm
mv zero5_c32_lm zero5_c32_lm_o2
cc -O3 -march=native -std=c11 -Wall -Wextra -Wpedantic -DUSE_CBLAS \
  $(pkg-config --cflags openblas) zero5_c32_lm.c -o zero5_c32_lm_o3_native \
  $(pkg-config --libs openblas) -lm

TOK=build/zero5-c0-v1/corpus-one/byte-bpe512.sero
TRAIN=build/zero5-c32-v1/import-final/train.interleaved.z5pack
VALIDATION=build/zero5-c32-v1/import-final/validation.interleaved.z5pack
RUN_CONTRACT=f47f9283ee8a111bb816079803824bee77de930eac9e4ef5ecdbb8733dd01b7e
TSV="$RESULT_ROOT/candidates.tsv"
: > "$TSV"

run_candidate() {
  name=$1
  binary=$2
  threads=$3
  directory="$RESULT_ROOT/$name"
  PHASE="candidate-$name"
  publish_status running "$PHASE"
  mkdir -p "$directory"
  cp "$RESULT_ROOT/input.ckpt" "$directory/active.ckpt"
  cp "$RESULT_ROOT/input.ckpt" "$directory/best.ckpt"
  started=$(date +%s)
  OPENBLAS_NUM_THREADS="$threads" OMP_NUM_THREADS="$threads" \
    OPENBLAS_DYNAMIC=0 "./$binary" \
    --resume "$directory/active.ckpt" --tokenizer "$TOK" \
    --packed-train "$TRAIN" --packed-validation "$VALIDATION" \
    --run-contract-sha256 "$RUN_CONTRACT" --steps 9442 --batch 4 \
    --lr 0.0003 --weight-decay 0.01 --clip 1 --warmup 300 \
    --schedule-total 9442 --cosine --dropout 0.1 --report 20 \
    --validation 1 --best "$directory/best.ckpt" --seed 0 \
    --save "$directory/active.ckpt" --save-every 20 \
    --claim-answer-weight 1 --cloze-answer-weight 1 \
    --retrieval-answer-weight 1 --tokens 0 --max-run-steps 20 \
    > "$directory/training.log" 2>&1
  finished=$(date +%s)
  tokens_per_second=$(awk '/^update[[:space:]]+3020 / {
    for (field=1; field<=NF; ++field) if ($field=="tok/s") print $(field+1)
  }' "$directory/training.log")
  [[ "$tokens_per_second" =~ ^[0-9]+$ ]]
  active_sha256=$(sha256sum "$directory/active.ckpt" | awk '{print $1}')
  best_sha256=$(sha256sum "$directory/best.ckpt" | awk '{print $1}')
  compiler=o2
  test "$binary" = zero5_c32_lm_o2 || compiler=o3-native
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$name" "$threads" \
    "$compiler" "$tokens_per_second" "$((finished-started))" \
    "$active_sha256" "$best_sha256" >> "$TSV"
}

run_candidate o2-t16-a zero5_c32_lm_o2 16
run_candidate o2-t8 zero5_c32_lm_o2 8
run_candidate o2-t4 zero5_c32_lm_o2 4
run_candidate o2-t2 zero5_c32_lm_o2 2
run_candidate o2-t1 zero5_c32_lm_o2 1
run_candidate o2-t16-b zero5_c32_lm_o2 16
run_candidate o3-native-t16 zero5_c32_lm_o3_native 16
run_candidate o3-native-t8 zero5_c32_lm_o3_native 8
run_candidate o3-native-t4 zero5_c32_lm_o3_native 4

reference_sha256=$(awk -F '\t' '$1=="o2-t16-a" {print $6}' "$TSV")
candidates=$(jq -Rn --arg reference "$reference_sha256" \
  '[inputs | select(length > 0) | split("\t") | {
    name:.[0],threads:(.[1]|tonumber),compiler:.[2],
    tokens_per_second:(.[3]|tonumber),elapsed_seconds:(.[4]|tonumber),
    active_checkpoint_sha256:.[5],best_checkpoint_sha256:.[6],
    byte_identical_to_reference:(.[5] == $reference)}]' < "$TSV")
fastest=$(jq '[.[] | select(.byte_identical_to_reference)] |
  sort_by(.tokens_per_second) | last' <<< "$candidates")
elapsed=$(($(date +%s) - LAUNCH_EPOCH))
attempt_cost=$(awk -v seconds="$elapsed" -v price="$HOURLY_PRICE" \
  'BEGIN { printf "%.6f", seconds * price / 3600 }')
cumulative_cost=$(awk -v prior="$PRIOR_COMPUTE_USD" \
  -v attempt="$attempt_cost" \
  'BEGIN { printf "%.6f", prior + attempt }')
jq -n --arg run_id "$RUN_ID" --arg instance_id "$INSTANCE_ID" \
  --arg instance_type "$INSTANCE_TYPE" --arg backend OpenBLAS \
  --arg input_checkpoint_sha256 "$CHECKPOINT_SHA256" \
  --arg contract_sha256 "$CONTRACT_SHA256" \
  --argjson elapsed_seconds "$elapsed" \
  --argjson attempt_compute_usd "$attempt_cost" \
  --argjson prior_compute_usd "$PRIOR_COMPUTE_USD" \
  --argjson cumulative_compute_usd "$cumulative_cost" \
  --argjson candidates "$candidates" --argjson fastest "$fastest" \
  '{schema:"zero.c32_throughput_result.v1",status:"complete",
    diagnostic_only:true,run_id:$run_id,instance_id:$instance_id,
    instance_type:$instance_type,backend:$backend,
    input_checkpoint_sha256:$input_checkpoint_sha256,
    benchmark_contract_sha256:$contract_sha256,
    replay:{start_update:3000,updates:20,batch_sequences:4},
    elapsed_instance_seconds:$elapsed_seconds,
    attempt_compute_usd:$attempt_compute_usd,
    prior_compute_usd:$prior_compute_usd,
    cumulative_compute_usd:$cumulative_compute_usd,
    candidates:$candidates,fastest_byte_identical_candidate:$fastest}' \
  > "$RESULT_FILE"
PHASE=complete
publish_status complete "$PHASE"
TERMINAL_WRITTEN=1
