// TF1 round 2: send one bot-page message and watch the reply as it arrives, every 400 ms.
// Flags a "swap": the reply text changing to something that doesn't continue what was shown.
//   node evals/tf1/scripts/say-watch.mjs <who> "<text>" | --tap "<button>"
const [who, a1, a2] = process.argv.slice(2);
const d = async (cmd, args = {}) => {
  const r = await fetch('http://127.0.0.1:9333/cmd', { method: 'POST', body: JSON.stringify({ who, cmd, ...args }) });
  const t = await r.text(); if (!r.ok) throw new Error(t); return t;
};
const tail = async () => JSON.parse(await d('eval', { js: `(()=>{const t=document.body.innerText;const i=t.lastIndexOf('You:');return i<0?t.slice(-1500):t.slice(i)})()` }));
const t0 = Date.now();
if (a1 === '--tap') await d('click', { role: 'button', name: a2, exact: true, after: 200 });
else { await d('fill', { ph: 'Type your question…', value: a1 }); await d('press', { key: 'Enter', after: 100 }); }
const snaps = []; let last = ''; let stableSince = Date.now();
while (Date.now() - t0 < 90000) {
  const s = (await tail()).replace(/\n(Was this helpful\?|👍|👎)[^\n]*/g, '');
  if (s !== last) { snaps.push({ ms: Date.now() - t0, s }); last = s; stableSince = Date.now(); }
  else if (Date.now() - stableSince > 5000 && snaps.length > 1) break;
  await new Promise((r) => setTimeout(r, 400));
}
const body = (s) => s.split('\n').slice(2).join('\n').trim();
let swaps = 0;
for (let i = 1; i < snaps.length; i++) {
  const p = body(snaps[i - 1].s), c = body(snaps[i].s);
  if (p.length > 20 && !c.startsWith(p.slice(0, Math.min(p.length, 60)))) { swaps++; console.log(`SWAP at ${snaps[i].ms}ms:\n  before: ${p.slice(0, 200)}\n  after:  ${c.slice(0, 200)}`); }
}
console.log(`[${snaps.length} snapshots; last change at ${snaps.at(-1)?.ms}ms; swaps ${swaps}]`);
console.log(last);
console.log('--- buttons: ' + JSON.parse(await d('eval', { js: `[...document.querySelectorAll('button')].map(b=>b.innerText.trim()).filter(t=>t&&!['New chat','Talk to a person','Send'].includes(t)).slice(-10).join(' | ')` })));
