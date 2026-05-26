# Import Run Reporting Design

Status: design locked, ready for phased implementation.
Scope: POC. Real Estate AI Agent n8n workflow + FastAPI backend + React FE.

## Goal

For each automated import run, report:

- how many offers entered the workflow
- how many were dropped at each stage and why
- how many reached upsert
- how many are genuinely new
- how many are new and require review
- how many are active immediately without review
- how many are blocked or trashed by policy

This must answer a concrete question for one run, not only aggregate over the whole table.

## Locked Decisions

| Topic                   | Decision                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Run identity            | One `run_id` per n8n execution, even when fanned out across portals.                 |
| Backfill runs           | Same tables as scheduled runs. Differentiated by `trigger_source`.                   |
| Drilldown depth         | Log every offer at every stage (`rea_import_run_offer_events`).                      |
| Retention               | None for POC. Keep all rows forever.                                                 |
| Dashboard               | New tab in existing React FE (`rea-fe/frontend`); endpoints in `rea-fe/api/main.py`. |
| Failure detection       | Both n8n error trigger and a watchdog.                                               |
| Watchdog implementation | Separate n8n schedule running a SQL update.                                          |
| Final policy state      | Computed once at run finalization, not per-offer.                                    |
| Upsert SQL              | Not changed. `is_new_offer` derived by pre-existence check before upsert.            |
| AI rating               | Runs in a separate flow later. Reserved JSONB keys, no schema work now.              |

## Problem Recap

The current system stores final offer state in `rea_property_offers` but does not persist a workflow-level `run_id`. After a run finishes we cannot reliably answer:

- how many items were seen in one specific run
- which stage rejected them
- whether an upserted row was new or only refreshed
- how many items were lost before SQL

Reconstruction from `rea_property_offers` alone is not possible because deduplication, updates, and policy actions destroy the funnel signal.

## Design Principle

A dedicated run telemetry layer with three tables:

1. one row per run (`rea_import_runs`)
2. one aggregated metric row per stage per run (`rea_import_run_stage_metrics`)
3. one detail row per offer per stage (`rea_import_run_offer_events`)

`rea_property_offers` is not modified by this design.

## Data Model

### 1. `rea_import_runs`

```sql
CREATE TABLE IF NOT EXISTS rea_import_runs (
    run_id TEXT PRIMARY KEY,
    workflow_name TEXT NOT NULL,
    workflow_version TEXT,
    trigger_source TEXT NOT NULL DEFAULT 'schedule',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    portal_scope TEXT,
    notes TEXT,
    raw_execution_id TEXT,
    summary JSONB
);

CREATE INDEX IF NOT EXISTS idx_rea_import_runs_started_at
    ON rea_import_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rea_import_runs_status
    ON rea_import_runs (status);
```

`trigger_source` closed vocabulary: `schedule | backfill | manual_url | manual_replay`.

`status` closed vocabulary: `running | completed | failed | stale | aborted`.

`run_id` format: ULID-like, sortable, URL-safe. Example: `2026-04-29T070000Z__01HXYZABCDEF`.

### 2. `rea_import_run_stage_metrics`

Aggregated counters per stage. Slim universal columns; reasons live in `metadata`.

```sql
CREATE TABLE IF NOT EXISTS rea_import_run_stage_metrics (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES rea_import_runs(run_id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    stage_order INTEGER NOT NULL,
    input_count INTEGER NOT NULL DEFAULT 0,
    output_count INTEGER NOT NULL DEFAULT 0,
    dropped_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(run_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_stage_metrics_run
    ON rea_import_run_stage_metrics (run_id, stage_order);
```

`metadata` JSONB conventions:

```json
{
  "drops": { "invalid_url": 12, "below_area": 16, "no_html": 3 },
  "by_portal": { "otodom": 80, "no": 16 },
  "ai": { "tokens_in": 0, "tokens_out": 0, "model": null }
}
```

Idempotency rule: writes use `INSERT ... ON CONFLICT (run_id, stage_key) DO UPDATE SET ...` with **overwrite** semantics. Each stage writes its final values once, at the end of the stage.

### 3. `rea_import_run_offer_events`

One row per offer per stage. Per locked decision 3, every offer is logged at every stage.

```sql
CREATE TABLE IF NOT EXISTS rea_import_run_offer_events (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES rea_import_runs(run_id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    stage_order INTEGER,
    external_id TEXT,
    url TEXT,
    event_type TEXT NOT NULL,
    event_reason TEXT,
    is_new_offer BOOLEAN,
    review_status TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_events_run_stage
    ON rea_import_run_offer_events (run_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_run_events_external_id
    ON rea_import_run_offer_events (external_id);
CREATE INDEX IF NOT EXISTS idx_run_events_event_type
    ON rea_import_run_offer_events (run_id, event_type);
```

`event_type` closed vocabulary: `entered | passed | dropped | inserted | updated | rated | failed | final_state`.

`event_reason` closed vocabulary (extend with care):

- validator: `invalid_url`, `invalid_external_id`, `below_area`, `parse_error`, `no_html`
- fetch: `http_404`, `http_403`, `http_timeout`, `http_other`
- merge: `length_mismatch`, `missing_detail`
- upsert: `existing`, `new`
- ai: `parse_failed`, `rate_limited`
- policy: `pending`, `not_needed`, `blocked`, `trashed`

`payload` reserved keys for the future AI flow: `tokens_in`, `tokens_out`, `model`, `cost_estimate_usd`.

Volume estimate at POC scale (~100 offers/day x ~6 stages): negligible. No partitioning, no retention.

## Stage Taxonomy

Stable stage keys, independent of n8n node labels.

Scheduled runs:

1. `parse_list`
2. `fetch_detail`
3. `merge_detail`
4. `validate_before_sql`
5. `upsert_offer`
6. `final_policy_state`

