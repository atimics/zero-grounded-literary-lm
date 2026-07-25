#!/bin/bash
# Administrative collector recovery for the frozen LAMBADA identifier mismatch.
# This script cannot wait, launch, restart, or otherwise start compute.

set -Eeuo pipefail

: "${ZERO_BUCKET:?ZERO_BUCKET is required}"
: "${ZERO_SOURCE_RUN_ID:?ZERO_SOURCE_RUN_ID is required}"
: "${ZERO_FAILED_COLLECTOR_RUN_ID:?ZERO_FAILED_COLLECTOR_RUN_ID is required}"
: "${ZERO_RECOVERY_RUN_ID:?ZERO_RECOVERY_RUN_ID is required}"
: "${ZERO_RECOVERY_COMMIT:?ZERO_RECOVERY_COMMIT is required}"
: "${ZERO_BUDGET_FILE:?ZERO_BUDGET_FILE is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

COLLECTION=/tmp/zero-eval1-screen-recovery
ROOT=benchmarks/zero-eval-1/screen
RESULTS="$ROOT/results"
CONTRACT="$ROOT/contract.json"
COMPAT=scripts/check_zero_eval1_screen_lambada_compat.mjs
WORKFLOW=.github/workflows/zero-eval1-screen-collect-recovery.yml
RECOVERY_SCRIPT=scripts/aws/zero-eval1-screen-collect-recovery.sh

[[ "$ZERO_SOURCE_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$ZERO_FAILED_COLLECTOR_RUN_ID" =~ ^[0-9]+$ ]]
[[ "$ZERO_RECOVERY_RUN_ID" =~ ^[0-9]+$ ]]
test ! -e "$ROOT/aws/COMPLETED"
node scripts/check_zero_eval1_screen_budget.mjs "$ZERO_BUDGET_FILE"
ZERO_BUDGET_SHA256=$(sha256sum "$ZERO_BUDGET_FILE" | awk '{print $1}')

gh run view "$ZERO_FAILED_COLLECTOR_RUN_ID" \
  --repo atimics/zero-grounded-literary-lm \
  --json conclusion,headSha,event > /tmp/zero-eval1-failed-collector.json
jq -e \
  --arg source_commit 38e6b8454ed30b8e2cba6d10325d5c1fac4c7729 \
  '.conclusion == "failure"
   and .headSha == $source_commit
   and .event == "workflow_dispatch"' \
  /tmp/zero-eval1-failed-collector.json >/dev/null

mkdir -p "$COLLECTION"
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_SOURCE_RUN_ID}/launch.json" \
  "$COLLECTION/launch.json" --no-cli-pager
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_SOURCE_RUN_ID}/status.json" \
  "$COLLECTION/status.json" --no-cli-pager
test "$(jq -r '.status' "$COLLECTION/status.json")" = complete
aws s3 cp "s3://${ZERO_BUCKET}/jobs/${ZERO_SOURCE_RUN_ID}/results/result.json" \
  "$COLLECTION/result.json" --no-cli-pager

ZERO_SOURCE_COMMIT=$(jq -r '.git_commit' "$COLLECTION/launch.json")
test "$ZERO_SOURCE_COMMIT" = 38e6b8454ed30b8e2cba6d10325d5c1fac4c7729
test "$(jq -r '.ci_run_id' "$COLLECTION/launch.json")" = "$ZERO_SOURCE_RUN_ID"
git cat-file -e "${ZERO_SOURCE_COMMIT}^{commit}"
git merge-base --is-ancestor "$ZERO_SOURCE_COMMIT" HEAD
node "$COMPAT" \
  --published \
    "$COLLECTION/launch.json" \
    "$COLLECTION/status.json" \
    "$COLLECTION/result.json" \
  --commit "$ZERO_SOURCE_COMMIT" \
  --budget-sha256 "$ZERO_BUDGET_SHA256"

instance=$(jq -r '.instance_id' "$COLLECTION/launch.json")
state=$(aws ec2 describe-instances --instance-ids "$instance" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text --no-cli-pager)
test "$state" = terminated
jq -n \
  --arg instance_id "$instance" \
  --arg observed_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    schema: "zero.aws_terminal_observation.v1",
    experiment: "zero-eval-1-screen-v1",
    instance_id: $instance_id,
    state: "terminated",
    observed_at: $observed_at
  }' > "$COLLECTION/terminal.json"

