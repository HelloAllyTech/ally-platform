#!/bin/sh
# TF1 round 2: run one case file against one assistant with the engine runner.
#   r2-run.sh <label> <chatbotId> <case-file-basename> [exclude-regex] [repeat]
# Writes evals/tf1/runs/round2/<label>.txt (report lines) and <label>.json (full report).
label=$1; bot=$2; file=$3; exclude=${4:-^$}; repeat=${5:-3}
root=$(cd "$(dirname "$0")/../../.." && pwd)
ids=$(python3 -c "import json,re,sys;d=json.load(open('$root/ally-be/src/chatbot/basics/cases/$file.json'));print(','.join(c['id'] for c in d if not re.search(r'''$exclude''',c['id'])))")
out=$root/evals/tf1/runs/round2/$label
docker exec -w /app ally-be-app-1 node dist/chatbot/basics/run-basics.js --bot "$bot" --cases "src/chatbot/basics/cases/$file.json" --only "$ids" --repeat "$repeat" --concurrency 3 --out "/tmp/r2-$label.json" 2>&1 \
  | grep -vE '^\S*(\x1b\[[0-9;]*m)?(info|debug|warn|error)|Redis keyspace|^\s*$' > "$out.txt"
docker cp "ally-be-app-1:/tmp/r2-$label.json" "$out.json" >/dev/null 2>&1
grep -E "cases passed|crisis misses|false alarms|FAIL" "$out.txt"