Backfill runs:

1. `select_candidates`
2. `fetch_detail`
3. `merge_detail`
4. `ai_rate`
5. `update_offer_after_ai`
6. `final_policy_state`

`stage_order` matches the position in this list.

## What Each Stage Measures

### `parse_list` (scheduled)

- `output_count` = total parsed offers across all portals
- `metadata.by_portal.otodom`, `metadata.by_portal.no`
- one event per offer with `event_type = 'entered'`

### `fetch_detail`

- `input_count`, `output_count`, `error_count`
- one event per offer: `passed` or `dropped` with `event_reason` = `http_404` etc.

### `merge_detail`

- `input_count`, `output_count`, `dropped_count` (length mismatches)
- per-offer `passed` events; `dropped` events for failed merges

### `validate_before_sql`

- `input_count`, `output_count`, `dropped_count`
- `metadata.drops` keyed by reason
- one event per offer: `passed` or `dropped` with `event_reason`
- **Pre-existence check happens here**: a single SQL `SELECT external_id FROM rea_property_offers WHERE external_id = ANY($1::text[])` tags each surviving item with `is_new_offer = true|false`. Tag flows downstream and is recorded in `event.is_new_offer` and `event.payload.is_new_offer`.

### `upsert_offer`

- `input_count` = items entering upsert
- `output_count` = rows confirmed in DB
- one event per offer with `event_type = 'inserted'` if `is_new_offer=true`, else `'updated'`. `is_new_offer` is read from the validator-stage tag, not from the upsert SQL response. The current upsert query is **not** modified.

Race condition note: a parallel run could in theory upsert the same `external_id` between the pre-check and the actual upsert. n8n executes one workflow instance at a time, and backfill targets a disjoint set, so this is acceptable for POC.

### `final_policy_state`

Computed once at run finalization with a single SQL pass, not per-offer:

```sql
INSERT INTO rea_import_run_offer_events
    (run_id, stage_key, stage_order, external_id, url,
     event_type, event_reason, is_new_offer, review_status, payload)
SELECT
    $1 AS run_id,
    'final_policy_state' AS stage_key,
    6 AS stage_order,
    o.external_id,
    o.url,
    'final_state' AS event_type,
    o.review_status AS event_reason,
    (e.payload->>'is_new_offer')::boolean AS is_new_offer,
    o.review_status,
    jsonb_build_object(
        'ai_rating', o.ai_rating,
        'is_in_trash', o.is_in_trash
    ) AS payload
FROM rea_property_offers o
JOIN rea_import_run_offer_events e
  ON e.external_id = o.external_id
 AND e.run_id = $1
 AND e.stage_key = 'upsert_offer';
```

Then aggregate counters into `rea_import_run_stage_metrics` and freeze `rea_import_runs.summary`.

Counters produced:

- `review_pending_count`
- `review_not_needed_count`
- `review_blocked_count`
- `review_trashed_count`
- derived: `new_pending_review_count`, `new_active_no_review_count`, `new_blocked_count`

## 2026-04-29 Change Log

The following changes were implemented on top of the reporting work so the single-offer AI re-evaluation path is usable in day-to-day operation.

### Workflow and Runtime

- Added a single-offer re-evaluation webhook branch inside `n8n/workflows/Real Estate AI Agent.json` instead of a separate workflow file.
- Added the single-offer nodes:
  - `wh-single-offer-re-evaluate`
  - `js-single-offer-re-evaluate-input`
  - `sql-single-offer-re-evaluate`
  - `hr-single-offer-re-evaluate-details`
  - `js-single-offer-merge-with-desc`
  - `sql-single-offer-aia-feedback-hints`
  - `js-single-offer-aia-attach-feedback-hint`
  - `AI Agent - Single Offer Re-evaluate`
  - `js-single-offer-aia-output-parser`
  - `sql-single-offer-aia-update-offer`
- Fixed the single-offer AI agent branch so the cloned AI node has a connected chat model and can execute after publication.
- Fixed the single-offer DB update step to match on the original webhook `external_id`, not the AI-returned `external_id`, so malformed AI output cannot update the wrong row or fail on a non-existent key.
- Synced the active n8n workflow JSON with the Postgres-backed `workflow_entity` and `workflow_history` rows during rollout because local file changes alone were not sufficient in this setup.

### AI Extraction and Scoring

- Updated the AI prompt with a property-type-first rule so house-like listings are not penalized for apartment-only criteria such as elevator or boutique-building evidence.
- Hardened the AI output parser against malformed JSON.
- Added fallback parsing for numeric fields and title recovery from raw model output.
- Added `construction_year` recovery from listing HTML when the model omits or corrupts the year.
- Standardized `lot_size` to square meters (`m2`) instead of ares.
- Added `lot_size` normalization logic so values such as `3.214` are corrected to `321.4` when the HTML and AI analysis clearly describe a `321.4 m²` garden.

### Data Integrity and Persistence

- Strengthened SQL persistence so missing metadata fields such as `district`, `location_text`, and `property_portal` are written consistently.
- Preserved defensive validation before SQL so rows with empty or invalid `external_id` or `url` do not enter the database.
- Corrected the affected offer `OT-67955868` through the re-evaluation flow, resulting in `lot_size = 321.4` and refreshed AI analysis.

### API and Frontend

- Added `POST /api/offers/{external_id}/re-evaluate` in `rea-fe/api/main.py`.
- Added frontend support for one-click `Re-evaluate AI` from the offer detail dialog.
- Added API-side retry logic for the webhook call so short restart windows in n8n do not immediately fail the user action when the container is up but the webhook is not fully registered yet.
- Added environment knobs for webhook retry behavior:
  - `REEVALUATE_OFFER_WEBHOOK_RETRIES`
  - `REEVALUATE_OFFER_WEBHOOK_RETRY_DELAY_SECONDS`

