# Eval report: baseline · oracle-check mode

- repo: `465ef8e7e4f7` · prompts: none (chunk 04) · models: {'triage': 'openai:gpt-5-mini', 'investigate': 'openai:gpt-5', 'fix': 'openai:gpt-5', 'review': 'google_genai:gemini-2.5-pro', 'embeddings': 'openai:text-embedding-3-small'}
- run at 2026-11-09T09:50:43+00:00 · cases: 1 · stopped: no (completed)

| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass | Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| total | 1 | 1 | 0 | 0% | – | 100% | 100% | – | 0 | 0 | $0.00 | 226 | 13 |
| ally-web | 1 | 1 | 0 | 0% | – | 100% | 100% | – | 0 | 0 | $0.00 | 226 | 13 |

## Cases

| id | kind | expected | outcome | repro | oracle | s | error |
|---|---|---|---|---|---|---|---|
| `ally-web-9299e9aa` | bug | fix | oracle_proven | yes | yes | 226 |  |