jq -n \
  --arg source_run_id "$ZERO_SOURCE_RUN_ID" \
  --arg collector_run_id "$ZERO_RECOVERY_RUN_ID" \
  --arg git_commit "$ZERO_SOURCE_COMMIT" \
  --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
  '{
    schema: "zero.aws_collector_lock.v1",
    experiment: "zero-eval-1-screen-v1",
    source_run_id: $source_run_id,
    collector_run_id: $collector_run_id,
    git_commit: $git_commit,
    budget_sha256: $budget_sha256,
    recovery: "frozen-lambada-identifier"
  }' > "$COLLECTION/collector-lock.json"
set +e
aws s3api put-object --bucket "$ZERO_BUCKET" \
  --key experiments/zero-eval-1-screen-v1/collector.lock \
  --body "$COLLECTION/collector-lock.json" \
  --content-type application/json --if-none-match '*' \
  --no-cli-pager >/dev/null 2>"$COLLECTION/collector-lock.err"
lock_exit=$?
set -e
if [ "$lock_exit" -ne 0 ]; then
  aws s3 cp \
    "s3://${ZERO_BUCKET}/experiments/zero-eval-1-screen-v1/collector.lock" \
    "$COLLECTION/existing-collector-lock.json" --no-cli-pager
  jq -e \
    --arg source_run_id "$ZERO_SOURCE_RUN_ID" \
    --arg git_commit "$ZERO_SOURCE_COMMIT" \
    --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
    '.schema == "zero.aws_collector_lock.v1"
     and .experiment == "zero-eval-1-screen-v1"
     and .source_run_id == $source_run_id
     and .git_commit == $git_commit
     and .budget_sha256 == $budget_sha256' \
    "$COLLECTION/existing-collector-lock.json" >/dev/null
fi

mkdir -p "$RESULTS"
cp "$COLLECTION/launch.json" "$RESULTS/launch-${ZERO_SOURCE_RUN_ID}.json"
cp "$COLLECTION/status.json" "$RESULTS/status-${ZERO_SOURCE_RUN_ID}.json"
cp "$COLLECTION/terminal.json" "$RESULTS/terminal-${ZERO_SOURCE_RUN_ID}.json"
cp "$COLLECTION/result.json" "$RESULTS/result.json"
node scripts/render_zero_eval1_screen_results.mjs \
  "$RESULTS/result.json" "$ROOT/RESULTS.md"

result_sha256=$(sha256sum "$RESULTS/result.json" | awk '{print $1}')
compat_sha256=$(sha256sum "$COMPAT" | awk '{print $1}')
workflow_sha256=$(sha256sum "$WORKFLOW" | awk '{print $1}')
recovery_script_sha256=$(sha256sum "$RECOVERY_SCRIPT" | awk '{print $1}')
jq -n \
  --arg source_run_id "$ZERO_SOURCE_RUN_ID" \
  --arg failed_collector_run_id "$ZERO_FAILED_COLLECTOR_RUN_ID" \
  --arg recovery_run_id "$ZERO_RECOVERY_RUN_ID" \
  --arg recovery_commit "$ZERO_RECOVERY_COMMIT" \
  --arg original_result_sha256 "$result_sha256" \
  --arg compatibility_checker_sha256 "$compat_sha256" \
  --arg recovery_workflow_sha256 "$workflow_sha256" \
  --arg recovery_script_sha256 "$recovery_script_sha256" \
  '{
    schema: "zero.external_eval_validation_repair.v1",
    experiment: "zero-eval-1-screen-v1",
    source_run_id: $source_run_id,
    failed_collector_run_id: $failed_collector_run_id,
    recovery_run_id: $recovery_run_id,
    recovery_commit: $recovery_commit,
    root_cause: "prepared LAMBADA rows freeze benchmark=lambada_openai while the first collector validator expected task key lambada",
    frozen_identifier: "lambada_openai",
    contract_identifier: "lambada",
    repair_scope: "normalize the two nested benchmark labels in an in-memory validation copy only",
    original_result_sha256: $original_result_sha256,
    compatibility_checker_sha256: $compatibility_checker_sha256,
    recovery_workflow_sha256: $recovery_workflow_sha256,
    recovery_script_sha256: $recovery_script_sha256,
    scientific_values_changed: false,
    compute_restarted: false
  }' > "$RESULTS/validation-repair-${ZERO_FAILED_COLLECTOR_RUN_ID}.json"

