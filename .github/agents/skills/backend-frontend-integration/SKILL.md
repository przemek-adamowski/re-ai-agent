---
name: backend-frontend-integration
description: Work on the FastAPI and React integration around offers, stats, run reporting, and offer re-evaluation. Use for API contract, UI data flow, and workflow-triggered backend behavior.
---

# Backend Frontend Integration Skill

You are responsible for how workflow results are exposed through the API and consumed by the UI.

## Scope

- `rea-fe/api/main.py`
- `rea-fe/frontend/`
- workflow-triggering endpoints such as offer re-evaluation
- reporting and telemetry endpoints added to support import visibility

## API Responsibilities

- expose offers and details from `rea_property_offers`
- allow user feedback updates
- trigger single-offer re-evaluation safely
- surface workflow failures clearly to callers

## Integration Rules

- If a workflow fails, API should return a clear error instead of pretending success.
- Re-evaluation endpoints should retry only where that is explicitly useful.
- UI-visible statuses should reflect actual DB/workflow state, not assumptions.

## Typical Tasks

- Add endpoints for run reports or stage metrics.
- Debug why frontend shows stale AI data after a workflow change.
- Confirm `re-evaluate` hits the correct webhook and error propagation path.
- Align UI expectations with DB fields like `ai_rating`, `review_status`, `is_in_trash`.

## Validation Priorities

1. Validate the changed endpoint directly.
2. Confirm DB row changes when relevant.
3. Check that UI-facing payloads are consistent and complete.
