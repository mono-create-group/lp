#!/bin/bash
# GAS 自動デプロイスクリプト
# gas_backend.gs を変更したら自動実行される

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOYMENT_ID="AKfycbx5Mta1CzlD-Odanvr9dPtku2TK4PfNe0Fvq_MBHX0UypqY3DgLbZTglcenqf1drfF9vw"

cd "$SCRIPT_DIR"

echo "▶ GAS へプッシュ中..."
clasp push --force

echo "▶ デプロイ中..."
clasp deploy --deploymentId "$DEPLOYMENT_ID" --description "auto-deploy $(date '+%Y-%m-%d %H:%M')"

echo "✅ GAS デプロイ完了"