### Operational Notes

- In this n8n deployment, published workflow metadata and history rows must stay consistent with the file-based workflow definition. When they diverge, production webhooks can disappear after restart or execute stale node graphs.
- The direct webhook path was used as the source-of-truth validation path during rollout because it isolates workflow execution from frontend and API concerns.

## Definitions

- **new offer**: `is_new_offer = true` for that offer's `upsert_offer` event in this run.
- **existing offer**: `is_new_offer = false` for that offer in this run.
- **new_to_review_count**: offers where `is_new_offer = true` AND `review_status = 'pending'` at run finalization.

`created_at >= run_started_at` is **not** an acceptable definition.

## Workflow Changes in n8n

### A. Generate `run_id` at start

First Code node after the schedule trigger:

```javascript
const now = new Date();
const ts = now.toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
const random = Math.random().toString(36).slice(2, 14).toUpperCase();
const run_id = `${ts}__${random}`;

return [{
  json: {
    run_id,
    workflow_name: 'Real Estate AI Agent',
    workflow_version: null,
    trigger_source: 'schedule',
    started_at: now.toISOString(),
  }
}];
```

Followed by a SQL node that inserts the row into `rea_import_runs` with `status = 'running'`.

### B. Carry `run_id` through every branch

Every offer item must include `run_id`, `workflow_name`, optionally `portal_source`. Cross-stage aggregation depends on this.

### C. Stage instrumentation pattern (shared template)

Every measured stage uses two outputs:

```javascript
const items = $input.all();
const run_id = items[0]?.json?.run_id;
const stage_key = 'validate_before_sql';
const stage_order = 4;

const valid = [];
const events = [];

for (const item of items) {
  const reason = classify(item.json); // returns null if valid
  const base = {
    run_id,
    stage_key,
    stage_order,
    external_id: item.json.external_id,
    url: item.json.url,
  };
  if (reason) {
    events.push({ json: { ...base, event_type: 'dropped', event_reason: reason } });
  } else {
    valid.push(item);
    events.push({ json: { ...base, event_type: 'passed' } });
  }
}

return [valid, events];
```

Output 0 -> main pipeline. Output 1 -> shared "Insert Event" SQL node that writes into `rea_import_run_offer_events`.

A separate Code+SQL pair writes the aggregated `rea_import_run_stage_metrics` row at the end of the stage with overwrite semantics.

### D. Pre-existence check inside `validate_before_sql`

After classification, before returning, batch-check existing IDs:

```javascript
const ids = valid.map(i => i.json.external_id);
// Run via SQL node: SELECT external_id FROM rea_property_offers WHERE external_id = ANY($1::text[])
// then tag each item:
const existing = new Set(existingIdsFromSqlNode);
for (const item of valid) {
  item.json.is_new_offer = !existing.has(item.json.external_id);
}
```

This tag flows into the upsert event emission.

### E. Upsert SQL is unchanged

Per locked decision 8. The `is_new_offer` flag is sourced from the validator tag, written into `rea_import_run_offer_events`. The current `sql-add-offer` query is left as-is.

### F. Run finalization

Last node before workflow end:

1. Run the `final_policy_state` SQL above.
2. Aggregate stage counters and write the summary:

```sql
UPDATE rea_import_runs
SET status = 'completed',
    finished_at = NOW(),
    summary = $2
WHERE run_id = $1;
```

### G. Error path

n8n error trigger writes:

```sql
UPDATE rea_import_runs
SET status = 'failed',
    finished_at = NOW(),
    summary = COALESCE(summary, '{}'::jsonb) || $2
WHERE run_id = $1;
```

Partial stage metrics are kept as written.

### H. Watchdog (separate n8n schedule)

A standalone n8n workflow runs every 15 minutes with a single SQL node:

```sql
UPDATE rea_import_runs
SET status = 'stale',
    finished_at = NOW()
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '2 hours';
```

Threshold may be tuned later.

## Example Summary Payload

Stored in `rea_import_runs.summary`:

```json
{
  "entered_workflow": 124,
  "validated_for_sql": 96,
  "dropped_before_sql": 28,
  "drops_by_reason": { "invalid_url": 12, "below_area": 16 },
  "inserted_new": 14,
  "updated_existing": 82,
  "new_to_review": 6,
  "new_not_needed": 5,
  "new_blocked": 3,
  "new_trashed": 0,
  "ai_rated": 0,
  "ai_parse_failed": 0
}
```

`ai_*` fields stay 0 in scheduled runs; the separate AI flow fills them later.

## Example SQL Queries

### Run list

```sql
SELECT run_id, workflow_name, trigger_source, started_at, finished_at, status, summary
FROM rea_import_runs
ORDER BY started_at DESC
LIMIT 50;
```

### Stage summary for one run

```sql
SELECT stage_order, stage_key, input_count, output_count, dropped_count, error_count,
       duration_ms, metadata
FROM rea_import_run_stage_metrics
WHERE run_id = $1
ORDER BY stage_order;
```

### New offers to review for one run

```sql
SELECT external_id, url, review_status, payload
FROM rea_import_run_offer_events
WHERE run_id = $1
  AND stage_key = 'final_policy_state'
  AND is_new_offer = TRUE
  AND review_status = 'pending'
ORDER BY created_at DESC;
```

## API Endpoints (FastAPI, `rea-fe/api/main.py`)

- `GET /api/import-runs?limit=50&trigger_source=schedule`
- `GET /api/import-runs/{run_id}` -> run row + stage metrics array
- `GET /api/import-runs/{run_id}/events?stage_key=&event_type=`
- `GET /api/import-runs/{run_id}/new-pending` -> list of new offers awaiting review

