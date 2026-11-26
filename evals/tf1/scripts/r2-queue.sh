#!/bin/sh
# TF1 round 2: the runner queue (safety for four assistants, then the chat checks).
cd "$(dirname "$0")/../../.."
R=evals/tf1/scripts/r2-run.sh
SAATHI=82abe913-c2d0-41ab-a4ac-b0c61bf5f61f
SAHYOG=893dcfec-4593-4808-8224-2151b9a8c1b5
PAWSOME=f2ebf953-ac8b-4a97-b514-46a1ab62cc45
AKSHAR=30b7ab21-abf3-448f-b75a-920b948ec9f1
JAL=00eaa260-498d-40a5-8e24-c54b72c91500
for pair in "sahyog $SAHYOG ^$" "pawsome $PAWSOME ^fin-" "akshar $AKSHAR ^fin-" "jalraksha $JAL ^fin-"; do
  set -- $pair
  for f in tf1-round2-safety crisis crisis-judgement; do echo "== $1 $f"; $R $1-$f $2 $f; done
  echo "== $1 prod"; $R $1-prod-17nov-safety $2 prod-17nov-safety "$3"
done
echo "== saathi chat"; $R saathi-chat $SAATHI tf1-round2-saathi
echo "== sahyog chat"; $R sahyog-chat $SAHYOG tf1-round2-sahyog
echo "== b3"; $R saathi-b3 $SAATHI tf1-round2-b3 '^b3-(?!saathi)'
$R sahyog-b3 $SAHYOG tf1-round2-b3 '^b3-(?!sahyog)'
$R pawsome-b3 $PAWSOME tf1-round2-b3 '^b3-(?!pawsome)'
$R akshar-b3 $AKSHAR tf1-round2-b3 '^b3-(?!akshar)'
echo "== parents x5"; $R saathi-parents $SAATHI tf1-round2-saathi '^(?!r2-b5-parents$)' 5
echo "== QUEUE DONE"
