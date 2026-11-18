# Part 2b: playbooks, before and after (18 Nov, local stack)

Playbooks replace the purpose variants (`purpose_answer_can_book`, `purpose_answer_takes_details`).
Measured with the basics runner on The Bombay Canteen and Host (6b's list cases) and Ledgerly with
leads (6b's lead probe, `ledgerly-leads.json`, lead-1 to lead-6). The details playbook was measured
at its revised text (local v2, `docs/agents-v2/Q3-PROMPTS.md` §Part 2b); every playbook text still
goes to Stop 3.

| Suite | Before (purpose variants) | After (playbooks) |
|---|---|---|
| Lists (6b) | 5/6 (`p2b-before-lists.txt`) | 5/6 (`p2b-after-lists.txt`); the same case, `lists-taken-slot`, fails in both |
| Lead probe, 3 separate runs | 6b: 6/6, 5/6, 5/6 (16/18) | 6/6, 6/6, 6/6 (18/18) (`p2b-leads-run3/4/5.txt`) |

The lead probe runs one invocation at a time, with the probe's leads (`987654320x`) cleared
before each: `--repeat` reuses the same phone numbers, so its later runs are refused as duplicates
by design. Two earlier "after" runs are not counted: a stopped `--repeat` runner was still writing
probe leads inside the container, so those cases found an existing lead instead of adding one.
