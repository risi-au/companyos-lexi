# n8n in CompanyOS (M2-05)

Dev-only automation engine. n8n runs with basic auth and isolated sqlite.

## Bring-up
- `pnpm infra:up` (starts postgres + litellm + n8n)
- n8n UI: http://localhost:5678  (user: n8n / pass from N8N_BASIC_AUTH_PASSWORD or .env)
- Use the same .env for vars.

## Import demo workflow
1. In n8n UI: Workflows → Import from File → select `infra/n8n/demo-metrics-pull.json`
2. Create Credential:
   - Credentials → New → "HTTP Header Auth"
   - Name: `CompanyOS Agent Token`
   - Header Name: `Authorization`
   - Header Value: `Bearer cos_...`  (create a cos_ agent token in CompanyOS with editor grants on scopes you target e.g. "demo")
3. In the imported workflow, ensure the HTTP Request node uses the credential named "CompanyOS Agent Token".
4. Activate the workflow (toggle).
5. (optional) Edit schedule or run manually (Execute Workflow).

The workflow:
- Schedule Trigger: daily 06:00
- Code: produces demo metric points for `demo.pull.value` + `demo.pull.count` under scope "demo"
- POSTs to the HTTP agent API using bearer.

Metrics land via writeMetrics (emits `metrics.written`).

## Notes
- From inside n8n container, CompanyOS API at host is `http://host.docker.internal:3000` (works on macOS/Windows Docker Desktop; Linux may need `--add-host`).
- n8n is dev-only here (Sustainable Use licence). No production multi-tenant config yet.
- No other workflows committed.
- To reset n8n data: remove the volume or `docker volume rm ...` (outside this run).

## Credential for agents
Create long-lived cos_ tokens via kernel (scripts or UI when available). Grant "editor" or "agent" on target scopes.