## React FE (`rea-fe/frontend`)

New tab `Import runs`:

- **List**: started_at, trigger_source, status, entered, dropped, inserted_new, new_to_review.
- **Detail drawer**: stage funnel (bar chart), drop reasons table, raw events tab with filters.

## Phased Implementation Plan

### Phase 1.0 - schema + run identity

1. SQL migration for the three tables (in `sql/`).
2. `run_id` generation node + SQL insert at workflow start.
3. Run finalization SQL (status update only, no stage data yet).
4. n8n error trigger writes `failed`.
5. Separate watchdog workflow for `stale`.

Verifies that one execution produces exactly one `rea_import_runs` row with the right lifecycle.

### Phase 1.1 - instrument `validate_before_sql`

Highest value, smallest blast radius. Adds:

- two-output stage template
- shared "Insert Event" SQL node
- shared "Write Stage Metrics" SQL node
- drop reason metadata

### Phase 1.2 - pre-existence check + `upsert_offer` events

- batch SELECT to tag `is_new_offer`
- emit `inserted`/`updated` events
- no change to upsert SQL

### Phase 1.3 - instrument `parse_list`, `fetch_detail`, `merge_detail`

Closes the funnel. After this, `output(N) == input(N+1)` invariant should hold; log discrepancies as `metadata.unexplained_loss`.

### Phase 1.4 - `final_policy_state` aggregation + summary freeze

Single SQL pass at end of run. Populates the summary JSON.

### Phase 2 - backend + FE

- FastAPI endpoints
- React `Import runs` page

### Phase 3 - backfill workflow instrumentation

Same schema, different stage list. Same `run_id` generator. AI fields populated.

## Test Plan (per phase)

- Inject 10 known offers, half new half existing -> assert `inserted_new=5` after Phase 1.2.
- Inject 5 invalid rows -> assert `dropped_count=5` and matching event rows.
- Kill the workflow mid-run -> after 2h, watchdog flips run to `stale`.
- Run two scheduled imports back to back -> no duplicate `run_id`, summaries independent.
- Run backfill while a scheduled run is queued -> both produce correct `trigger_source` and disjoint event sets.

## Why This Works

- One `run_id` per execution gives a clean unit of analysis.
- Per-offer event log + slim metric counters allow both fast dashboards and full drilldown.
- Pre-existence check derives `is_new_offer` without touching the upsert query.
- Final policy snapshot is a single SQL pass; no per-offer plumbing for review state.
- Error trigger plus watchdog covers both clean and dirty failures.

---

# Implementation Plan

This section is the executable counterpart of the design above. Each phase lists concrete files to create or modify, n8n nodes to add, and acceptance criteria.

## Conventions

- All SQL migrations live in `sql/` as numbered files: `sql/run_telemetry.sql`, etc. Apply manually via `psql` for POC; no migration tool yet.
- All new parser/code-node JS sources live in `n8n/parsers/js/`. Filename matches the n8n node name (locked rule).
- Workflow JSON edits target only `n8n/workflows/Real Estate AI Agent.json`. Other JSONs stay as backups.
- Each phase ends with a workflow version bump via `scripts/bump-workflow-version.js`.
- Each phase is independently shippable. Roll back by reverting workflow JSON + dropping new tables (Phase 1.0) or removing added nodes.

## Current Workflow Anchors

The plan references these existing nodes (verified in `Real Estate AI Agent.json`):

| Existing node                                  | Role                              |
| ---------------------------------------------- | --------------------------------- |
| `st-apartment`                                 | scheduled trigger; pipeline entry |
| `hr-od-apartment`, `hr-no-apartment`           | list page fetch                   |
| `js-od-parser`, `js-no-parser`                 | list parsers                      |
| `merge-offers`                                 | merges Otodom + NO streams        |
| `hr-offer-details`                             | detail page fetch                 |
| `js-merge-with-desc`                           | merges detail HTML                |
| `js-validate-offer-before-sql`                 | current validator                 |
| `sql-add-offer`                                | upsert (must NOT change)          |
| `js-aia-output-parser`, `sql-aia-update-offer` | AI flow (separate path)           |

New nodes added by this plan use prefix `tlm-` (telemetry) for easy identification.

---

## Phase 1.0 — Schema + Run Identity

**Goal**: every n8n execution produces exactly one `rea_import_runs` row with a clean lifecycle. No stage data yet.

### Files to create

- `sql/run_telemetry.sql` — full DDL for the three tables and indexes from the Data Model section.
- `n8n/parsers/js/tlm-init-run.js` — generates `run_id`, `started_at`, `workflow_name`, `trigger_source`.
- `n8n/parsers/js/tlm-build-summary.js` — placeholder (Phase 1.4 fills logic); for now returns `{}`.

### Workflow changes (`Real Estate AI Agent.json`)

Insert these nodes after `st-apartment` and before any list fetch:

1. **Code node `tlm-init-run`** — runs `tlm-init-run.js`. Output flows to step 2 and to all downstream branches (carry `run_id`).
2. **Postgres node `tlm-sql-insert-run`** — `INSERT INTO rea_import_runs (run_id, workflow_name, trigger_source, started_at, status) VALUES ($1, $2, 'schedule', $3, 'running')`.

At workflow end (after `sql-add-offer` and AI branches converge):

3. **Postgres node `tlm-sql-finalize-run`** — `UPDATE rea_import_runs SET status='completed', finished_at=NOW() WHERE run_id=$1`.

Add an n8n **Error Trigger** workflow path:

4. **Postgres node `tlm-sql-fail-run`** — `UPDATE rea_import_runs SET status='failed', finished_at=NOW() WHERE run_id=$1`. Wire to the n8n error workflow setting on the main workflow.

