#!/bin/sh
# Latest bot-page sign-in code from ally-be's development log (SES is a dummy in TF1).
docker logs --since "${1:-2m}" ally-be-app-1 2>&1 | grep "Bot page code" | tail -1 | grep -oE ": [0-9]{6} for" | grep -oE "[0-9]{6}"
