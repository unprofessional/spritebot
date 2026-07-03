#!/bin/sh
set -e

# Authenticate with Infisical using Universal Auth and get access token
INFISICAL_TOKEN=$(wget -qO- --header="Content-Type: application/json" \
  --post-data="{\"clientId\":\"$INFISICAL_CLIENT_ID\",\"clientSecret\":\"$INFISICAL_CLIENT_SECRET\"}" \
  "$INFISICAL_API_URL/api/v1/auth/universal-auth/login" | \
  node -e "process.stdin.on('data',d=>{console.log(JSON.parse(d).accessToken)})")

export INFISICAL_TOKEN

exec infisical run \
  --domain "$INFISICAL_API_URL" \
  --projectId "$INFISICAL_PROJECT_ID" \
  --env "$INFISICAL_ENV" \
  --token "$INFISICAL_TOKEN" \
  --silent \
  -- node dist/index.js
