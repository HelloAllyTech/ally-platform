#!/bin/sh
# Prints a fresh owner access token (OTP login through the API, the admin app's roles).
R='["PLATFORM_ADMIN","MULTI_TENANT_ADMIN","ASSISTANT_OWNER","ASSISTANT_MEMBER"]'
E=${1:-tf1-owner@example.com}
curl -s -X POST localhost:8001/api/v2/auth/generate-otp -H 'content-type: application/json' -d "{\"email\":\"$E\",\"allowedRoles\":$R}" >/dev/null
curl -s -X POST localhost:8001/api/v2/auth/verify-otp -H 'content-type: application/json' -d "{\"email\":\"$E\",\"otp\":\"${2:-1234}\",\"allowedRoles\":$R}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["accessToken"])'
