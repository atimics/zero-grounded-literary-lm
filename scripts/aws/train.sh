#!/bin/bash
# Execute the frozen ZERO.4 replication pipeline on an EC2 training instance.

set -euo pipefail

exec > /var/log/zero-train.log 2>&1
set -x

: "${ZERO_BUCKET:?ZERO_BUCKET is required}"
: "${ZERO_RUN_ID:?ZERO_RUN_ID is required}"
: "${ZERO_EXPERIMENT:?ZERO_EXPERIMENT is required}"
: "${ZERO_SEEDS:?ZERO_SEEDS is required}"
: "${ZERO_COMMIT:?ZERO_COMMIT is required}"

STATUS_FILE=/tmp/zero-training-status.json
STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)

case "$ZERO_EXPERIMENT" in
  q22r|q26r) RESULTS_ROOT="/tmp/zero-results/zero4-${ZERO_EXPERIMENT}-v1" ;;
  *)
    echo "Unsupported experiment: $ZERO_EXPERIMENT" >&2
    exit 1
    ;;
esac

finish() {
  exit_code=$?
  trap - EXIT
  set +e
  finished_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  mkdir -p "$RESULTS_ROOT"
  ZERO_EXIT_CODE="$exit_code" ZERO_STARTED_AT="$STARTED_AT" ZERO_FINISHED_AT="$finished_at" \
    python3 - <<'PY'
import json
import os

exit_code = int(os.environ["ZERO_EXIT_CODE"])
record = {
    "schema": "zero.aws_training_status.v1",
    "status": "complete" if exit_code == 0 else "infrastructure-error",
    "exit_code": exit_code,
    "started_at": os.environ["ZERO_STARTED_AT"],
    "finished_at": os.environ["ZERO_FINISHED_AT"],
    "experiment": os.environ["ZERO_EXPERIMENT"],
    "seeds": os.environ["ZERO_SEEDS"],
    "git_commit": os.environ["ZERO_COMMIT"],
}
with open("/tmp/zero-training-status.json", "w", encoding="utf-8") as handle:
    json.dump(record, handle, indent=2)
    handle.write("\n")
PY
  aws s3 sync "$RESULTS_ROOT/" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/results/" \
    --no-cli-pager
  aws s3 cp /var/log/zero-train.log \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/zero-train.log" \
    --no-cli-pager
  aws s3 cp "$STATUS_FILE" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/status.json" \
    --no-cli-pager
  shutdown -h now
  exit "$exit_code"
}
trap finish EXIT

if ! [[ "$ZERO_SEEDS" =~ ^[0-9]+(,[0-9]+)*$ ]]; then
  echo "Seeds must be a comma-separated list of integers" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  build-essential ca-certificates curl libopenblas-dev nodejs npm pkg-config \
  python3

export LITERARY_BACKEND=openblas
export OPENBLAS_NUM_THREADS="$(getconf _NPROCESSORS_ONLN)"

install -d -m 0755 /tmp/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/source.tar.gz" \
  /tmp/zero-source.tar.gz \
  --no-cli-pager
tar -xzf /tmp/zero-source.tar.gz -C /tmp/zero
cd /tmp/zero

# Ignored binary assets live in the private, versioned project artifact store.
aws s3 sync "s3://${ZERO_BUCKET}/assets/teachers/" teachers/ \
  --exclude registry.json --no-cli-pager
aws s3 sync "s3://${ZERO_BUCKET}/assets/corpus/" corpus/ --no-cli-pager
python3 scripts/verify_teacher_artifacts.py

make -j"$(getconf _NPROCESSORS_ONLN)"
make check
if [ "$ZERO_EXPERIMENT" = q22r ]; then
  make zero4-q22-check
else
  make zero4-q26r-check
fi

IFS=',' read -ra seed_array <<< "$ZERO_SEEDS"
for seed in "${seed_array[@]}"; do
  case "$seed" in
    1|3) ;;
    *)
      echo "Replication accepts only outstanding seeds 1 and 3; got $seed" >&2
      exit 1
      ;;
  esac

  echo "=== ${ZERO_EXPERIMENT} replication seed $seed ==="
  seed_dir="$RESULTS_ROOT/seed${seed}"
  prefix="/tmp/zero4-${ZERO_EXPERIMENT}-seed${seed}"
  mkdir -p "$seed_dir"

  if [ "$ZERO_EXPERIMENT" = q22r ]; then
    # Preserve the seed-2 acquisition policy exactly. Constraint-aware stopping
    # may finish before the frozen 1000+400 update budget, as it did for seed 2.
    make zero4-q22-train \
      ZERO4_Q22_STEPS=1000 \
      ZERO4_Q22_CONSOLIDATION_STEPS=400 \
      ZERO4_Q22_BATCH=2 \
      ZERO4_Q22_SEED="$seed" \
      ZERO4_Q22_EXPERIMENT=q22r \
      ZERO4_Q22_PREFIX="$prefix" \
      ZERO4_Q22_RESULTS="$seed_dir"

    selected=$(python3 - "$seed_dir/selection.json" <<'PY'
import json
import sys

selection = json.load(open(sys.argv[1], encoding="utf-8"))
print("yes" if selection.get("selected") else "no")
PY
    )
    if [ "$selected" = yes ]; then
      make zero4-q22-eval \
        ZERO4_Q22_TOTAL_STEPS=1400 \
        ZERO4_Q22_SEED="$seed" \
        ZERO4_Q22_EXPERIMENT=q22r \
        ZERO4_Q22_PREFIX="$prefix" \
        ZERO4_Q22_RESULTS="$seed_dir"
    fi

    python3 scripts/verify_results.py \
      --results-root "$seed_dir" \
      --skip-registry
  else
    make zero4-q26r-train \
      ZERO4_Q26R_SEED="$seed" \
      ZERO4_Q26R_PREFIX="$prefix" \
      ZERO4_Q26R_RESULTS="$seed_dir" \
      ZERO4_Q26R_CONTRACT=benchmarks/zero4-q26r-v1/contract.json

    node scripts/check_zero4_q26r.mjs \
      benchmarks/zero4-q26r-v1/contract.json \
      "$seed_dir/optimizer-attempts.jsonl" \
      "$seed_dir/result.json"
  fi
  aws s3 sync "$seed_dir/" \
    "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/results/seed${seed}/" \
    --no-cli-pager
done

echo "AWS training complete; seed-level results uploaded."
