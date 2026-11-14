# Eval report: baseline · oracle-check mode

- repo: `be51a396e70f` · prompts: fix.v2, investigate.v3, reproduce.v5, review.v3, triage.v3 · models: {'triage': 'openai:gpt-5-mini', 'investigate': 'openai:gpt-5', 'fix': 'openai:gpt-5', 'review': 'google_genai:gemini-2.5-pro', 'embeddings': 'openai:text-embedding-3-small'}
- run at 2026-11-11T05:48:30+00:00 · cases: 14 · stopped: no (completed)

| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass | Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| total | 14 | 14 | 0 | 0% | – | 100% | 100% | 0% | 7 | 0 | $0.00 | 1150 | 71 |
| ally-ai | 1 | 1 | 0 | 0% | – | – | – | – | 1 | 0 | $0.00 | 0 | 0 |
| ally-be | 8 | 8 | 0 | 0% | – | 100% | 100% | 0% | 5 | 0 | $0.00 | 378 | 18 |
| ally-web | 5 | 5 | 0 | 0% | – | 100% | 100% | 0% | 1 | 0 | $0.00 | 772 | 53 |

## Cases

| id | kind | expected | outcome | repro | oracle | review | fix tries | ended as | tokens | cost | s | trace | error / stop reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ally-be-582b1d5f` | bug | fix | error | – | – | – | 0 | – | 0 | $0.000 | 0 | – | SandboxError: ally-be: install failed (1): orm's native DOMException instead
npm |
| `ally-be-532727f9` | bug | fix | error | – | – | – | 0 | – | 0 | $0.000 | 0 | – | SandboxError: ally-be: install failed (1): npm error code ENOTFOUND
npm error sy |
| `ally-be-0060266c` | bug | fix | error | – | – | – | 0 | – | 0 | $0.000 | 0 | – | SandboxError: ally-be: install failed (1): npm error code ENOTFOUND
npm error sy |
| `ally-be-25c97c58` | bug | fix | error | – | – | – | 0 | – | 0 | $0.000 | 0 | – | SandboxError: ally-be: install failed (1): npm warn deprecated node-domexception |
| `ally-be-d6e4d7ec` | bug | escalate | error | – | – | – | 0 | – | 0 | $0.000 | 0 | – | SandboxError: ally-be: install failed (1): npm warn deprecated node-domexception |
| `ally-be-b2f2d586` | bug | escalate | oracle_proven | yes | yes | – | 0 | – | 0 | $0.000 | 239 | – |  |
| `ally-be-4ce96778` | bug | fix | oracle_proven | yes | yes | – | 0 | – | 0 | $0.000 | 59 | – |  |
| `ally-be-68a34a82` | bug | fix | oracle_proven | yes | yes | – | 0 | – | 0 | $0.000 | 80 | – |  |
| `ally-web-a33574d4` | bug | fix | oracle_proven | yes | yes | – | 0 | – | 0 | $0.000 | 247 | – |  |
| `ally-web-a881b21b` | bug | fix | oracle_proven | yes | yes | – | 0 | – | 0 | $0.000 | 234 | – |  |
| `ally-web-596a0eef` | bug | fix | oracle_proven | yes | yes | – | 0 | – | 0 | $0.000 | 277 | – |  |
| `ally-web-2d664deb` | bug | escalate | oracle_proven | yes | yes | – | 0 | – | 0 | $0.000 | 14 | – |  |
| `ally-web-eeaf1395` | bug | fix | error | – | – | – | 0 | – | 0 | $0.000 | 0 | – | SandboxError: ally-web: install failed (1): npm warn ERESOLVE overriding peer de |
| `ally-ai-11eef73c` | bug | fix | error | – | – | – | 0 | – | 0 | $0.000 | 0 | – | SandboxError: ally-ai: install failed (1): The virtual environment found in /wor |

Fix pass: oracle 7/7; adjusted (human review for oracle_shape cases) 7/7

Today's model spend on this machine: $12.00 of the $15 daily cap (runs/spend.json)

Cost: $0.00 of the $10.00 cap · cases done 14 · remaining 0