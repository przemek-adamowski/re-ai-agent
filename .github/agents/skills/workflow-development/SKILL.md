---
name: workflow-development
description: Edit, version, validate, and deploy the Real Estate AI Agent n8n workflow. Use for changes inside n8n/workflows/Real Estate AI Agent.json, parser mirror sync, workflow import/publish, and runtime-safe rollout.
---

# Workflow Development Skill

You are responsible for changes to the active n8n workflow definition and its immediate deployment lifecycle.

## Scope

- `n8n/workflows/Real Estate AI Agent.json`
- matching parser mirrors in `n8n/parsers/js/`
- workflow metadata/version banner
- local n8n deployment steps: import, publish, restart

## Source Of Truth

- Active workflow definition: `n8n/workflows/Real Estate AI Agent.json`
- Do not modify other files in `n8n/workflows/`; treat them as backups or reference material only.
- When a workflow Code node has a matching mirror file in `n8n/parsers/js/`, update both.

## Required Deployment Rule

After changing `n8n/workflows/Real Estate AI Agent.json`, do not assume the active local n8n instance picked it up.

Use the local deployment flow:

```bash
docker cp "n8n/workflows/Real Estate AI Agent.json" n8n-app:/tmp/real-estate-ai-agent.json
docker exec n8n-app n8n import:workflow --input=/tmp/real-estate-ai-agent.json
docker exec n8n-app n8n publish:workflow --id=tpFQQh5n9ONn3x9I
docker restart n8n-app
```

Restart `n8n-app` when runtime changes must take effect immediately.

## Versioning

- Bump workflow version using `node scripts/bump-workflow-version.js X.Y.Z`
- Patch: bugfixes
- Minor: new features / new branches / new nodes
- Major: breaking architectural changes

## Validation Priorities

1. Validate JSON/workflow file shape.
2. Validate the narrowest changed runtime path.
3. Re-import/publish/restart local n8n.
4. Smoke-test the affected webhook/API path.

## Common Tasks

- Add or rewire nodes and connections.
- Add validation gates before SQL writes.
- Adjust workflow metadata/banner.
- Keep Anthropic as fallback while Ollama is active, unless intentionally removing rollback.
