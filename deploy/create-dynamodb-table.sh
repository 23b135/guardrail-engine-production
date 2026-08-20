#!/usr/bin/env bash
# Creates the DynamoDB table used by AUDIT_STORE=dynamodb.
# Run once per AWS account/region before deploying with AUDIT_STORE=dynamodb.
set -euo pipefail

TABLE_NAME="${AUDIT_TABLE_NAME:-guardrail-audit-log}"
REGION="${AWS_REGION:-us-east-1}"

aws dynamodb create-table \
  --table-name "$TABLE_NAME" \
  --attribute-definitions AttributeName=id,AttributeType=S \
  --key-schema AttributeName=id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "$REGION"

echo "Waiting for table to become active..."
aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
echo "Table '$TABLE_NAME' is ready in $REGION."
