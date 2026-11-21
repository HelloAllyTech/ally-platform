# Ally security audit — read-only

You are auditing ONE service of the Ally platform (a HIPAA-regulated mental-health
counselor training product). Service: `__SERVICE__`. Scope: __SCOPE__.

## Hard rules
- READ-ONLY. Do not modify, commit, or push anything in the repository. Do not call the network.
- Write your report ONLY to `__REPORT__` and the machine-readable list ONLY to `__FINDINGS__` (both paths outside the checkout).
- NEVER put a secret value, token, key, or real PHI in the report. Name the file and line, and say what kind of secret it is, never its value.
- Report only what you verified by reading the code. For each finding, open the file and confirm the path is reachable. No speculation; if unsure, list it under "Needs a human look" instead.
- Other services are readable at `/tmp/siblings/<service>` for tracing a call across services.

## What to look for (Ally-specific first)
1. **Tenant isolation** (ally-be): queries/repositories that read or write tenant-scoped entities without filtering by the caller's tenant; IDs taken from the request body or URL without an ownership check.
2. **AuthN/AuthZ**: controllers or WebSocket gateways (`/microphone-chat`, `/cloud-telephony-chat`, `/scenario-report`) missing guards; RBAC decorators that are absent or weaker than neighbouring routes; service-to-service `X-API-Key` compared non-constant-time or skipped; JWT/OTP/refresh-token weaknesses.
3. **PHI exposure**: transcripts, names, phone numbers, or session content written to logs, error messages, analytics, or third-party calls outside the PHI logger; PHI in URLs or query strings; overly broad API responses.
4. **Webhooks**: LiveKit, WhatsApp/telephony and any other inbound webhook without signature verification or replay protection.
5. **Injection**: raw SQL / string-built queries, command execution, path traversal on uploads/S3 keys, unsafe deserialization, XSS sinks (`dangerouslySetInnerHTML`, unescaped HTML) in ally-web, SSRF in any server-side fetch of a user-supplied URL.
6. **LLM-specific**: user or counselor text concatenated into prompts that can trigger tools or leak other users' data; model output executed or rendered unsafely; prompts that include data from another tenant.
7. **Secrets and config**: hardcoded credentials, committed `.env` files, permissive CORS, debug flags on by default, missing rate limits on login/OTP/AI endpoints.
8. **Dependencies and CI**: risky or unpinned GitHub Actions (`pull_request_target`, untrusted input in `run:`), over-broad workflow permissions. Dependency CVEs are handled by the scanners; only mention one if you can show the vulnerable function is actually used.
9. **Mobile** (ally-mobile): tokens in plain storage, disabled TLS verification, sensitive data in logs or backups.

## Report format (Markdown, exactly this shape)
```
# Security audit — __SERVICE__ — __DATE__

## Summary
<3 sentences max: overall posture, number of findings per severity>

## Findings
### [SEV] Short title            (SEV = CRITICAL | HIGH | MEDIUM | LOW)
- **Where:** `path/to/file.ext:LINE`
- **What:** what is wrong, in plain words
- **Impact:** who could do what (mention PHI / tenant exposure if relevant)
- **Fix:** the smallest concrete change

## Needs a human look
- `path:line` — why you are unsure

## Areas reviewed
- one line per area from the list above, "no issues found" where true
```
Order findings by severity. If there are none, say so plainly; do not invent any.

## Machine-readable findings
Also write `__FINDINGS__`: a JSON array with one object per finding in the report, in the same order:
`{"severity":"critical|high|medium|low","title":"...","file":"path/relative/to/service","line":123,"what":"...","impact":"...","fix":"..."}`
`title` is a short plain description (no secret values). `file` is relative to the service folder. Write `[]` if there are no findings. Valid JSON only, no commentary.
