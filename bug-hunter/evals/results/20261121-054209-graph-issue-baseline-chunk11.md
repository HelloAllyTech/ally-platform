# Eval report: graph · issue mode

- repo: `955db6c30a5b` · prompts: falsifier.v2, fix.v2, investigate.v4, lens_api_contract.v1, lens_async_and_race.v1, lens_error_handling_and_null.v1, lens_logic.v1, lens_security_and_data_exposure.v1, reproduce.v5, review.v5, triage.v4 · models: {'triage': 'openai:gpt-5-mini', 'investigate': 'openai:gpt-5', 'fix': 'openai:gpt-5', 'review': 'google_genai:gemini-2.5-pro', 'lens': 'openai:gpt-5-mini', 'falsifier': 'google_genai:gemini-2.5-pro', 'embeddings': 'openai:text-embedding-3-small'}
- run at 2026-11-21T05:42:09+00:00 · cases: 19 · stopped: no (completed)

| Scope | Cases | Bugs | Clean | Detection | False alarm | Repro | Fix pass | Escalation | Errors | Tokens | Cost | Agent s | Sandbox s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| total | 19 | 19 | 0 | 90% | – | 85% | 29% | 100% | 0 | 14367687 | $9.14 | 15045 | 232 |
| ally-ai | 1 | 1 | 0 | 100% | – | 0% | – | – | 0 | 426955 | $0.55 | 892 | 4 |
| ally-ai-learn | 2 | 2 | 0 | 100% | – | 100% | 0% | – | 0 | 2106789 | $1.75 | 2009 | 82 |
| ally-be | 9 | 9 | 0 | 89% | – | 86% | 50% | 100% | 0 | 5803977 | $3.28 | 3867 | 37 |
| ally-mobile | 1 | 1 | 0 | 100% | – | 100% | 0% | – | 0 | 697120 | $0.39 | 1300 | 43 |
| ally-web | 6 | 6 | 0 | 83% | – | 100% | 33% | – | 0 | 5332846 | $3.17 | 6977 | 66 |

## Cases

