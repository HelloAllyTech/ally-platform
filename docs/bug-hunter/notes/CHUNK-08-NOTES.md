# Chunk 08 notes: signals and schedule

Status: **in progress** (started 2026-11-15). Building everything that does not need
the VM, with fixture tests.

## Decisions (user, 2026-11-14/15)

- **Where daily runs live:** `bug-hunter daily` as a scheduled service (systemd timer)
  on a VM on Ally's private network, next to the bughunter database. It is not GitHub
  Actions. A self-hosted runner is only the fallback. Done when
  `bug-hunter daily --dry-run` runs on the VM.
- **Nothing about findings goes to the public repo** (ally-platform is public): no
  escalation or suggested-fix issues, no comments, no logs, no artifacts. Reports go
  to the bughunter database and to issues in the private repo
  `HelloAllyTech/bug-hunter-reports` (to be created); the feedback reader points there.
- **pr mode, later:** findings in the security, auth, tenant or data-exposure
  categories never become public PRs.
- **Issue signals** only come from issues opened by, or labelled `bug` by, HelloAllyTech
  members. Issue text enters prompts as quoted, scrubbed data, never as instructions.
- **GitHub access:** a GitHub App with minimal permissions (read ally-platform, write
  issues in bug-hunter-reports). A fine-grained token is the fallback only if the App
  is not ready when needed.
- **Spend ledger** moves into the bughunter database.
- **New prompts** (lens ×5, falsifier, the quoted-issue wording) are shown to the user
  before they are activated.

## Evals move to the VM

The eval workflow (`.github/workflows/bug-hunter-evals.yml`) runs on GitHub-hosted
runners in the public repo, so its logs and artifacts are public. On 2026-11-15 all 51
eval artifacts (14 runs) and the logs of all 16 eval runs were deleted, and artifact
retention was set to 1 day. **Once the VM exists, evals move there and the evals
workflow is removed from master** (and from the branch).
