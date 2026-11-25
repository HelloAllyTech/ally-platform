#!/bin/sh
# Bot page: <who> types <text>, waits until the reply settles, prints the new text and the buttons.
#   evals/tf1/scripts/say.sh a "What are your hours?"      (or --tap "Confirm" to click a button)
D="$(dirname "$0")/d"
who=$1; shift
before=$($D $who eval js="document.body.innerText.length")
if [ "$1" = "--tap" ]; then
  $D $who click role=button name="$2" exact=true after=1500 >/dev/null || exit 1
else
  $D $who fill ph="Type your question…" value="$1" >/dev/null || exit 1
  $D $who press key=Enter after=1500 >/dev/null
fi
# Settle: the body text stops changing for 5 s (max ~90 s).
last=""; same=0; i=0
while [ $i -lt 45 ]; do
  cur=$($D $who eval js="document.body.innerText.length")
  if [ "$cur" = "$last" ]; then same=$((same+1)); else same=0; fi
  [ $same -ge 3 ] && break
  last=$cur; i=$((i+1)); sleep 2
done
$D $who eval js="(()=>{const t=document.body.innerText;const i=t.lastIndexOf('You:');return t.slice(i).replace(/\\n(Was this helpful\\?|👍|👎|Your message|Talk to a person|Why this answer\\?[^\\n]*)/g,'')})()" | sed 's/\\n/\n/g'
echo "--- buttons:"
$D $who eval js="[...document.querySelectorAll('main button, [class*=chat] button, button')].map(b=>b.innerText.trim()).filter(t=>t&&!['New chat','Talk to a person','Send'].includes(t)).slice(-12).join(' | ')"
