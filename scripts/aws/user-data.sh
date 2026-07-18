#!/bin/bash
# EC2 bootstrap. Configuration is read from launch-time instance tags through IMDSv2.

set -euo pipefail

exec > /var/log/zero-bootstrap.log 2>&1
set -x

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq awscli ca-certificates curl python3

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
ZERO_EXPERIMENT="$(tag Experiment)"
ZERO_SEEDS="$(tag Seeds)"
ZERO_COMMIT="$(tag Commit)"
AWS_DEFAULT_REGION="$(tag Region)"
export ZERO_BUCKET ZERO_RUN_ID ZERO_EXPERIMENT ZERO_SEEDS ZERO_COMMIT
export AWS_DEFAULT_REGION

install -d -m 0755 /opt/zero
aws s3 cp \
  "s3://${ZERO_BUCKET}/jobs/${ZERO_RUN_ID}/train.sh" \
  /opt/zero/train.sh \
  --no-cli-pager
chmod 0755 /opt/zero/train.sh
exec /opt/zero/train.sh
