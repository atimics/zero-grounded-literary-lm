#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 <describe-exit> <stdout-file> <stderr-file>" >&2
  exit 2
}

classify() {
  local describe_exit=$1
  local stdout_file=$2
  local stderr_file=$3
  local prior_state
  local prior_state_basis
  local aws_error_code

  [[ "$describe_exit" =~ ^[0-9]+$ ]] || usage
  test -f "$stdout_file"
  test -f "$stderr_file"

  if test "$describe_exit" -eq 0; then
    if test -s "$stderr_file"; then
      cat "$stderr_file" >&2
      echo "Refusing retry: successful DescribeInstances wrote to stderr" >&2
      return 1
    fi
    prior_state=$(tr -d '\r\n' < "$stdout_file")
    if test "$prior_state" != terminated; then
      echo "Refusing retry: prior instance state is $prior_state" >&2
      return 1
    fi
    prior_state_basis=described-terminated
  else
    if test -s "$stdout_file"; then
      echo "Refusing retry: failed DescribeInstances also returned state output" >&2
      return 1
    fi
    aws_error_code=$(sed -nE \
      's/.*An error occurred \(([^)]+)\) when calling the DescribeInstances operation:.*/\1/p' \
      "$stderr_file")
    if test "$aws_error_code" != InvalidInstanceID.NotFound; then
      cat "$stderr_file" >&2
      echo "Refusing retry: DescribeInstances failed without exact InvalidInstanceID.NotFound" >&2
      return 1
    fi
    prior_state=not-found
    prior_state_basis=aged-out-after-immutable-termination-evidence
  fi

  printf 'prior_instance_state=%s\n' "$prior_state"
  printf 'prior_instance_state_basis=%s\n' "$prior_state_basis"
}

self_test() {
  local actual
  local expected

  test_dir=$(mktemp -d "${TMPDIR:-/tmp}/q27-prior-instance.XXXXXX")
  trap 'rm -r "$test_dir"' EXIT
  : > "$test_dir/empty"

  printf 'terminated\n' > "$test_dir/terminated.out"
  actual=$(classify 0 "$test_dir/terminated.out" "$test_dir/empty")
  expected=$'prior_instance_state=terminated\nprior_instance_state_basis=described-terminated'
  test "$actual" = "$expected"

  printf '%s\n' \
    "aws: [ERROR]: An error occurred (InvalidInstanceID.NotFound) when calling the DescribeInstances operation: The instance ID does not exist" \
    > "$test_dir/not-found.err"
  actual=$(classify 254 "$test_dir/empty" "$test_dir/not-found.err")
  expected=$'prior_instance_state=not-found\nprior_instance_state_basis=aged-out-after-immutable-termination-evidence'
  test "$actual" = "$expected"

  if classify 254 "$test_dir/terminated.out" \
    "$test_dir/not-found.err" >/dev/null 2>&1; then
    echo "self-test failed: conflicting NotFound output was accepted" >&2
    exit 1
  fi

  printf 'None\n' > "$test_dir/none.out"
  if classify 0 "$test_dir/none.out" "$test_dir/empty" >/dev/null 2>&1; then
    echo "self-test failed: successful None response was accepted" >&2
    exit 1
  fi

  printf 'running\n' > "$test_dir/running.out"
  if classify 0 "$test_dir/running.out" "$test_dir/empty" >/dev/null 2>&1; then
    echo "self-test failed: running instance was accepted" >&2
    exit 1
  fi

  printf '%s\n' \
    "An error occurred (AccessDenied) when calling the DescribeInstances operation: denied" \
    > "$test_dir/access-denied.err"
  if classify 254 "$test_dir/empty" "$test_dir/access-denied.err" >/dev/null 2>&1; then
    echo "self-test failed: unexpected AWS error was accepted" >&2
    exit 1
  fi

  printf '%s\n' \
    "An error occurred (InvalidInstanceID.NotFound) when calling the StopInstances operation: missing" \
    > "$test_dir/wrong-operation.err"
  if classify 254 "$test_dir/empty" "$test_dir/wrong-operation.err" >/dev/null 2>&1; then
    echo "self-test failed: NotFound from the wrong operation was accepted" >&2
    exit 1
  fi

  echo "Q2.7 prior-instance classification self-test passed"
}

if test "${1:-}" = --self-test; then
  test "$#" -eq 1 || usage
  self_test
  exit 0
fi

test "$#" -eq 3 || usage
classify "$@"
