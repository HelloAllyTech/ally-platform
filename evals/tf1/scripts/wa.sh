#!/bin/sh
# evals/tf1/scripts/wa.sh <from-digits> "<text>"   |   wa.sh <from> --tap <id> "<title>" [--list]
SECRET_FILE=${WA_SECRET_FILE:-/private/tmp/claude-501/-Users-shehbazsayed-Desktop-ally-ally-platform/136076cc-47fc-4ca3-bf71-4e3505723726/scratchpad/tf1-wa-app-secret.txt}
export WA_APP_SECRET=$(cat "$SECRET_FILE")
from=$1; shift
if [ "$1" = "--tap" ]; then exec node "$(dirname "$0")/wa.mjs" --from "$from" --tap "$2" --title "$3" ${4:+--list}; fi
exec node "$(dirname "$0")/wa.mjs" --from "$from" --text "$1"