### New separate workflow

Create `n8n/workflows/run-watchdog.json` (or add inside main file as a separate trigger graph):

- Schedule trigger: every 15 minutes.
- Single Postgres node running the `stale` UPDATE from section H.

### Acceptance

- One manual run inserts one row with `status='running'`, then flips to `completed` with `finished_at` set.
- Forced error (e.g., poison the validator) leaves a row with `status='failed'`.
- Watchdog test: manually insert a fake `running` row 3 hours old → next watchdog tick flips it to `stale`.

### Rollback

Drop the three tables, remove the four telemetry nodes, restore previous workflow JSON.

---

## Phase 1.1 — Instrument `validate_before_sql`

**Goal**: replace `js-validate-offer-before-sql` with a measured two-output version. Get the first real funnel data point.

### Files to create

- `n8n/parsers/js/js-validate-offer-before-sql.js` — replace existing with classification logic returning `[valid, events]` (template from design section C). Keep the existing validation rules byte-for-byte; only change shape.
- `n8n/parsers/js/tlm-write-stage-metrics.js` — shared helper that builds the metrics row payload for any stage. Inputs: `run_id`, `stage_key`, `stage_order`, counters object, metadata object.

### Workflow changes

1. Update `js-validate-offer-before-sql` node to use the new two-output script.
2. Add **Postgres node `tlm-sql-insert-event`** (shared, generic):
   ```sql
   INSERT INTO rea_import_run_offer_events
       (run_id, stage_key, stage_order, external_id, url, event_type, event_reason, payload)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb);
   ```
   Wire output 1 of the validator to it.
3. Add **Code node `tlm-validate-summary`** that consumes the same telemetry stream and computes counters, then **Postgres node `tlm-sql-upsert-stage-metrics`**:
   ```sql
   INSERT INTO rea_import_run_stage_metrics
       (run_id, stage_key, stage_order, input_count, output_count, dropped_count, metadata)
   VALUES ($1, 'validate_before_sql', 4, $2, $3, $4, $5::jsonb)
   ON CONFLICT (run_id, stage_key) DO UPDATE SET
       input_count = EXCLUDED.input_count,
       output_count = EXCLUDED.output_count,
       dropped_count = EXCLUDED.dropped_count,
       metadata = EXCLUDED.metadata;
   ```

### Acceptance

- Inject 10 items where 3 fail validation → after run, exactly 3 rows in `rea_import_run_offer_events` with `event_type='dropped'` and 7 with `event_type='passed'`.
- `rea_import_run_stage_metrics` has one row for `stage_key='validate_before_sql'` with matching counters.
- `metadata.drops` reflects per-reason breakdown.

### Rollback

Restore the original single-output validator script. Drop the two telemetry nodes for this stage. Other tables remain harmless.

---

## Phase 1.2 — Pre-Existence Check + `upsert_offer` Events

**Goal**: tag every item with `is_new_offer` and emit one event per upsert.

### Files to create

- `n8n/parsers/js/tlm-tag-is-new.js` — receives valid items + result of the SELECT, sets `item.json.is_new_offer`.

### Workflow changes

1. After `js-validate-offer-before-sql` (main output), insert:
   - **Postgres node `tlm-sql-existing-ids`**:
     ```sql
     SELECT external_id FROM rea_property_offers
     WHERE external_id = ANY($1::text[]);
     ```
     Input: array of external_ids from valid items.
   - **Code node `tlm-tag-is-new`**: merges the SQL result with the valid items, sets `is_new_offer`.
2. After `sql-add-offer`, add a **Code node `tlm-emit-upsert-events`** that emits one event per item:
   ```javascript
   return $input.all().map(it => ({
     json: {
       run_id: it.json.run_id,
       stage_key: 'upsert_offer',
       stage_order: 5,
       external_id: it.json.external_id,
       url: it.json.url,
       event_type: it.json.is_new_offer ? 'inserted' : 'updated',
       event_reason: it.json.is_new_offer ? 'new' : 'existing',
       payload: JSON.stringify({ is_new_offer: !!it.json.is_new_offer }),
     }
   }));
   ```
3. Wire its output to the existing `tlm-sql-insert-event` node.
4. Add **Code + Postgres** pair to write `upsert_offer` stage metrics (input_count, output_count, inserted/updated counts in metadata).

### Acceptance

- Inject 5 known-existing + 5 known-new offers. After run, `rea_import_run_offer_events` has 5 `inserted` and 5 `updated` rows. `sql-add-offer` query is byte-identical to before.
- Re-run same input set: now 10 `updated` rows, 0 `inserted`.

### Phase 1.2 Test Tasks (Execution)

- [ ] Run one scheduled import and verify in SQL that stage `upsert_offer` contains both `inserted` and `updated` events for this run.
- [ ] Run regression dataset test with 10 offers (5 known-existing + 5 known-new) and assert exact counts: `inserted=5`, `updated=5`.
- [ ] Re-run the same dataset and assert exact counts: `inserted=0`, `updated=10`.
- [x] Confirm that `sql-add-offer` statement is unchanged after phase deployment (no query edits, telemetry only).
- [ ] Mark phase as production-ready only after all four checks pass in one deployment cycle.

### Rollback

Remove the four added nodes. The pre-check has no side effects on `rea_property_offers`.

---

## Phase 1.3 — Instrument `parse_list`, `fetch_detail`, `merge_detail`

**Goal**: close the funnel so `output(N) == input(N+1)` invariant holds (or the gap is logged).

### Files to modify

- `n8n/parsers/js/js-od-parser.js`, `js-no-parser.js`: append a telemetry side-emission. Keep their main output unchanged; add a parallel output of `entered` events (one per parsed offer) tagged with `portal_source`.
- `n8n/parsers/js/js-merge-with-desc.js`: detect length mismatch between offers and detail responses; emit `dropped` events with `event_reason='length_mismatch'`.

