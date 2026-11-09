# Eval report: baseline · oracle-check mode

- repo: `c33f744f6bd7` · prompts: none (chunk 04) · models: {'triage': 'openai:gpt-5-mini', 'investigate': 'openai:gpt-5', 'fix': 'openai:gpt-5', 'review': 'google_genai:gemini-2.5-pro', 'embeddings': 'openai:text-embedding-3-small'}
- run at 2026-11-09T07:49:27+00:00 · cases: 46 · stopped: free disk 4.75 GB < 5.0 GB (after install for ally-be-b29aa1be)

| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass | Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| total | 30 | 18 | 12 | 0% | 0% | 72% | 83% | 0% | 0 | 0 | $0.00 | 888 | 259 |
| ally-ai | 8 | 2 | 6 | 0% | 0% | 100% | 100% | – | 0 | 0 | $0.00 | 203 | 13 |
| ally-ai-learn | 9 | 3 | 6 | 0% | 0% | 67% | 100% | – | 0 | 0 | $0.00 | 215 | 116 |
| ally-be | 6 | 6 | 0 | 0% | – | 100% | 100% | 0% | 0 | 0 | $0.00 | 43 | 33 |
| ally-mobile | 1 | 1 | 0 | 0% | – | 100% | 100% | – | 0 | 0 | $0.00 | 194 | 34 |
| ally-web | 6 | 6 | 0 | 0% | – | 33% | 50% | 0% | 0 | 0 | $0.00 | 234 | 62 |

## Cases

| id | kind | expected | outcome | repro | oracle | s | error |
|---|---|---|---|---|---|---|---|
| `ally-be-b82759ae` | bug | fix | oracle_proven | yes | yes | 11 |  |
| `ally-be-99584ee6` | bug | fix | oracle_proven | yes | yes | 7 |  |
| `ally-be-d039e256` | bug | escalate | oracle_proven | yes | yes | 6 |  |
| `ally-be-89d8e055` | bug | fix | oracle_proven | yes | yes | 6 |  |
| `ally-be-adf36739` | bug | fix | oracle_proven | yes | yes | 8 |  |
| `ally-be-8c4f9caf` | bug | fix | oracle_proven | yes | yes | 6 |  |
| `ally-web-9299e9aa` | bug | fix | oracle_failed | no | yes | 38 | test_patch_applied=True fix_applied=True fails_before=False  |
| `ally-web-e5ad37b3` | bug | escalate | oracle_failed | no | no | 138 | test_patch_applied=True fix_applied=False fails_before=False |
| `ally-web-dd128ff8` | bug | fix | oracle_failed | no | yes | 13 | test_patch_applied=True fix_applied=True fails_before=False  |
| `ally-web-f35e117d` | bug | fix | oracle_failed | no | yes | 18 | test_patch_applied=True fix_applied=True fails_before=False  |
| `ally-web-eebbfd01` | bug | fix | oracle_failed | yes | no | 12 | test_patch_applied=True fix_applied=True fails_before=True p |
| `ally-web-3b3db9b5` | bug | fix | oracle_failed | yes | no | 16 | test_patch_applied=True fix_applied=True fails_before=True p |
| `ally-ai-b680c643` | bug | fix | oracle_proven | yes | yes | 111 |  |
| `ally-ai-e9a0e1c3` | bug | fix | oracle_proven | yes | yes | 8 |  |
| `ally-ai-learn-1065743a` | bug | fix | oracle_proven | yes | yes | 30 |  |
| `ally-ai-learn-7391ff7e` | bug | fix | oracle_failed | no | yes | 33 | test_patch_applied=True fix_applied=True fails_before=False  |
| `ally-ai-learn-995242d7` | bug | fix | oracle_proven | yes | yes | 58 |  |
| `ally-mobile-83bdf91e` | bug | fix | oracle_proven | yes | yes | 194 |  |
| `ally-ai-6e81b510` | clean | no_bug | oracle_failed | no | no | 26 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-7d30a176` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-1ff07399` | clean | no_bug | oracle_failed | no | no | 26 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-6d1b48a8` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-e6286217` | clean | no_bug | oracle_failed | no | no | 31 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-f06c8ed5` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-learn-b6c51894` | clean | no_bug | oracle_failed | no | no | 92 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-learn-88592f67` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-learn-a645303c` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-learn-c77f929e` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-learn-b408b775` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |
| `ally-ai-learn-66d9a037` | clean | no_bug | oracle_failed | no | no | 0 | test_patch_applied=False fix_applied=False fails_before=Fals |