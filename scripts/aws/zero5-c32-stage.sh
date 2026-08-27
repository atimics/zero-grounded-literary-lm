#!/bin/bash

set -Eeuo pipefail

: "${ZERO5_TRAINING_BUCKET:?ZERO5_TRAINING_BUCKET is required}"
ZERO5_REGION=${ZERO5_REGION:-us-east-1}
test "$ZERO5_REGION" = us-east-1
git diff --quiet
git diff --cached --quiet

source_commit=$(git rev-parse HEAD)
digest_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}
contract_sha256=$(digest_file benchmarks/zero5-c32-v1/contract.json)
node scripts/check_zero5_c32.mjs

required=(
  build/zero5-c0-v1/corpus-one/byte-bpe512.sero
  build/zero5-c0-v1/corpus-one/train.byte-bpe512.tok
  build/zero5-c0-v1/corpus-one/validation.byte-bpe512.tok
  build/zero5-c2-v1/run/best.ckpt
  build/zero5-c2-v1/import-final/atlas.train.byte-bpe512.tok
  build/zero5-c2-v1/import-final/atlas.validation.byte-bpe512.tok
  build/zero5-c32-v1/import-final
)
for file in "${required[@]}"; do
  test -e "$file" || { echo "missing AWS asset: $file" >&2; exit 1; }
done

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/source" "$stage/assets"
git archive "$source_commit" | tar -xf - -C "$stage/source"
printf '%s\n' "$source_commit" > "$stage/source/SOURCE_COMMIT"
COPYFILE_DISABLE=1 tar -czf "$stage/source.tar.gz" -C "$stage/source" .

for file in "${required[@]}"; do
  mkdir -p "$stage/assets/$(dirname "$file")"
  cp -R "$file" "$stage/assets/$file"
done
COPYFILE_DISABLE=1 tar -czf "$stage/assets.tar.gz" -C "$stage/assets" .

source_sha256=$(digest_file "$stage/source.tar.gz")
asset_sha256=$(digest_file "$stage/assets.tar.gz")
source_key="experiments/zero5-c32-v1/inputs/source-${source_commit}-${source_sha256}.tar.gz"
asset_key="experiments/zero5-c32-v1/inputs/assets-${asset_sha256}.tar.gz"

put_immutable() {
  file=$1
  key=$2
  digest=$3
  content_type=$4
  if aws s3api head-object --region "$ZERO5_REGION" \
      --bucket "$ZERO5_TRAINING_BUCKET" --key "$key" \
      --no-cli-pager >/tmp/zero5-c32-head.json 2>/dev/null; then
    observed=$(jq -r '.Metadata.sha256 // ""' /tmp/zero5-c32-head.json)
    test "$observed" = "$digest"
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

recovery_checkpoint=build/zero5-c32-v1/run/D/best.ckpt
recovery_sha256=$(jq -r .arm_d.checkpoint_sha256 \
  benchmarks/zero5-c32-v1/local-partial-run.json)
test -f "$recovery_checkpoint"
test "$(digest_file "$recovery_checkpoint")" = "$recovery_sha256"
recovery_key="experiments/zero5-c32-v1/recovery/local-partial-D-update2500-${recovery_sha256}.ckpt"
put_immutable "$recovery_checkpoint" "$recovery_key" "$recovery_sha256" \
  application/octet-stream

jq -n --arg source_commit "$source_commit" \
  --arg contract_sha256 "$contract_sha256" \
  --arg source_key "$source_key" --arg source_sha256 "$source_sha256" \
  --arg asset_key "$asset_key" --arg asset_sha256 "$asset_sha256" \
  --arg recovery_key "$recovery_key" \
  --arg recovery_sha256 "$recovery_sha256" \
  --arg bucket "$ZERO5_TRAINING_BUCKET" \
  '{schema:"zero.c32_aws_stage.v1",source_commit:$source_commit,
    contract_sha256:$contract_sha256,training_bucket:$bucket,
    source:{key:$source_key,sha256:$source_sha256},
    assets:{key:$asset_key,sha256:$asset_sha256},
    recovery:{private:true,key:$recovery_key,sha256:$recovery_sha256}}'