contract_sha256=$(sha256sum "$CONTRACT" | awk '{print $1}')
launch_sha256=$(sha256sum "$RESULTS/launch-${ZERO_SOURCE_RUN_ID}.json" | awk '{print $1}')
status_sha256=$(sha256sum "$RESULTS/status-${ZERO_SOURCE_RUN_ID}.json" | awk '{print $1}')
terminal_sha256=$(sha256sum "$RESULTS/terminal-${ZERO_SOURCE_RUN_ID}.json" | awk '{print $1}')
report_sha256=$(sha256sum "$ROOT/RESULTS.md" | awk '{print $1}')
repair_path="$RESULTS/validation-repair-${ZERO_FAILED_COLLECTOR_RUN_ID}.json"
repair_sha256=$(sha256sum "$repair_path" | awk '{print $1}')
jq -n \
  --arg source_run_id "$ZERO_SOURCE_RUN_ID" \
  --arg git_commit "$ZERO_SOURCE_COMMIT" \
  --arg instance_id "$instance" \
  --arg contract_path "$CONTRACT" \
  --arg contract_sha256 "$contract_sha256" \
  --arg budget_path "$ZERO_BUDGET_FILE" \
  --arg budget_sha256 "$ZERO_BUDGET_SHA256" \
  --arg launch_path "$RESULTS/launch-${ZERO_SOURCE_RUN_ID}.json" \
  --arg launch_sha256 "$launch_sha256" \
  --arg status_path "$RESULTS/status-${ZERO_SOURCE_RUN_ID}.json" \
  --arg status_sha256 "$status_sha256" \
  --arg terminal_path "$RESULTS/terminal-${ZERO_SOURCE_RUN_ID}.json" \
  --arg terminal_sha256 "$terminal_sha256" \
  --arg result_path "$RESULTS/result.json" \
  --arg result_sha256 "$result_sha256" \
  --arg report_path "$ROOT/RESULTS.md" \
  --arg report_sha256 "$report_sha256" \
  --arg validation_repair_path "$repair_path" \
  --arg validation_repair_sha256 "$repair_sha256" \
  '{
    schema: "zero.external_eval_screen_completion.v1",
    id: "zero-eval-1-screen-v1",
    status: "complete",
    authorization_consumed: true,
    source_run_id: $source_run_id,
    git_commit: $git_commit,
    instance_id: $instance_id,
    instance_state: "terminated",
    training_updates: 0,
    contract_path: $contract_path,
    contract_sha256: $contract_sha256,
    budget_path: $budget_path,
    budget_sha256: $budget_sha256,
    launch_path: $launch_path,
    launch_sha256: $launch_sha256,
    status_path: $status_path,
    status_sha256: $status_sha256,
    terminal_path: $terminal_path,
    terminal_sha256: $terminal_sha256,
    result_path: $result_path,
    result_sha256: $result_sha256,
    report_path: $report_path,
    report_sha256: $report_sha256,
    validation_repair_path: $validation_repair_path,
    validation_repair_sha256: $validation_repair_sha256
  }' > "$ROOT/aws/COMPLETED"
node "$COMPAT" --completion "$ROOT/aws/COMPLETED"

prefix="exp/zero-eval1-screen-results-${ZERO_SOURCE_RUN_ID}-"
if gh pr list --repo atimics/zero-grounded-literary-lm \
    --state open --json headRefName \
    --jq "any(.headRefName; startswith(\"${prefix}\"))" | grep -q true; then
  echo "A validated results pull request already exists"
  exit 0
fi
branch="${prefix}${ZERO_RECOVERY_RUN_ID}"
git switch -c "$branch"
git config user.name github-actions
git config user.email github-actions@github.com
git add benchmarks/zero-eval-1/screen
git commit -m "Record ZERO-EVAL-1 screen results"
git push --set-upstream origin "$branch"
gh pr create --repo atimics/zero-grounded-literary-lm \
  --base main --head "$branch" \
  --title "Record ZERO-EVAL-1 screen results" \
  --body "Publishes the complete AWS stratified screen without changing any scientific value. The recovery record documents the frozen lambada_openai/lambada validator identifier mismatch from collector run ${ZERO_FAILED_COLLECTOR_RUN_ID}; no compute was restarted."