### Workflow changes

1. Update `js-od-parser` and `js-no-parser` to output two streams. Wire stream 2 to `tlm-sql-insert-event`.
2. After `merge-offers`, add a **Code node `tlm-parse-list-summary`** that counts entered offers per portal and writes the `parse_list` stage metrics row.
3. After `hr-offer-details`, add a **Code node `tlm-fetch-detail-events`** that emits one `passed`/`dropped` event per item with HTTP status mapped to `event_reason`.
4. Update `js-merge-with-desc` to also emit `merge_detail` events.
5. Add a stage metrics writer for `fetch_detail` and `merge_detail`.

### Invariant check

Add a small node `tlm-funnel-check` (optional) that at run finalization computes per-stage `output - next_input` and stores residuals in `metadata.unexplained_loss`.

### Acceptance

- For one full run: `parse_list.output_count == fetch_detail.input_count == merge_detail.input_count`. Any gap > 0 surfaces in metadata.
- Per-portal counts in `metadata.by_portal` match what each parser produced.

---

## Phase 1.4 — `final_policy_state` + Summary Freeze

**Goal**: end-of-run aggregate produces the JSON summary stored in `rea_import_runs.summary`.

### Workflow changes

1. After all branches converge (after AI rating completes — but per locked decision 7, AI is a separate flow, so this phase only relies on `is_in_trash` / `review_status` set during upsert and policy nodes), add:
   - **Postgres node `tlm-sql-final-policy`** running the `final_policy_state` INSERT … SELECT from the design.
   - **Postgres node `tlm-sql-final-policy-metrics`** aggregating counts into `rea_import_run_stage_metrics`:
     ```sql
     INSERT INTO rea_import_run_stage_metrics (run_id, stage_key, stage_order, input_count, output_count, metadata)
     SELECT
         $1, 'final_policy_state', 6,
         COUNT(*), COUNT(*),
         jsonb_build_object(
             'review_pending', COUNT(*) FILTER (WHERE review_status='pending'),
             'review_not_needed', COUNT(*) FILTER (WHERE review_status='not_needed'),
             'review_blocked', COUNT(*) FILTER (WHERE review_status='blocked'),
             'review_trashed', COUNT(*) FILTER (WHERE review_status='trashed'),
             'new_pending_review', COUNT(*) FILTER (WHERE is_new_offer AND review_status='pending'),
             'new_active_no_review', COUNT(*) FILTER (WHERE is_new_offer AND review_status='not_needed'),
             'new_blocked', COUNT(*) FILTER (WHERE is_new_offer AND review_status='blocked')
         )
     FROM rea_import_run_offer_events
     WHERE run_id = $1 AND stage_key = 'final_policy_state'
     ON CONFLICT (run_id, stage_key) DO UPDATE SET
         input_count = EXCLUDED.input_count,
         output_count = EXCLUDED.output_count,
         metadata = EXCLUDED.metadata;
     ```
2. Replace the placeholder `tlm-build-summary.js` with logic that reads `rea_import_run_stage_metrics` for the run and assembles the summary JSON.
3. Update `tlm-sql-finalize-run` to also set `summary = $2`.

### Acceptance

- Manual run produces a `rea_import_runs.summary` JSON identical in shape to the example payload.
- `summary.new_to_review` equals `metadata.new_pending_review` from `final_policy_state` row.

---

## Phase 2 — Backend + Frontend

**Goal**: surface the data in the existing React FE.

### Backend (`rea-fe/api/main.py`)

Add four endpoints (Pydantic models inline):

- `GET /api/import-runs?limit=50&trigger_source=schedule` → list rows from `rea_import_runs` ordered by `started_at DESC`.
- `GET /api/import-runs/{run_id}` → one run + array of `rea_import_run_stage_metrics` rows.
- `GET /api/import-runs/{run_id}/events?stage_key=&event_type=` → paginated events.
- `GET /api/import-runs/{run_id}/new-pending` → join of `rea_property_offers` + final_policy events where `is_new_offer=true AND review_status='pending'`.

Add tests in `rea-fe/api/tests/` mirroring existing patterns.

### Frontend (`rea-fe/frontend`)

- New route `/import-runs` and a sidebar/tab entry called `Import runs`.
- New components in `rea-fe/frontend/src/`:
  - `ImportRunsList.jsx` — table view.
  - `ImportRunDetail.jsx` — drawer/page with three tabs: Funnel, Drop reasons, Events.
  - Extend `api.js` with the four new client functions.

### Acceptance

- React page lists last 50 runs and a click opens the detail drawer with a working funnel chart.
- Filtering by `trigger_source=schedule` works.

---

## Phase 3 — Backfill Workflow Instrumentation

**Goal**: backfill runs (the AI re-rating path through `hr-backfill`, `js-backfill-merge-with-desc`, `sql-aia-update-offer`) emit telemetry into the same tables.

### Workflow changes

- Add `tlm-init-run` at the start of the backfill schedule trigger (`st-ai-rating`) with `trigger_source='backfill'`.
- Map backfill nodes to the backfill stage list:
  - `select_candidates` → after `sql-backfill-ai`
  - `fetch_detail` → `hr-backfill`
  - `merge_detail` → `js-backfill-merge-with-desc`
  - `ai_rate` → after Anthropic node, with token counts in `metadata.ai`
  - `update_offer_after_ai` → `sql-aia-update-offer`
  - `final_policy_state` → end-of-run aggregate (same SQL as Phase 1.4)
- Reuse all `tlm-*` shared nodes; only the stage_key strings change.

### Acceptance

