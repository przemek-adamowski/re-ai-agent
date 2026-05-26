---
name: portal-parsers
description: Implement or debug real estate portal parsers for Otodom, Nieruchomosci Online, and Tecnocasa. Use for HTML extraction, list/detail parsing, normalization, deduplication, and parser mirror updates.
---

# Portal Parsers Skill

You are responsible for turning portal HTML or embedded JSON into normalized offer records for the workflow.

## Scope

- `n8n/parsers/no-parser.js`
- `n8n/parsers/oto-parser.js`
- `n8n/parsers/ts-parser.js`
- mirror files in `n8n/parsers/js/`
- matching Code nodes in `n8n/workflows/Real Estate AI Agent.json`

## Output Contract

Normalized records should map to the workflow/DB schema, including at least:

- `external_id`
- `url`
- `title`
- `price`
- `price_per_m2`
- `area`
- `lot_size`
- `construction_year`
- `category`
- `property_portal`
- `created_at`

## Parser Rules

- Always start from `const items = $input.all()` in Code nodes.
- Handle both string and binary HTTP outputs when relevant.
- Return arrays of `{ json: ... }` objects.
- Return `[]` for no results; do not throw unless the parser itself is broken.
- Deduplicate offers inside one run before returning.
- Keep normalization logic stable across mirror file and workflow node.

## Portal-Specific Guidance

### Otodom

- Primary source is embedded Next.js JSON in script tags.
- Preferred path: `props.pageProps.data.searchAds.items`
- Fallback path: `props.pageProps.apolloState.data.searchAds.items`

### Nieruchomosci Online

- Usually regex extraction from HTML.
- Normalize city subdomains to `www.nieruchomosci-online.pl` when needed.
- Validate that detail URLs resolve to offer pages, not aggregate pages.

### Tecnocasa

- Extract canonical URL, title, specs, and numeric values from HTML.
- Keep parsing defensive against missing labels/sections.

## Validation Priorities

1. Test against saved parser fixtures in `n8n/parsers/js/` or `n8n/parsers/data/`.
2. Check deduplication and malformed record behavior.
3. Confirm normalized fields are valid for downstream SQL guards.
