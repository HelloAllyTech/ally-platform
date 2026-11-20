# Release Guide — ally-be

**The shared release process lives in the wiki:
[Release Process](https://tech.helloally.ai/#/wiki/contributing/release-process.md).**
Read that for semantic-versioning policy, how to trigger the workflow, the image tag
scheme, publishing the draft, and troubleshooting. This file carries only what is specific
to this service.

## This service

| | |
|---|---|
| Workflow | `production-release-ally-be.yaml` in the monorepo's root `.github/workflows/` |
| Release branch | `master` |
| Tag | `be-vX.Y.Z` |
| Runtime in CI | Node.js 24 |
| Package manager | npm |
| Test framework | Jest |
| Deployment | Ansible playbook via the `deploy-metal01` action (production stack, since the 2026-11-07 cutover) |
| Runs migrations | **Yes** — inside the playbook (`npm run migration:run` in the service container), before the new container serves |

## Deployment

The release workflow's deploy job runs the `ally_core.yml` playbook from the private infra repo
through `.github/actions/deploy-metal01`, then polls the public API's `/api/health` until it answers. Its
inputs are repository secrets (the deploy SSH key, the infra deploy key and the Ansible
vault password) — see the comment at the top of that action. Container logs, restarts and
recovery are in the infra repo's runbook, not here: this repository is public.

The ECS cluster, service and task-definition names this guide used to list belong to the
pre-cutover stack and no longer receive production releases.

## Notes specific to this service

- **Migrations run before the deploy.** A failed migration stops the release with the old
  version still serving. Fix forward — never edit a migration that has already merged.
- **Two runners, one lock.** On the metal deploy the app runs pending migrations on boot and the
  deploy job runs `npm run migration:run` in the same container moments later. Both go through
  `src/database/migration-runner.ts`, which takes a Postgres advisory lock, so the second waits
  and then finds nothing to do. It also runs migrations without the request pool's 30 s
  statement timeout. Without the lock the two raced: be-v1.180.1 failed with a duplicate
  `pg_type` key on `CREATE TABLE IF NOT EXISTS`. Keep any new way of running migrations on that
  runner.
- **A migration file exports only its class.** TypeORM calls `new` on every function a
  migration file exports; put helpers in a file the `[0-9]*.js` glob skips
  (`migration-exports.spec.ts` checks this).
- Reproduce a failing pipeline test locally with
  `npm ci && npm run test -- --forceExit --detectOpenHandles`.
- Migration failures: check the migration, database connectivity, and the database user's
  permissions, then read the migration step in the deploy job's Ansible output.
