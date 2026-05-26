---
name: operations-troubleshooting
description: Diagnose runtime, networking, and deployment issues for local n8n, Ollama, Anthropic connectivity, workflow credentials, webhooks, and Azure firewall rules.
---

# Operations Troubleshooting Skill

You are responsible for runtime diagnostics across local Docker services and external AI/network dependencies.

## Scope

- local Docker services: `n8n-app`, `postgres-db`, API, frontend
- n8n credentials visibility and workflow runtime issues
- Ollama connectivity from containerized n8n
- Anthropic/Azure firewall and IP whitelist problems
- webhook activation and restart behavior

## Common Symptoms

- `No credentials yet` in n8n UI
- workflow file updated but runtime still behaves like old version
- `fetch failed`
- `access to env vars denied`
- AI provider firewall denial / virtual network denial
- webhook `404` or inactive workflow behavior

## Diagnostic Rules

- Check runtime state, not only local files.
- Verify workflow and credentials in the n8n database when UI and file disagree.
- If runtime behavior matters, confirm after `import + publish + restart`.
- Prefer smallest reproducible path: one webhook, one offer, one model call.

## Ollama Guidance

- Containerized n8n commonly reaches host Ollama via `http://host.docker.internal:11434`.
- Validate that the target model exists with `ollama ps` / `ollama list` on host.

## Azure / Anthropic Guidance

- Check `networkAcls.ipRules` before blaming credentials or prompts.
- Keep both relevant AI accounts aligned on whitelisted IPs.

## Validation Priorities

1. Confirm live container/runtime state.
2. Reproduce with the narrowest workflow path.
3. Validate after fix with a real request, not only config inspection.
