# Eval report: baseline · oracle-check mode

- repo: `f235c312f350` · prompts: none (chunk 04) · models: {'triage': 'openai:gpt-5-mini', 'investigate': 'openai:gpt-5', 'fix': 'openai:gpt-5', 'review': 'google_genai:gemini-2.5-pro', 'embeddings': 'openai:text-embedding-3-small'}
- run at 2026-11-09T10:26:35+00:00 · cases: 2 · stopped: no (completed)

| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass | Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| total | 2 | 2 | 0 | 0% | – | 100% | 100% | 0% | 0 | 0 | $0.00 | 144 | 21 |
| ally-be | 2 | 2 | 0 | 0% | – | 100% | 100% | 0% | 0 | 0 | $0.00 | 144 | 21 |

## Cases

| id | kind | expected | outcome | repro | oracle | s | error |
|---|---|---|---|---|---|---|---|
| `ally-be-6083b8d8` | bug | escalate | oracle_proven | yes | yes | 75 |  |
| `ally-be-87c6ecb8` | bug | escalate | oracle_proven | yes | yes | 69 |  |