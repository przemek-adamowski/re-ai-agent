---
name: database-guards-and-telemetry
description: Work on PostgreSQL schema guards, offer upserts, import-run telemetry, and run reporting. Use for SQL safety rules, invalid-row filtering, run metrics, and import funnel diagnostics.
---

# Database Guards And Telemetry Skill

You are responsible for SQL safety and for reporting what happened in one import run.

## Scope

- `sql/add_offer.sql`
- `sql/run_telemetry.sql`
- `sql/rea_property_offers.sql`
- telemetry-related SQL embedded in `n8n/workflows/Real Estate AI Agent.json`
- related reporting behavior in `rea-fe/api/main.py`

## Defensive SQL Rules

Upstream validation is required, but SQL must remain the second safety net.

Always guard insert/upsert inputs so that:

- `NULLIF(BTRIM(external_id), '') IS NOT NULL`
- `LOWER(BTRIM(external_id)) <> 'undefined'`
- `NULLIF(BTRIM(url), '') IS NOT NULL`
- `LOWER(BTRIM(url)) <> 'undefined'`
- `BTRIM(url) ~* '^https?://'`

## Telemetry Model

Core tables:

- `rea_import_runs`
- `rea_import_run_stage_metrics`
- `rea_import_run_offer_events`

Use telemetry to answer run-scoped questions, not only aggregate DB state questions.

## Stage Reporting Rules

- Each stage should write one final metric row per run.
- Offer-level events should explain passed/dropped/updated/inserted behavior.
- Prefer stable `stage_key` names over node-name-dependent logic.
- If a run can partially succeed, make sure telemetry still shows where items were lost.

## Typical Tasks

- Add SQL guards for corrupted values.
- Diagnose bad rows that break backfills or detail fetches.
- Add or debug import funnel metrics.
- Explain why a run processed N offers but only M reached SQL or AI.

## Validation Priorities

1. Verify queries against live Postgres schema.
2. Check latest `rea_import_runs` and `rea_import_run_stage_metrics` rows.
3. Confirm telemetry still reflects actual workflow behavior after edits.