| id | kind | expected | outcome | repro | oracle | review | ce p/k/f/d | fix tries | ended as | tokens | cost | s | trace | error / stop reason |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ally-be-b82759ae` | bug | fix | missed | – | – | – | – | 0 | no_bug | 796321 | $0.371 | 167 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fca0-91b5-7399-92a7-530ffa0e88f9?trace_id=01a1fca0-91b5-7399-92a7-530ffa0e88f9&start_time=2026-11-21T05:42:23.925712) |  |
| `ally-be-8c4f9caf` | bug | fix | escalated | no | – | approve | – | 1 | escalated | 1138957 | $0.574 | 948 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fca2-fe69-723a-9589-4e269643001f?trace_id=01a1fca2-fe69-723a-9589-4e269643001f&start_time=2026-11-21T05:45:02.825280) | final diff touches a human-only area: safety keyword: +    // 16:9 landscape to  |
| `ally-web-9299e9aa` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 1024243 | $0.596 | 2728 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcb1-c899-72d1-9b8d-0892529f4754?trace_id=01a1fcb1-c899-72d1-9b8d-0892529f4754&start_time=2026-11-21T06:01:12.089116) |  |
| `ally-web-eebbfd01` | bug | fix | missed | – | – | – | – | 0 | no_bug | 542942 | $0.242 | 182 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcdb-d021-7056-aeda-f520cc6594d7?trace_id=01a1fcdb-d021-7056-aeda-f520cc6594d7&start_time=2026-11-21T06:47:06.529186) |  |
| `ally-ai-learn-995242d7` | bug | fix | detected | yes | no | counterexamples | 1/0/0/0 | 1 | suggested_fix | 1322939 | $1.065 | 1498 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcde-9afa-72cd-bd8c-9dce72086b18?trace_id=01a1fcde-9afa-72cd-bd8c-9dce72086b18&start_time=2026-11-21T06:50:09.530463) |  |
| `ally-be-819f6ccf` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 226064 | $0.155 | 188 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcf6-c3ed-7647-b363-e7ecb7bb4ee7?trace_id=01a1fcf6-c3ed-7647-b363-e7ecb7bb4ee7&start_time=2026-11-21T07:16:32.877118) | risky area, human-only: src/config/config.service.ts (src/config/); src/config/e |
| `ally-be-99584ee6` | bug | fix | detected | yes | yes | approve | – | 1 | suggested_fix | 1230125 | $0.668 | 789 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fca0-b8c5-7155-880d-d7c229572991?trace_id=01a1fca0-b8c5-7155-880d-d7c229572991&start_time=2026-11-21T05:42:33.925471) |  |
| `ally-be-d039e256` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 324089 | $0.185 | 225 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcac-eaf2-72a2-9978-f83bf432b1bb?trace_id=01a1fcac-eaf2-72a2-9978-f83bf432b1bb&start_time=2026-11-21T05:55:53.202359) | risky area, human-only: ally-be/src/auth/guards/jwt-auth.guard.ts (src/auth/); t |
| `ally-web-dd128ff8` | bug | fix | escalated | – | – | – | – | 0 | escalated | 1488016 | $0.969 | 558 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcb0-a000-713c-bfbd-ffc2ffabb24a?trace_id=01a1fcb0-a000-713c-bfbd-ffc2ffabb24a&start_time=2026-11-21T05:59:56.160266) | could not reproduce: The new test crashed during render due to missing mocked tr |
| `ally-web-f35e117d` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 583476 | $0.354 | 2117 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcb9-39f8-75b1-a03f-e2d979770cd7?trace_id=01a1fcb9-39f8-75b1-a03f-e2d979770cd7&start_time=2026-11-21T06:09:19.864395) |  |
| `ally-ai-b680c643` | bug | fix | escalated | no | – | counterexamples, counterexamples, counterexamples | 3/3/3/0 | 3 | escalated | 426955 | $0.546 | 892 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcda-4a2f-7168-b4df-0802865c4e16?trace_id=01a1fcda-4a2f-7168-b4df-0802865c4e16&start_time=2026-11-21T06:45:26.703707) | reviewer counterexamples still fail after 3 attempts: ce1: prompt code `ally_ai_ |
| `ally-mobile-83bdf91e` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 697120 | $0.393 | 1300 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fce8-0edd-77db-84c3-25a7c7b9f991?trace_id=01a1fce8-0edd-77db-84c3-25a7c7b9f991&start_time=2026-11-21T07:00:29.021027) |  |
| `ally-be-87c6ecb8` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 562964 | $0.292 | 229 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcfc-8f22-7746-8894-68c71287e5fd?trace_id=01a1fcfc-8f22-7746-8894-68c71287e5fd&start_time=2026-11-21T07:22:52.578019) | risky area, human-only: src/user/repository/user.repository.ts (src/user/); src/ |
| `ally-be-89d8e055` | bug | fix | detected | yes | no | approve | – | 1 | suggested_fix | 615979 | $0.450 | 772 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fca0-bf95-7626-9693-3ee25b44ca2f?trace_id=01a1fca0-bf95-7626-9693-3ee25b44ca2f&start_time=2026-11-21T05:42:35.669204) |  |
| `ally-be-adf36739` | bug | fix | escalated_safe | – | – | – | – | 0 | escalated | 610280 | $0.375 | 308 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcac-851f-74b6-8b46-64e10cf61ecd?trace_id=01a1fcac-851f-74b6-8b46-64e10cf61ecd&start_time=2026-11-21T05:55:27.135744) | risky area, human-only: topic: tenant; topic: tenants |
| `ally-web-e5ad37b3` | bug | fix | detected | yes | yes | approve | – | 1 | suggested_fix | 244305 | $0.212 | 582 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcb1-330a-75c0-8941-5c9225ff18eb?trace_id=01a1fcb1-330a-75c0-8941-5c9225ff18eb&start_time=2026-11-21T06:00:33.802538) |  |
| `ally-web-3b3db9b5` | bug | fix | escalated | – | – | – | – | 0 | escalated | 1449864 | $0.795 | 809 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcba-59d9-738c-ade2-60ec54d19d38?trace_id=01a1fcba-59d9-738c-ade2-60ec54d19d38&start_time=2026-11-21T06:10:33.561639) | could not reproduce: My previous two attempts to write a reproduction test passe |
| `ally-ai-learn-1065743a` | bug | fix | escalated | – | – | – | – | 0 | escalated | 783850 | $0.683 | 511 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcc6-a69e-7406-92cb-284c8bdbc8cc?trace_id=01a1fcc6-a69e-7406-92cb-284c8bdbc8cc&start_time=2026-11-21T06:23:59.646473) | could not reproduce: The test runner is failing during test collection with an ` |
| `ally-be-6083b8d8` | bug | escalate | escalated_correctly | yes | – | – | – | 0 | escalated | 299198 | $0.210 | 241 | [trace](https://smith.langchain.com/o/0c854988-4630-4eeb-84c4-ab532b3e578b/projects/p/2503d054-26fa-4772-9587-e8e6c849e456/r/01a1fcce-7131-762b-a4f1-74f6d4e7f723?trace_id=01a1fcce-7131-762b-a4f1-74f6d4e7f723&start_time=2026-11-21T06:32:30.257550) | risky area, human-only: src/rate-limit/guard/custom-throttler.guard.ts (src/rate |

Notes:
- `ally-web-eebbfd01`: escalate_acceptable, strict file rule: 2026-11-10 run had the mechanism right, wrong file (ui-shared vs helpline PageviewTracker); scored fail
- `ally-be-89d8e055`: oracle_shape: the oracle also tests the real fix's new export normaliseTranslationTokens; a patch that strips zero-width characters inside the guard (e.g. memory-check run 20261114-185206) needs human review

Review verdicts: approve 7, counterexamples 4 · Ended as: escalated 10, no_bug 2, suggested_fix 7

Counterexamples: proposed 4, kept 3, failed on a fix 3, disputed 0 · runs with a dispute: 0 of 9 reviewed

| Shard | Cases | Cost | Minutes | Stopped |
|---|---|---|---|---|
| 1/3 | 6 | $2.72 | 54.1 | no |
| 2/3 | 6 | $3.00 | 97.7 | no |
| 3/3 | 7 | $3.41 | 104.6 | no |

Escalations of expected-fix cases: safe over-escalation (topic rule) 1, wrong 5

Fix pass: oracle 2/7; adjusted (human review for oracle_shape cases) 2/6, 1 pending human review

Run cost $9.14 is not in any ledger yet: record it with `bug-hunter spend add 9.14 --source github`

Cost: $9.14 of the $12.00 cap · cases done 19 · remaining 0