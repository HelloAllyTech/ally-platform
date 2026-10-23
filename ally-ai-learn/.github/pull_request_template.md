## Summary

<!-- Briefly describe what this PR changes and why. -->

## Test plan

<!-- How did you verify this works? Repro steps, screenshots, test runs. -->

## Security checklist

- [ ] No real AWS resource IDs (`subnet-*`, `sg-*`, `vpc-*`, ARNs) in code or workflows — use `${{ vars.* }}` / `${{ secrets.* }}` instead.
- [ ] No internal-only hostnames in code or comments.
- [ ] No real credentials, API keys, or `.env` files committed. Placeholder values only in `env_sample`.
- [ ] No private keys (`.pem`, `.key`, `.pfx`), DB dumps, or scan reports.
- [ ] No secrets in the diff — including in prompt files and test fixtures.

## Documentation

- [ ] Docs that cover the code I changed are updated — see [`.docs-map.yml`](../.docs-map.yml).
- [ ] If a wiki page needed changing, its PR is linked below; if not, I said why.

<!-- Paste the line printed by .wiki-tmp/scripts/wiki-pr.sh, or state that no page moves:
Wiki-PR: https://github.com/helloallytech/helloallytech.github.io/pull/NNN
Wiki-PR: none - <reason>
-->
