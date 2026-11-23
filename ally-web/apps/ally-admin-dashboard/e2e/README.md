# Browser tests (Agents v2, chunk 20d)

Playwright with axe, against the admin dev server. Onboarding runs through the dev-only fixture
harness (`/dev/onboarding?screen=…`); the bot page runs with its public API mocked
(`botPage.fixture.ts`). Nothing needs a backend or a login.

```bash
cd ally-web
npx playwright install chromium            # once
npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts
```

Screenshot baselines (`e2e/__screenshots__/`) are made in the Playwright Docker image so they
match CI whatever machine you're on (font rendering differs between macOS and Linux). The dev
server (Vite, started by the config) runs inside the container too (Vite refuses requests
addressed to `host.docker.internal`), with Linux `node_modules` in a named volume. From the monorepo root:

```bash
docker run --rm -v "$PWD":/work -v pw-ally-web-modules:/work/ally-web/node_modules \
  -w /work/ally-web -e NX_NO_CLOUD=true -e NX_DAEMON=false \
  mcr.microsoft.com/playwright:v1.64.1-noble \
  bash -c "npm ci && npx playwright test -c apps/ally-admin-dashboard/playwright.config.ts --update-snapshots"
```

Review the changed PNGs before committing them.
