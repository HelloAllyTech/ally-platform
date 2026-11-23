# Eval report: graph · issue mode

- repo: `ca02499bd5f7` · prompts: falsifier.v2, fix.v2, investigate.v5, lens_api_contract.v1, lens_async_and_race.v1, lens_error_handling_and_null.v1, lens_logic.v1, lens_security_and_data_exposure.v1, reproduce.v6, review.v6, triage.v4 · models: {'triage': 'openai:gpt-5-mini', 'investigate': 'openai:gpt-5', 'fix': 'openai:gpt-5', 'review': 'google_genai:gemini-2.5-pro', 'lens': 'openai:gpt-5-mini', 'falsifier': 'google_genai:gemini-2.5-pro', 'embeddings': 'openai:text-embedding-3-small'}
- run at 2026-11-21T14:23:07+00:00 · cases: 19 · stopped: no (completed)

| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass | Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| total | 19 | 19 | 0 | 79% | – | 93% | 25% | 100% | 0 | 13171336 | $7.10 | 11162 | 135 |
| ally-ai | 1 | 1 | 0 | 100% | – | 100% | 100% | – | 0 | 356017 | $0.32 | 438 | 6 |
| ally-ai-learn | 2 | 2 | 0 | 50% | – | 100% | 0% | – | 0 | 1005263 | $0.54 | 1163 | 28 |
| ally-be | 9 | 9 | 0 | 89% | – | 100% | 0% | 100% | 0 | 6104294 | $3.03 | 3723 | 43 |
| ally-mobile | 1 | 1 | 0 | 100% | – | 0% | – | – | 0 | 849392 | $0.54 | 1040 | 5 |
| ally-web | 6 | 6 | 0 | 67% | – | 100% | 33% | – | 0 | 4856370 | $2.67 | 4799 | 52 |

## Cases

