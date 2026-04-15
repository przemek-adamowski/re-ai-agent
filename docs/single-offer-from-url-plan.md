Implementation Plan: Ad-hoc Property Offer Ingestion
Stack: React (Frontend) → n8n (Orchestration) → PostgreSQL (Storage)

Repository Implementation Status (30 March 2026)

Implemented in this repository:

- FastAPI endpoint `POST /api/import-offer` in [rea-fe/api/main.py](rea-fe/api/main.py)
- frontend dialog for manual single-offer import in [rea-fe/frontend/src/components/ImportOfferDialog.js](rea-fe/frontend/src/components/ImportOfferDialog.js)
- dashboard entrypoint button in [rea-fe/frontend/src/pages/OfferAssessment.js](rea-fe/frontend/src/pages/OfferAssessment.js)
- frontend API client method in [rea-fe/frontend/src/api.js](rea-fe/frontend/src/api.js)
- n8n URL router in [n8n/parsers/manual-url-router.js](n8n/parsers/manual-url-router.js)
- Otodom detail parser in [n8n/parsers/oto-detail-parser.js](n8n/parsers/oto-detail-parser.js)
- Nieruchomosci Online detail parser in [n8n/parsers/no-detail-parser.js](n8n/parsers/no-detail-parser.js)
- environment wiring for `MANUAL_OFFER_WEBHOOK_URL` in [.env.example](.env.example) and [docker-compose.yml](docker-compose.yml)

Current supported portals in code:

- Otodom
- Nieruchomosci Online

Important scope correction:

- the implemented code does not support Facebook, OLX, or arbitrary links
- this is intentional so the new import path follows the same portal-specific flow as the existing Otodom and Nieruchomosci Online offers

Current runtime behavior:

- the React dashboard submits one offer URL to the backend
- the backend validates and normalizes the URL
- the backend forwards it to the configured n8n webhook in `MANUAL_OFFER_WEBHOOK_URL`
- n8n is expected to fetch the detail page, parse the portal-specific metadata, run AI, and upsert into PostgreSQL

Remaining n8n wiring required:

- create a webhook workflow in n8n at path `manual-offer`
- use the parser files already added in this repository
- connect that workflow to your existing AI and PostgreSQL nodes

Recommended n8n node chain now that the repository pieces exist:

1. Webhook: accepts `{ "url": "..." }`
2. Code node using [n8n/parsers/manual-url-router.js](n8n/parsers/manual-url-router.js)
3. HTTP Request: fetch the normalized detail URL
4. Switch by `portal`
5. Code node using [n8n/parsers/oto-detail-parser.js](n8n/parsers/oto-detail-parser.js) or [n8n/parsers/no-detail-parser.js](n8n/parsers/no-detail-parser.js)
6. AI Agent
7. PostgreSQL upsert

Environment value to use locally:

- backend outside Docker: `MANUAL_OFFER_WEBHOOK_URL=http://localhost:5678/webhook/manual-offer`
- backend inside Docker Compose: `MANUAL_OFFER_WEBHOOK_URL=http://n8n:5678/webhook/manual-offer`

1. System Overview
The goal is to allow manual submission of one Otodom or Nieruchomosci Online property URL via the React frontend. The system forwards that URL into n8n so the offer can follow the same detail-fetch, parsing, AI, and PostgreSQL flow as the existing automated portal imports.

2. n8n Workflow Configuration (Backend)
Node 1: Webhook (Entry Point)
HTTP Method: POST

Path: manual-offer

Response Mode: Immediately (Status 200)

Expected JSON Body: { "url": "string" }

Node 2: HTTP Request (Scraper)
Method: GET

URL: {{ $json.body.url }}

Headers: * User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36

Authentication: None (unless required by specific portal)

Node 3: Code Node (ID Generation)
Purpose: Generate a unique external_id based on the URL to prevent duplicates.

Logic:

JavaScript
const crypto = require('crypto');
const url = $json.url; 
$json.generated_id = crypto.createHash('md5').update(url).digest('hex');
return $json;
Node 4: AI Agent / Extraction
Model: GPT-4o or Claude 3.5 Sonnet

Prompt: > "Extract structured data from the provided HTML content.

Required fields: title, price (numeric), size_m2 (numeric), location, description.
If some data is missing, provide a best guess based on the text.
Return ONLY a raw JSON object."

Node 5: PostgreSQL (Upsert)
Operation: Insert (or Update if ID exists)

Table: rea_property_offers

Mapping:

external_id ← {{ $json.generated_id }}

title ← {{ $json.title }}

price ← {{ $json.price }}

source ← 'manual_adhoc'

3. Frontend Implementation (React)
Service Function
TypeScript
const submitOffer = async (targetUrl: string) => {
  const WEBHOOK_URL = 'https://your-n8n-instance.com/webhook/manual-offer';
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl }),
    });
    
    if (!response.ok) throw new Error('Submission failed');
    return await response.json();
  } catch (err) {
    console.error("Workflow Error:", err);
  }
};
Component Requirements (for Copilot)
Input Field: URL validation (regex for http/https).

Loading State: Disable button while request is "Pending".

Feedback: Success/Error toast notifications.

Styling: Tailwind CSS preferred for a clean, modern UI.

4. Database Schema Update (Migration)
Run this SQL command once to ensure your table can handle manual entries:

SQL
ALTER TABLE rea_property_offers 
ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'auto',
ADD COLUMN IF NOT EXISTS user_notes TEXT;
5. Deployment Checklist
[ ] Enable CORS in n8n settings to allow requests from your React domain.

[ ] Set n8n Webhook to Production mode.

[ ] Verify that HTTP Request node handles redirects (common on FB/Linktree).

[ ] Test with an emoji-heavy Facebook post to ensure SQL encoding is correct.