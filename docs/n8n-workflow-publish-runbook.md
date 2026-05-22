# n8n Workflow Publish Runbook

Status: verified on 2026-04-29 against the local Docker stack in this repository.

Scope: `n8n/workflows/Real Estate AI Agent.json` stored in Postgres-backed n8n.

## Why This Exists

In this project, updating the workflow JSON file alone is not enough to make production webhooks behave consistently after restart.

The active n8n instance reads workflow state from PostgreSQL tables such as:

- `workflow_entity`
- `workflow_history`
- `workflow_published_version`

If the file and database drift apart, one of these symptoms can appear:

- production webhook returns `Cannot POST /webhook/...`
- n8n runs an older node graph than the file on disk
- a restart removes a webhook that previously worked

## Local Stack Assumptions

From `docker-compose.yml`:

- n8n container: `n8n-app`
- postgres container: `postgres-db`
- API container: `rea-api`
- database: `${POSTGRES_DB}` in compose, currently used as `re_ai_agent_data` in the live local setup

## Source Of Truth

Workflow file:

- `n8n/workflows/Real Estate AI Agent.json`

Active workflow id used in this repo during rollout:

- `tpFQQh5n9ONn3x9I`

Published version used during this rollout:

- `0a05147a-bbef-47ef-8679-b0c3cc5a14b4`

Before reusing the commands below, verify these values still match the current environment.

## Safe Publish Procedure

### 1. Edit the file first

Make all intended changes in:

- `n8n/workflows/Real Estate AI Agent.json`

If a Code node has a mirrored source file in `n8n/parsers/js/`, update that file first and then sync the workflow JSON from it.

### 2. Verify the local file contains the expected markers

Examples:

```bash
rg "offer-re-evaluate|normalizeLotSizeSqm|Exclusive garden or plot size" n8n/workflows/Real\ Estate\ AI\ Agent.json
```

Do this before touching Postgres so you do not publish a stale local file.

### 3. Generate SQL to sync file -> n8n database

Use a Node script so JSON is serialized exactly from the file on disk.

Template:

```bash
cd /Users/przemyslaw.adamowski/dev/re-ai-agent

node - <<'NODE'
const fs = require('fs');
const workflow = JSON.parse(fs.readFileSync('n8n/workflows/Real Estate AI Agent.json', 'utf8'));
const workflowId = 'tpFQQh5n9ONn3x9I';
const versionId = '0a05147a-bbef-47ef-8679-b0c3cc5a14b4';
const esc = (value) => String(value).replace(/'/g, "''");
const descriptionSql = workflow.description ? `$$${String(workflow.description)}$$` : 'NULL';
const nodes = JSON.stringify(workflow.nodes);
const connections = JSON.stringify(workflow.connections);
const settings = JSON.stringify(workflow.settings || {});
const meta = JSON.stringify(workflow.meta || {});

const sqlEntity = `UPDATE workflow_entity
SET name = '${esc(workflow.name)}',
    active = true,
    nodes = $$${nodes}$$::json,
    connections = $$${connections}$$::json,
    settings = $$${settings}$$::json,
    meta = $$${meta}$$::json,
    "updatedAt" = NOW()
WHERE id = '${workflowId}';
`;

const sqlHistory = `UPDATE workflow_history
SET name = '${esc(workflow.name)}',
    nodes = $$${nodes}$$::json,
    connections = $$${connections}$$::json,
    description = ${descriptionSql},
    "updatedAt" = NOW()
WHERE "workflowId" = '${workflowId}'
  AND "versionId" = '${versionId}';
`;

fs.writeFileSync('/tmp/update_n8n_workflow.sql', `${sqlEntity}
${sqlHistory}`);
console.log('/tmp/update_n8n_workflow.sql');
NODE
```

### 4. Apply the SQL to Postgres

```bash
docker cp /tmp/update_n8n_workflow.sql postgres-db:/tmp/update_n8n_workflow.sql
docker exec postgres-db psql -U re_ai_agent_sql_user -d re_ai_agent_data -f /tmp/update_n8n_workflow.sql
```

Expected result:

- `UPDATE 1`
- `UPDATE 1`

The first update is `workflow_entity`, the second is `workflow_history`.

### 5. Restart n8n

```bash
docker restart n8n-app
```

Wait for readiness:

```bash
until curl -sf http://localhost:5678/healthz >/dev/null; do :; done
curl -s http://localhost:5678/healthz
```

Expected result:

```json
{"status":"ok"}
```

### 6. Verify the database now contains the intended markers

Example check:

```bash
docker exec postgres-db psql -U re_ai_agent_sql_user -d re_ai_agent_data -At -F $'\t' -c \
"SELECT nodes::text ILIKE '%offer-re-evaluate%' AS has_webhook_branch,
        nodes::text ILIKE '%normalizeLotSizeSqm%' AS has_lot_size_fix
 FROM workflow_entity
 WHERE id = 'tpFQQh5n9ONn3x9I';"
```

Expected result for a successful sync:

- `t` for each marker you expect

### 7. Verify the production webhook directly

Always test the direct n8n webhook first. This isolates workflow runtime from API or frontend problems.

Example:

```bash
curl -sS -X POST http://localhost:5678/webhook/offer-re-evaluate \
  -H 'Content-Type: application/json' \
  -d '{"external_id":"OT-67955868"}' \
  -w '\nHTTP_STATUS:%{http_code}\n'
```

Expected result:

- `HTTP_STATUS:200`

If this fails, debug n8n first. Do not move to API or frontend until the direct webhook succeeds.

### 8. Verify through the API

```bash
curl -sS -X POST http://localhost:3001/api/offers/OT-67955868/re-evaluate \
  -w '\nHTTP_STATUS:%{http_code}\n'
```

Expected result:

- `HTTP_STATUS:200`

### 9. Verify persistence in PostgreSQL

Example:

```bash
docker exec postgres-db psql -U re_ai_agent_sql_user -d re_ai_agent_data -c \
"SELECT external_id, lot_size, ai_rating, left(ai_analysis_html, 260) AS analysis_preview
 FROM rea_property_offers
 WHERE external_id = 'OT-67955868';"
```

Use this to confirm the workflow did not only return a response, but also wrote the intended values to the table.

## Troubleshooting

### Symptom: `Cannot POST /webhook/offer-re-evaluate`

Problem:

- n8n is healthy but the production webhook is not registered in the runtime currently serving requests

Checks:

```bash
curl -s http://localhost:5678/healthz
docker logs --tail 50 n8n-app
```

Recommendation:

- verify `workflow_entity` still contains the expected node markers
- verify the direct webhook path, not only the API path
- restart `n8n-app` once after confirming the database rows are correct

### Symptom: direct webhook works, API returns `502`

Problem:

- API container may still be running older code or missing current retry behavior

Recommendation:

```bash
docker restart rea-api
```

Then re-test the API endpoint.

### Symptom: workflow executes but updates the wrong row or no row

Problem:

- the final update node may be matching on AI-returned `external_id` instead of the original input id

Recommendation:

- make the update step match on the original webhook input id from `js-single-offer-re-evaluate-input`
- do not trust AI output as the row identity key for the final SQL update

### Symptom: file contains the fix, runtime does not

Problem:

- the file was changed but `workflow_entity` and `workflow_history` were not updated from the file

Recommendation:

- repeat steps 3 through 7 from this runbook

## Validation Order

Always validate in this order:

1. local file markers
2. `workflow_entity` / `workflow_history` markers
3. n8n health
4. direct webhook
5. API endpoint
6. DB row state

This order avoids blaming the wrong layer.
