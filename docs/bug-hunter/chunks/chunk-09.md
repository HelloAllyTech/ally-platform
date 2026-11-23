# Chunk 09: Approvals in the admin dashboard

**Read first:** `CONTEXT.md`, `spec.md` §13a and §15; `ally-be/AGENTS.md`; `ally-web/AGENTS.md`; how `ally-be/src/user/controller/super-duper-admin.controller.ts` restricts access to `UserRole.SUPER_DUPER_ADMIN`; `ally-be/src/github` (it already supports `workflow_dispatch`); `ally-be/src/audit`.

This chunk works inside `ally-be` and `ally-web`. Follow their conventions, keep their existing tests green, and don't touch or reuse the old `ally-be/src/bug-hunter` module or the admin dashboard's existing bug-hunter pages; name everything new `bug-hunter-approvals` so the old code can be deleted later without conflicts.

## Goal
A super duper admin opens the admin dashboard, sees fixes waiting for approval with their evidence, and approves or rejects them. Approval leads to an auto-merge once CI passes; rejection closes the PR and teaches the agent.

## Build
1. **ally-be module `bug-hunter-approvals`**
   - A second TypeORM data source to the `bughunter` database using the limited role from spec §15 (env vars added to `docker.env.example`).
   - `GET /api/v1/bug-hunter-approvals?status=pending` — list.
   - `GET /api/v1/bug-hunter-approvals/:runId` — details, plus the PR diff and check status fetched through the GitHub service.
   - `POST /api/v1/bug-hunter-approvals/:runId/approve` and `/reject` (body: `reason`, required for reject).
   - All endpoints: `SUPER_DUPER_ADMIN` only, using the same mechanism as the super-duper-admin controller. Reject anything not `pending` (409) so double-clicks and two admins can't decide twice.
   - On a decision: store decision, user ID and time; write an audit entry; call `workflow_dispatch` on `bug-hunter-v2.yml` with `run_id`, `decision`, `reason`. If the dispatch fails, keep the decision and mark it `dispatch_failed` so it can be retried.
2. **Admin dashboard page** in `ally-admin-dashboard`: Bug Hunter → Approvals, route and menu item visible only to `SUPER_DUPER_ADMIN`.
   - List: app, title, severity, risk level, confidence, CI status, age.
   - Detail: root cause, repro test name, files changed, rendered diff, CI checks, link to the PR, Approve / Reject (reject opens a reason box; empty reason is blocked).
   - Follow the dashboard's existing patterns for API calls, state and permission-aware UI.
3. **Bug hunter side**: turn on the auto-merge flag; `resume` handles `dispatch` inputs; expiry job closes stale PRs.
4. **Branch protection** (a person does this, not the agent): keep required status checks on `master`; allow the bug-hunter GitHub App's `bughunter/*` PRs to merge without a GitHub review. Write the exact settings in the notes for whoever applies them.

## Done when
- ally-be tests: non-super-duper-admins get 403 on every endpoint; reject without reason is 400; second decision is 409; audit entry written; dispatch called with the right inputs (GitHub service mocked).
- Dashboard tests: page and menu hidden for other roles; reject requires a reason; approve/reject call the right endpoints.
- End-to-end on a test branch: approve in the UI → workflow resumes → PR marked ready with auto-merge → merges only after CI passes. Reject → PR closed, reason stored in memory.
- Both apps' full test, lint and typecheck commands pass.
- `CHUNK-09-NOTES.md` written, including the branch-protection settings.

## Not in this chunk
Merging without CI, editing a fix from the UI, approvals for anything other than bug-hunter runs.