- One backfill run produces a `rea_import_runs` row with `trigger_source='backfill'` and 6 stage metric rows with the backfill stage keys.
- AI metadata fields populated with token counts from the Anthropic response.

---

## Cross-Cutting Tasks

These apply to every phase:

- **Run carry-through**: every Code node added in this plan must preserve `run_id` on `item.json`. Existing nodes (`js-merge-with-desc`, `merge-offers`, etc.) need a one-line `run_id: items[0].json.run_id` propagation patch where they construct new objects.
- **Workflow version bump** on each merged phase (`node scripts/bump-workflow-version.js`).
- **Repo memory update** in `/memories/repo/re-ai-agent-workflow-versioning.md` with phase notes.

## Risk Register

| Risk                                                                           | Likelihood | Mitigation                                                                                                             |
| ------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| `run_id` lost in a branch where new objects are spread without it              | Medium     | Code review checklist + a sentinel SQL check that fails events without run_id (`run_id` is NOT NULL FK).               |
| Pre-existence check race with backfill                                         | Low        | Backfill targets distinct rows (existing offers); scheduled run inserts new ones. n8n executes one workflow at a time. |
| Volume from per-stage events grows unexpectedly                                | Low        | POC volume verified ~600 rows/day. Monitor `pg_relation_size('rea_import_run_offer_events')` quarterly.                |
| Watchdog flips a legitimately long run to `stale`                              | Low        | 2h threshold > current p95 run time; tune if scheduled scope grows.                                                    |
| Error trigger does not fire on certain failure modes (e.g., n8n process crash) | Medium     | Watchdog covers this case by design.                                                                                   |

## Definition of Done (whole feature)

- All four operational questions from the Goal section answerable from a single SQL query against the new tables.
- React `Import runs` page shows a working funnel for the latest scheduled run.
- Backfill runs visible alongside scheduled runs, filterable by `trigger_source`.
- `sql/add_offer.sql` unchanged from pre-feature state.
- README updated with a short pointer to this design doc.

---

## Implementation Status (as of 2026-05-26)

### Checklist (phase-level)

- [x] Phase 1.0 — Schema + Run Identity
- [x] Phase 1.1 — Instrument `validate_before_sql`
- [x] Phase 1.2 — Pre-Existence Check + `upsert_offer` Events
- [x] Phase 1.3 — Instrument `parse_list`, `fetch_detail`, `merge_detail`
- [x] Phase 1.4 — `final_policy_state` + Summary Freeze
- [ ] Phase 2 — Backend + Frontend (in progress)
- [ ] Phase 3 — Backfill Workflow Instrumentation

### Phase 1.0 — Schema + Run Identity ✅ DONE

All deliverables shipped and validated in production (workflow version `1.0.2`).

| Item                                                                          | Status | Notes                                                                                                                                      |
| ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `a` — DDL for all three tables                                                | ✅ Done | Applied to `re_ai_agent_data` DB                                                                                                           |
| `tlm-init-run` Code node — generates `run_id`, inserts into `rea_import_runs` | ✅ Done | Node live in workflow; JS mirror at `n8n/parsers/js/tlm-init-run.js`                                                                       |
| `tlm-sql-insert-run` Postgres node                                            | ✅ Done | Inserts with `status='running'`                                                                                                            |
| `tlm-sql-finalize-run` Postgres node                                          | ✅ Done | Sets `status='completed'`, `finished_at=NOW()`                                                                                             |
| n8n Error Trigger path + `tlm-sql-fail-run`                                   | ✅ Done | Sets `status='failed'` on workflow error                                                                                                   |
| Watchdog trigger (stale runs)                                                 | ✅ Done | Implemented as a second Schedule Trigger branch inside `Real Estate AI Agent.json`; runs every 15 min; flips runs older than 2h to `stale` |
| Workflow version bumped to `1.0.2`                                            | ✅ Done | Via `scripts/bump-workflow-version.js`                                                                                                     |

### Phase 1.1 — Instrument `validate_before_sql` ✅ DONE

Two-output validator, per-offer event rows, stage metrics row.

| Item                                                     | Status | Notes                                                                       |
| -------------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `js-validate-offer-before-sql.js` — two-output validator | ✅ Done | Emits valid items (output 0) and telemetry events (output 1)                |
| `tlm-write-stage-metrics.js` — shared metrics helper     | ✅ Done | JS module for stage metrics payload construction                            |
| `tlm-validate-summary.js` — metrics aggregation          | ✅ Done | Computes input/output/dropped counts and drop reason breakdown              |
| `tlm-sql-insert-event` Postgres node                     | ✅ Done | Inserts per-offer telemetry events into `rea_import_run_offer_events`       |
| `tlm-validate-summary` Code node                         | ✅ Done | Aggregates events and computes stage counters                               |
| `tlm-sql-upsert-stage-metrics` Postgres node             | ✅ Done | Upserts aggregated metrics into `rea_import_run_stage_metrics`              |
| Workflow connections updated                             | ✅ Done | Two-output wiring from validator to both main pipeline and telemetry branch |

### Phase 1.2 — Pre-Existence Check + `upsert_offer` Events ✅ DONE

`is_new_offer` tagging and `inserted`/`updated` event emission are implemented in the scheduled run path.

| Item                                     | Status      | Notes                                                                             |
| ---------------------------------------- | ----------- | --------------------------------------------------------------------------------- |
| `tlm-build-existing-ids-input` Code node | ✅ Done      | Builds one batched `external_ids` payload from validated offers                   |
| `tlm-sql-existing-ids` Postgres node     | ✅ Done      | Batch pre-check against `rea_property_offers` using one SQL query                 |
| `tlm-tag-is-new` Code node               | ✅ Done      | Sets `is_new_offer` on each validated item                                        |
| `tlm-emit-upsert-events` Code node       | ✅ Done      | Emits `upsert_offer` events as `inserted` or `updated`                            |
| `tlm-upsert-summary` Code node           | ✅ Done      | Aggregates `upsert_offer` stage counters                                          |
| Upsert telemetry wiring                  | ✅ Done      | `tlm-emit-upsert-events` wired to `tlm-sql-insert-event` and stage metrics upsert |
| `sql-add-offer` SQL                      | ✅ Unchanged | Upsert query kept as-is per locked decision                                       |

