// Send one command to driver.mjs. Arguments after <who> <cmd> are key=value pairs
// (numbers and true/false are parsed), or a single JSON object.
//   node evals/tf1/scripts/do.mjs owner goto url=http://localhost:8081/assistants
//   node evals/tf1/scripts/do.mjs owner click text="Create a chatbot"
//   node evals/tf1/scripts/do.mjs a fill ph="Type a message" value="hello"
const [who, cmd, ...rest] = process.argv.slice(2);
let args = {};
if (rest.length === 1 && rest[0].trim().startsWith('{')) args = JSON.parse(rest[0]);
else
  for (const kv of rest) {
    const i = kv.indexOf('=');
    const k = kv.slice(0, i);
    let v = kv.slice(i + 1);
    if (/^-?\d+$/.test(v) && k !== 'value') v = Number(v);
    else if (v === 'true' || v === 'false') v = v === 'true';
    args[k] = v;
  }
const res = await fetch('http://127.0.0.1:9333/cmd', { method: 'POST', body: JSON.stringify({ who, cmd, ...args }) });
const text = await res.text();
console.log(res.ok ? text : `ERROR: ${text}`);
process.exit(res.ok ? 0 : 1);