| id | kind | expected | outcome | repro | oracle | review | ce p/k/f/d | fix tries | ended as | tokens | cost | s | trace | error / stop reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ally-be-89d8e055` | bug | fix | detected | yes | no | counterexamples | 1/0/0/0 | 1 | suggested_fix | 748112 | $0.463 | 857 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe7d-8569-7636-87f8-1172c3b3ecc4?trace_id=01a1fe7d-8569-7636-87f8-1172c3b3ecc4&start_time=2026-11-21T14:23:21.449458) |  |
| `ally-be-adf36739` | bug | fix | escalated_safe | yes | – | – | – | 0 | escalated | 484605 | $0.256 | 269 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe8a-b6a3-7799-8fcd-dd6490dc7734?trace_id=01a1fe8a-b6a3-7799-8fcd-dd6490dc7734&start_time=2026-11-21T14:37:46.019184) | risky area, human-only: topic: tenant; topic: tenants |
| `ally-web-e5ad37b3` | bug | fix | detected | yes | yes | approve | – | 1 | suggested_fix | 391173 | $0.245 | 855 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe8e-f38e-741d-9ed6-c0aa6f4a8765?trace_id=01a1fe8e-f38e-741d-9ed6-c0aa6f4a8765&start_time=2026-11-21T14:42:23.758352) |  |
| `ally-web-3b3db9b5` | bug | fix | escalated | – | – | – | – | 0 | escalated | 1509257 | $0.742 | 186 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe9c-9429-7245-bc2c-14cc70634cf8?trace_id=01a1fe9c-9429-7245-bc2c-14cc70634cf8&start_time=2026-11-21T14:57:16.841211) | token budget exceeded (1509257 >= 1500000) |
| `ally-ai-learn-1065743a` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 303107 | $0.235 | 1012 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe9f-56d2-7297-8ae0-0fd5085368f8?trace_id=01a1fe9f-56d2-7297-8ae0-0fd5085368f8&start_time=2026-11-21T15:00:17.746869) |  |
| `ally-be-6083b8d8` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 884434 | $0.406 | 308 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1feaf-4324-75df-86fc-25043f505042?trace_id=01a1feaf-4324-75df-86fc-25043f505042&start_time=2026-11-21T15:17:41.284486) | risky area, human-only: src/rate-limit/guard/custom-throttler.guard.ts (src/rate |
| `ally-be-b82759ae` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 964008 | $0.464 | 807 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe7e-5127-74be-b630-a2378eff1ff5?trace_id=01a1fe7e-5127-74be-b630-a2378eff1ff5&start_time=2026-11-21T14:24:13.607878) |  |
| `ally-be-8c4f9caf` | bug | fix | missed | – | – | – | – | 0 | no_bug | 642728 | $0.243 | 122 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe8a-eed3-72ac-86ef-ce0c4f3e8880?trace_id=01a1fe8a-eed3-72ac-86ef-ce0c4f3e8880&start_time=2026-11-21T14:38:00.403775) |  |
| `ally-web-9299e9aa` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 714090 | $0.443 | 1964 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe8c-ead9-773b-ac1e-005f33026b92?trace_id=01a1fe8c-ead9-773b-ac1e-005f33026b92&start_time=2026-11-21T14:40:10.457483) |  |
| `ally-web-eebbfd01` | bug | fix | missed | – | – | – | – | 0 | no_bug | 521846 | $0.235 | 142 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1feab-5e50-7234-a133-266b9c6360c5?trace_id=01a1feab-5e50-7234-a133-266b9c6360c5&start_time=2026-11-21T15:13:26.096929) |  |
| `ally-ai-learn-995242d7` | bug | fix | missed | – | – | – | – | 0 | no_bug | 702156 | $0.306 | 151 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fead-8b9d-7179-ae71-3079066cec34?trace_id=01a1fead-8b9d-7179-ae71-3079066cec34&start_time=2026-11-21T15:15:48.765187) |  |
| `ally-be-819f6ccf` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 307819 | $0.173 | 174 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1feaf-dfc4-74a3-8318-e5e589b8005e?trace_id=01a1feaf-dfc4-74a3-8318-e5e589b8005e&start_time=2026-11-21T15:18:21.380121) | risky area, human-only: src/config/config.service.ts (src/config/); src/config/e |
| `ally-be-99584ee6` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 1026499 | $0.503 | 764 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe7e-a389-7773-9c75-af7bde142a7f?trace_id=01a1fe7e-a389-7773-9c75-af7bde142a7f&start_time=2026-11-21T14:24:34.697538) |  |
| `ally-be-d039e256` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 256581 | $0.206 | 199 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe8a-4f4f-7649-8667-80d60ebc3f98?trace_id=01a1fe8a-4f4f-7649-8667-80d60ebc3f98&start_time=2026-11-21T14:37:19.567432) | risky area, human-only: ally-be/src/auth/guards/jwt-auth.guard.ts (src/auth/); a |
| `ally-web-dd128ff8` | bug | fix | missed | – | – | – | – | 0 | no_bug | 855757 | $0.580 | 151 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe8d-765c-74ea-b227-121ac1f34903?trace_id=01a1fe8d-765c-74ea-b227-121ac1f34903&start_time=2026-11-21T14:40:46.172714) |  |
| `ally-web-f35e117d` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 864247 | $0.425 | 1500 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fe8f-b608-7682-b51a-5875121c5c6c?trace_id=01a1fe8f-b608-7682-b51a-5875121c5c6c&start_time=2026-11-21T14:43:13.544972) |  |
| `ally-ai-b680c643` | bug | fix | detected | yes | yes | counterexamples | 1/0/0/0 | 1 | suggested_fix | 356017 | $0.320 | 438 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fea6-fb55-7700-bf77-65bfa05924d4?trace_id=01a1fea6-fb55-7700-bf77-65bfa05924d4&start_time=2026-11-21T15:08:38.613111) |  |
| `ally-mobile-83bdf91e` | bug | fix | escalated | no | – | reject_drift | – | 1 | escalated | 849392 | $0.542 | 1040 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fead-d05c-70df-bc60-97095255372b?trace_id=01a1fead-d05c-70df-bc60-97095255372b&start_time=2026-11-21T15:16:06.365003) | review rejected (drift): finding drifted from the report: the report says 'every |
| `ally-be-87c6ecb8` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 789508 | $0.315 | 222 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1febd-ba8d-73b5-b605-516884899047?trace_id=01a1febd-ba8d-73b5-b605-516884899047&start_time=2026-11-21T15:33:29.357609) | risky area, human-only: src/user/repository/user.repository.ts (src/user/); src/ |

Notes:
- `ally-be-89d8e055`: not oracle_shape (2026-11-21): normaliseTranslationTokens already existed at the parent; a fix that misses leading/trailing U+200B is a plain fail
- `ally-web-eebbfd01`: escalate_acceptable, strict file rule: 2026-11-10 run had the mechanism right, wrong file (ui-shared vs helpline PageviewTracker); scored fail
- `ally-ai-learn-995242d7`: review oracle shape (2026-11-21): the oracle asserts the private attribute result._tts_instance

Review verdicts: approve 6, counterexamples 2, reject_drift 1 · Ended as: escalated 7, no_bug 4, suggested_fix 8

Counterexamples: proposed 2, kept 0, failed on a fix 0, disputed 0 · runs with a dispute: 0 of 9 reviewed

| Shard | Cases | Cost | Minutes | Stopped |
|---|---|---|---|---|
| 1/3 | 6 | $2.35 | 59.9 | no |
| 2/3 | 6 | $1.86 | 57.5 | no |
| 3/3 | 7 | $2.89 | 72.9 | no |

Escalations of expected-fix cases: safe over-escalation (topic rule) 1, wrong 2

Fix pass: oracle 2/8; adjusted (human review for oracle_shape cases) 2/8

Run cost $7.10 is not in any ledger yet: record it with `bug-hunter spend add 7.10 --source github`

Cost: $7.10 of the $12.00 cap · cases done 19 · remaining 0
