#!/bin/bash

set -Eeuo pipefail

AUTH=benchmarks/zero5-ht1-mergetree-v1/authorization-aws.json
action=${1:-}
test "$action" = self-test || test "$action" = plan || test "$action" = upload

digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

test "$(jq -r .authorized "$AUTH")" = true
test "$(jq -r .authorization_id "$AUTH")" = \
  zero5-ht1-mergetree-aws-2026-09-04-v1
test "$(jq -r .budget.maximum_approved_compute_usd "$AUTH")" = 10
test "$(jq -r .pilot.training_trajectories "$AUTH")" = 1
if [ "$action" = self-test ]; then
  echo "ZERO.5 HT1 stage self-test passed"
  exit 0
fi

: "${ZERO5_TRAINING_BUCKET:?ZERO5_TRAINING_BUCKET is required}"
ZERO5_REGION=${ZERO5_REGION:-us-east-1}
ZERO5_ASSET_ROOT=${ZERO5_ASSET_ROOT:-$PWD}
test "$ZERO5_REGION" = us-east-1
git diff --quiet
git diff --cached --quiet
node scripts/check_zero5_ht1_authorization.mjs
node scripts/check_zero5_ht1_aws.mjs

required=(
  build/zero5-c0-v1/corpus-one/byte-bpe512.sero
  build/zero5-c0-v1/corpus-one/train.byte-bpe512.tok
  build/zero5-c0-v1/corpus-one/validation.byte-bpe512.tok
  build/zero5-c2-v1/run/best.ckpt
  build/zero5-c2-v1/import-final/atlas.train.byte-bpe512.tok
  build/zero5-c2-v1/import-final/atlas.validation.byte-bpe512.tok
  build/zero5-c51-v1/import-final/train.mixed.grouped.z5pack
  build/zero5-c51-v1/import-final/import.json
  build/zero5-c51-v1/import-final/c52.next-state.validation.completion-eval.bin
  build/zero5-c51-v1/import-final/c52.choice-a.validation.completion-eval.bin
  build/zero5-c51-v1/import-final/c52.choice-b.validation.completion-eval.bin
  build/zero5-c43-v1/import-final/import.json
  build/zero5-c43-v1/import-final/frozen-validation/validation.z5pack
  build/zero5-c43-v1/import-final/frozen-validation/evidence-bundle.validation.z5pack
  build/zero5-c43-v1/import-final/frozen-validation/cloze.validation.completion-eval.bin
  build/zero5-c43-v1/import-final/frozen-validation/claim.validation.span-choice-eval.bin
  build/zero5-c43-v1/import-final/frozen-validation/retrieval.validation.span-choice-eval.bin
  build/zero5-c51-statebridge-v1/control/best.ckpt
  build/zero5-c51-statebridge-v1/control/result.json
)
for file in "${required[@]}"; do
  test -f "$ZERO5_ASSET_ROOT/$file" || {
    echo "missing HT1 input: $ZERO5_ASSET_ROOT/$file" >&2
    exit 1
  }
done

check_hash() {
  file=$1
  expected=$2
  observed=$(digest_file "$ZERO5_ASSET_ROOT/$file")
  test "$observed" = "$expected" || {
    echo "HT1 input hash changed: $file" >&2
    exit 1
  }
}
check_hash build/zero5-c0-v1/corpus-one/byte-bpe512.sero \
  "$(jq -r .pilot.tokenizer_sha256 "$AUTH")"
check_hash build/zero5-c2-v1/run/best.ckpt \
  "$(jq -r .pilot.initial_checkpoint_sha256 "$AUTH")"
check_hash build/zero5-c51-v1/import-final/train.mixed.grouped.z5pack \
  "$(jq -r .pilot.training_packs_sha256 "$AUTH")"
check_hash build/zero5-c43-v1/import-final/frozen-validation/validation.z5pack \
  "$(jq -r .pilot.validation_packs_sha256 "$AUTH")"
check_hash build/zero5-c51-statebridge-v1/control/best.ckpt \
  "$(jq -r .pilot.control_checkpoint_sha256 "$AUTH")"
check_hash build/zero5-c51-statebridge-v1/control/result.json \
  "$(jq -r .pilot.control_result_sha256 "$AUTH")"

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/source"
source_commit=$(git rev-parse HEAD)
git archive "$source_commit" | tar -xf - -C "$stage/source"
printf '%s\n' "$source_commit" > "$stage/source/SOURCE_COMMIT"
COPYFILE_DISABLE=1 tar -czf "$stage/source.tar.gz" -C "$stage/source" .
COPYFILE_DISABLE=1 tar -czf "$stage/assets.tar.gz" \
  -C "$ZERO5_ASSET_ROOT" "${required[@]}"

source_sha256=$(digest_file "$stage/source.tar.gz")
asset_sha256=$(digest_file "$stage/assets.tar.gz")
authorization_sha256=$(digest_file "$AUTH")
prefix=experiments/zero5-ht1-mergetree-v1/inputs
source_key="${prefix}/source-${source_commit}-${source_sha256}.tar.gz"
asset_key="${prefix}/assets-${asset_sha256}.tar.gz"

if [ "$action" = upload ]; then
  test "$(jq -r .scope.source_upload_authorized "$AUTH")" = true
  test "$(jq -r .scope.private_artifact_upload_authorized "$AUTH")" = true
  test "$(jq -r '.upload.authorization_id // empty' "$AUTH")" != ""
  put_immutable() {
    file=$1
    key=$2
    digest=$3
    content_type=$4
    head_file=$(mktemp)
    if aws s3api head-object --region "$ZERO5_REGION" \
        --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" \
        --no-cli-pager >"$head_file" 2>/dev/null; then
      test "$(jq -r '.Metadata.sha256 // ""' "$head_file")" = "$digest"
    else
      aws s3api put-object --region "$ZERO5_REGION" \
        --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" --body "$file" \
        --metadata "sha256=${digest}" --content-type "$content_type" \
        --if-none-match '*' --no-cli-pager >/dev/null
    fi
  }
  put_immutable "$stage/source.tar.gz" "$source_key" "$source_sha256" \
    application/gzip
  put_immutable "$stage/assets.tar.gz" "$asset_key" "$asset_sha256" \
    application/gzip
fi

jq -n --arg action "$action" --arg bucket "$ZERO5_TRAINING_BUCKET" \
  --arg region "$ZERO5_REGION" --arg source_commit "$source_commit" \
  --arg authorization_sha256 "$authorization_sha256" \
  --arg source_key "$source_key" --arg source_sha256 "$source_sha256" \
  --arg asset_key "$asset_key" --arg asset_sha256 "$asset_sha256" \
  '{schema:"zero.ht1_aws_stage.v1",action:$action,bucket:$bucket,
    region:$region,source_commit:$source_commit,
    authorization_sha256:$authorization_sha256,
    source:{classification:"repository source",key:$source_key,
      sha256:$source_sha256},
    assets:{classification:"private model and tokenized experiment inputs",
      key:$asset_key,sha256:$asset_sha256}}'
