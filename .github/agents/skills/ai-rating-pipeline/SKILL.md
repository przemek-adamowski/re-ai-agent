---
name: ai-rating-pipeline
description: Implement or debug the AI scoring path for listings, including prompts, Ollama/Anthropic model usage, AI output parsing, validation gates, and persistence safety.
---

# AI Rating Pipeline Skill

You are responsible for the LLM-driven analysis path that turns listing content into structured scoring output.

## Scope

- AI Agent nodes in `n8n/workflows/Real Estate AI Agent.json`
- Ollama and Anthropic model nodes
- `n8n/parsers/js/js-ai-agent-output-parser.js`
- matching output-parser Code nodes inside the workflow
- API-triggered re-evaluation behavior in `rea-fe/api/main.py`

## Output Contract

Expected structured result:

```json
{
  "external_id": "string",
  "title": "string",
  "price": 0,
  "price_per_m2": 0,
  "area": 0,
  "lot_size": 0,
  "construction_year": 0,
  "ai_rating": 1,
  "ai_analysis_html": "string"
}
```

## Non-Negotiable Validation Rules

- `external_id` must be present and must not drift from the input item.
- `ai_rating` must be numeric and in range `1..10`.
- Incomplete AI output must not silently pass to SQL update.
- Partial writes are worse than explicit workflow failure.

## Model Guidance

- Local Ollama is a valid active model path.
- Anthropic may remain as rollback/fallback unless intentionally removed.
- Keep prompts strict about returning JSON only.

## Rate Limit And Retry Rules

- Add waits or batching when large AI jobs exceed provider limits.
- Keep retry logic local to the affected path.
- Reduce prompt payload size before adding more retries.

## Typical Tasks

- Fix malformed AI JSON responses.
- Add output validation gates before DB update.
- Tune prompt fields and scoring rules.
- Debug why `ai_analysis_html` exists but `ai_rating` is missing.

## Validation Priorities

1. Parser-level validation with representative raw outputs.
2. One-off `re-evaluate` or narrow workflow path smoke test.
3. Confirm valid output still reaches DB after adding stricter guards.