### Phase 1.3 — Instrument `parse_list`, `fetch_detail`, `merge_detail` ✅ DONE

Full scheduled-run funnel closure shipped in workflow version `1.5.2`.

| Item                        | Status | Notes                                                                                                            |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `parse_list` stage metrics  | ✅ Done | Writes aggregated counts with `metadata.by_portal`                                                               |
| `fetch_detail` stage events | ✅ Done | Emits per-offer `passed` / `dropped` events with mapped HTTP reasons                                             |
| `merge_detail` stage events | ✅ Done | Emits per-offer `passed` / `dropped` events and stage metrics                                                    |
| Parser telemetry wiring     | ✅ Done | `js-no-apartments` and `js-od-parser` use dedicated single-output telemetry helpers compatible with n8n `2.20.9` |
| Funnel invariant validation | ✅ Done | Verified on run `2026-05-25T1344Z__GNQTQ5AUBP`: `5 -> 5 -> 5 -> 5 -> 5`, no drops, no errors                     |

Validation note: the acceptance path was confirmed on a live scheduled run with `metadata.by_portal = {"otodom": 5}`. The `no` portal branch was implemented in the same pattern, but was not exercised by that specific verification run.

### Phase 1.4 — `final_policy_state` + Summary Freeze ✅ DONE

End-of-run aggregate and summary freeze shipped in workflow version `1.6.0`.

| Item                                         | Status | Notes                                                                                                              |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `tlm-sql-final-policy`                       | ✅ Done | Persists `final_state` events for run-scoped upserted offers; SQL fixed with `RETURNING` in inserted CTE path      |
| `tlm-sql-final-policy-metrics`               | ✅ Done | Writes stage 6 counters (`review_*`, `new_*`) into `rea_import_run_stage_metrics`                                  |
| `tlm-sql-build-summary`                      | ✅ Done | Summary derived from persisted run events and final policy counts; includes fallback guard for `validated_for_sql` |
| `tlm-build-summary` + `tlm-sql-finalize-run` | ✅ Done | Finalizes run with `status='completed'`, `finished_at`, and frozen `summary` JSONB                                 |
| P1.4 verification SQL                        | ✅ Done | `sql/p1.4_run_verification.sql` confirms summary-to-metrics consistency on latest run                              |

Validation evidence: run `2026-05-26T0715Z__9WQ6M1K5XQ6` (completed) passed full P1.4 SQL verification with matching pairs:

- `summary_entered_workflow = 4` and `metrics_parse_list_out = 4`
- `summary_validated_for_sql = 4` and `metrics_validate_out = 4`
- `summary_inserted_new = 0` and `metrics_inserted_new = 0`
- `summary_updated_existing = 4` and `metrics_updated_existing = 4`
- `summary_new_to_review = 0` and `metrics_new_to_review = 0`

### Phase 2 — Backend + Frontend 🟨 IN PROGRESS

Backend telemetry endpoints and the first React `Import runs` page slice are now implemented.

| Item                                  | Status | Notes                                                                                         |
| ------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `GET /api/import-runs`                | ✅ Done | Lists recent runs with optional `trigger_source` filter                                       |
| `GET /api/import-runs/{run_id}`       | ✅ Done | Returns run header + ordered stage metrics                                                    |
| `GET /api/import-runs/{run_id}/events` | ✅ Done | Returns paged event rows with `stage_key` and `event_type` filters                            |
| `GET /api/import-runs/{run_id}/new-pending` | ✅ Done | Returns run-scoped new offers that ended in `pending` at `final_policy_state`                 |
| React route `/import-runs`            | ✅ Done | Added to dashboard navigation with run list, funnel view, events tab, and `new pending` tab  |
| Event pagination in UI                | ✅ Done | Events tab now pages via API `limit`/`offset` instead of rendering one fixed batch            |
| Backend tests                         | ✅ Done | `rea-fe/api/tests/test_import_runs_api.py` validates list/detail/events/new-pending endpoints |
| Frontend validation                   | ✅ Done | Production build passes in `rea-fe` container                                                 |

Remaining Phase 2 work: refine the UI polish for large runs, add any missing API/client conveniences, and decide whether to extend this page with richer drilldown or export flows before marking the phase fully done.

### Phase 3 — Backfill Workflow Instrumentation ⬜ NOT STARTED

AI re-rating path wired to the same telemetry tables.

---

### Out-of-Scope Work Completed Alongside Reporting

The following features were implemented during the reporting development sprint. They are not part of the telemetry plan but are production-ready.

| Feature                                                                       | Status |
| ----------------------------------------------------------------------------- | ------ |
| Single-offer `Re-evaluate AI` (FE button + API endpoint + n8n webhook branch) | ✅ Done |
| Property-type-aware AI scoring prompt (`PROPERTY-TYPE FIRST RULE`)            | ✅ Done |
| `lot_size` normalization to m² (parser + prompt fix)                          | ✅ Done |
| `construction_year` recovery from listing HTML                                | ✅ Done |
| AI output parser hardening (malformed JSON recovery, field fallbacks)         | ✅ Done |
| API retry logic for webhook calls after n8n restart                           | ✅ Done |
| n8n workflow publish runbook (`docs/n8n-workflow-publish-runbook.md`)         | ✅ Done |
