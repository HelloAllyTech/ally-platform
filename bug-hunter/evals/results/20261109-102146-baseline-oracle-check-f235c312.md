# Eval report: baseline · oracle-check mode

- repo: `f235c312f350` · prompts: none (chunk 04) · models: {'triage': 'openai:gpt-5-mini', 'investigate': 'openai:gpt-5', 'fix': 'openai:gpt-5', 'review': 'google_genai:gemini-2.5-pro', 'embeddings': 'openai:text-embedding-3-small'}
- run at 2026-11-09T10:00:43+00:00 · cases: 21 · stopped: no (completed)

| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass | Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| total | 21 | 21 | 0 | 0% | – | 90% | 100% | 0% | 1 | 0 | $0.00 | 1214 | 546 |
| ally-ai | 2 | 2 | 0 | 0% | – | 100% | 100% | – | 0 | 0 | $0.00 | 97 | 27 |
| ally-ai-learn | 3 | 3 | 0 | 0% | – | 67% | 100% | – | 0 | 0 | $0.00 | 247 | 219 |
| ally-be | 9 | 9 | 0 | 0% | – | 88% | 100% | 0% | 1 | 0 | $0.00 | 330 | 85 |
| ally-mobile | 1 | 1 | 0 | 0% | – | 100% | 100% | – | 0 | 0 | $0.00 | 125 | 56 |
| ally-web | 6 | 6 | 0 | 0% | – | 100% | 100% | – | 0 | 0 | $0.00 | 416 | 159 |

## Cases

| id | kind | expected | outcome | repro | oracle | s | error |
|---|---|---|---|---|---|---|---|
| `ally-be-b82759ae` | bug | fix | oracle_proven | yes | yes | 123 |  |
| `ally-be-99584ee6` | bug | fix | oracle_proven | yes | yes | 9 |  |
| `ally-be-d039e256` | bug | escalate | oracle_proven | yes | yes | 8 |  |
| `ally-be-89d8e055` | bug | fix | oracle_proven | yes | yes | 6 |  |
| `ally-be-adf36739` | bug | fix | oracle_proven | yes | yes | 10 |  |
| `ally-be-8c4f9caf` | bug | fix | oracle_proven | yes | yes | 8 |  |
| `ally-web-9299e9aa` | bug | fix | oracle_proven | yes | yes | 160 |  |
| `ally-web-e5ad37b3` | bug | fix | oracle_proven | yes | yes | 120 |  |
| `ally-web-dd128ff8` | bug | fix | oracle_proven | yes | yes | 19 |  |
| `ally-web-f35e117d` | bug | fix | oracle_proven | yes | yes | 52 |  |
| `ally-web-eebbfd01` | bug | fix | oracle_proven | yes | yes | 16 |  |
| `ally-web-3b3db9b5` | bug | fix | oracle_proven | yes | yes | 48 |  |
| `ally-ai-b680c643` | bug | fix | oracle_proven | yes | yes | 69 |  |
| `ally-ai-e9a0e1c3` | bug | fix | oracle_proven | yes | yes | 27 |  |
| `ally-ai-learn-1065743a` | bug | fix | oracle_proven | yes | yes | 82 |  |
| `ally-ai-learn-7391ff7e` | bug | fix | oracle_failed | no | yes | 54 | test_patch_applied=True fix_applied=True fails_before=False  |
| `ally-ai-learn-995242d7` | bug | fix | oracle_proven | yes | yes | 111 |  |
| `ally-mobile-83bdf91e` | bug | fix | oracle_proven | yes | yes | 125 |  |
| `ally-be-819f6ccf` | bug | escalate | oracle_proven | yes | yes | 80 |  |
| `ally-be-6083b8d8` | bug | escalate | error | – | – | 0 | not runnable in the sandbox: app directory absent at this co |
| `ally-be-87c6ecb8` | bug | escalate | oracle_failed | no | yes | 84 | test_patch_applied=True fix_applied=True fails_before=False  |