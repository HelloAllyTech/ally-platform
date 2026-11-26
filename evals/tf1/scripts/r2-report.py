#!/usr/bin/env python3
"""TF1 round 2: summarise evals/tf1/runs/round2/*.json (runner reports)."""
import json, glob, os, sys, statistics
root = os.path.join(os.path.dirname(__file__), '..', 'runs', 'round2')
mode = sys.argv[1] if len(sys.argv) > 1 else 'summary'
files = sorted(glob.glob(os.path.join(root, '*.json')))
lat = {}
allturns = []
for f in files:
    label = os.path.basename(f)[:-5]
    bot = label.split('-')[0]
    d = json.load(open(f))
    rep = d['report']
    c = d['crisis']
    if mode == 'summary':
        npass = sum(1 for r in rep if r['passed'])
        print(f"{label}: {npass}/{len(rep)} cases passed every run (x{d['repeat']}); crisis misses {c['misses']} {c['missesPerRun']}; "
              f"false alarms classifier {c['falseAlarms']['classifier']} keyword {c['falseAlarms']['keyword']}")
    for r in rep:
        for ri, run in enumerate(r['runs']):
            for t in run:
                allturns.append((bot, label, r['id'], t))
                if not (t['handledBy'] == 'crisis' and t.get('crisisLayer') == 'keyword') and t.get('latencyMs') is not None:
                    lat.setdefault(bot, []).append(t['latencyMs'])
        if mode == 'fails' and not r['passed']:
            print(f"\n### {label} {r['id']} ({r['kind']}) [{r['failedRuns']}/{len(r['runs'])} runs failed]")
            for ti, turn in enumerate(r['turns']):
                print(f"  sent: {turn['user']}\n  expected: {json.dumps(turn.get('expect'), ensure_ascii=False)}")
            for ri, run in enumerate(r['runs']):
                for t in run:
                    if t['failures']:
                        print(f"  run {ri+1} [{t['handledBy']}{'/'+t['crisisLayer'] if t.get('crisisLayer') else ''} {t.get('latencyMs')}ms] > {t['user']}\n    < {t['reply'][:700]!r}\n    ✗ {'; '.join(t['failures'])}")
if mode == 'latency':
    def pct(v, p):
        v = sorted(v); k = (len(v) - 1) * p; lo = int(k); hi = min(lo + 1, len(v) - 1)
        return v[lo] + (v[hi] - v[lo]) * (k - lo)
    for bot, v in lat.items():
        print(f"{bot}: n={len(v)} p50={pct(v,.5)/1000:.1f}s p95={pct(v,.95)/1000:.1f}s max={max(v)/1000:.1f}s")
    slow = sorted([x for x in allturns if x[3].get('latencyMs') is not None and not (x[3]['handledBy']=='crisis' and x[3].get('crisisLayer')=='keyword')], key=lambda x: -x[3]['latencyMs'])[:8]
    for bot, label, cid, t in slow:
        print(f"  {t['latencyMs']/1000:.1f}s {bot} {cid} [{t['handledBy']}] {t['user'][:80]!r}")
if mode == 'replies':
    pat = sys.argv[2]
    for bot, label, cid, t in allturns:
        if pat in label:
            print(f"{label} {cid} [{t['handledBy']}{'/'+t['crisisLayer'] if t.get('crisisLayer') else ''} {t.get('latencyMs')}ms] > {t['user']}\n   < {t['reply'][:600]!r}" + (f"\n   tools: {t.get('gatewaySteps')}" if t.get('gatewaySteps') else '') + (f"\n   ✗ {t['failures']}" if t['failures'] else ''))
