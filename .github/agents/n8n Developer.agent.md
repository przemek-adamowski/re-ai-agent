# n8n Skills -- RE-AI-AGENT

> Project: Real Estate AI Agent
> GitHub: przemek.adamowski@gmail.com
> Stack: n8n - PostgreSQL - FastAPI - React/MUI
> Purpose: Scrape Polish real estate listings, rate with AI, review in dashboard.

---

## 1. Project Architecture

The n8n workflow pipeline:

    Schedule Trigger
    -> HTTP Request       -- fetch listing page HTML
    -> Code (JavaScript)  -- parse HTML, extract offer list
    -> HTTP Request       -- fetch each offer detail page
    -> Code (JavaScript)  -- merge offer metadata + raw HTML
    -> AI Agent           -- analyse, produce ai_rating (1-10)
    -> PostgreSQL         -- upsert into rea_property_offers

Frontend (React + MUI) reads via FastAPI -> PostgreSQL.
Users rate each offer: like / dislike / pending.

| Portal | ID Prefix | Parser |
|---|---|---|
| Otodom | OT- | n8n/parsers/oto-parser.js |
| Nieruchomosci Online | NO- | n8n/parsers/no-parser.js |

---

## 2. n8n Code Node -- Core Rules

### Reading input

Always start with:

    const items = $input.all();
    const html = items[0].json.data || "";

    // Binary mode (HTTP node set to File):
    // html = Buffer.from(item.binary.data.data, "base64").toString("utf-8");

### Returning output

Always return an array with a json key:

    // Single item:
    return [{ json: { field: value } }];

    // Multiple items:
    return ads.map(ad => ({ json: mappedFields }));

    // No results -- stops branch silently (no error):
    return [];

### Error handling

    try {
        // parsing logic
    } catch (e) {
        return [{ json: { error: "Parsing error: " + e.message } }];
    }

---

## 3. Skill: Otodom List Page Parser

File: n8n/parsers/oto-parser.js

Otodom is a Next.js app. All offer data is embedded as JSON in a script tag.
Path: props -> pageProps -> data -> searchAds -> items
Fallback: props -> pageProps -> apolloState -> data -> searchAds -> items

### Step 1 -- Extract the JSON block

    const html = items[0].json.data || "";

    // Variant A -- with type="application/json" (older Otodom builds):
    const jsonMatch = html.match(
      /<script[^>]*type="application\/json"[^>]*>([\s\S]*?pageProps[\s\S]*?)<\/script>/
    );

    // Variant B -- any script tag with pageProps (current builds):
    // const jsonMatch = html.match(/<script[^>]*>([\s\S]*?pageProps[\s\S]*?)<\/script>/);

    if (!jsonMatch) return [{ json: { error: "pageProps block not found" } }];

### Step 2 -- Parse and navigate the JSON

    const fullData = JSON.parse(jsonMatch[1].trim());

    const ads =
        fullData?.props?.pageProps?.data?.searchAds?.items ||
        fullData?.props?.pageProps?.apolloState?.data?.searchAds?.items || [];

    if (ads.length === 0) return [];

### Step 3 -- Map to DB schema

    return ads.map(ad => ({
        json: {
            external_id:     "OT-" + ad.id,
            url:             "https://www.otodom.pl/pl/oferta/" + ad.slug,
            title:           ad.title,
            price:           ad.totalPrice?.value || 0,
            price_per_m2:    ad.pricePerSquareMeter?.value || 0,
            area:            ad.areaInSquareMeters || 0,
            rooms:           ad.roomsNumber || 0,
            district:        ad.location?.address?.district?.name || "Krakow",
            category:        "mieszkanie-krakow",
            property_portal: "Otodom",
            created_at:      new Date().toISOString(),
        }
    }));

### External ID -- MD5 hash (recommended for production)

    const crypto = require("crypto");
    const url = "https://www.otodom.pl/pl/oferta/" + ad.slug;
    const external_id = crypto.createHash("md5").update(url).digest("hex");

MD5 of URL keeps the same ID even if portal numeric IDs change.
Reference: n8n/parsers/js/otodom-list.js

---

## 4. Skill: Nieruchomosci Online List Page Parser

File: n8n/parsers/no-parser.js

NO does not embed structured JSON.
Offer links are extracted by regex. IDs are 7-10 digit numbers in href attributes.

### Step 1 -- Handle variable input formats

    let html = "";
    if (item.binary?.data?.data) {
        html = Buffer.from(item.binary.data.data, "base64").toString("utf-8");
    } else if (typeof item.json === "string") {
        html = item.json;
    } else if (item.json?.data) {
        html = item.json.data;
    } else {
        html = JSON.stringify(item.json);
    }

### Step 2 -- Extract offer links via regex

    const results = [];
    const regex = /href="([^"]+\/(\d{7,10})\.html)"/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
        const rawUrl = match[1];
        const id     = match[2];
        const fullUrl = rawUrl.startsWith("http")
            ? rawUrl
            : "https://www.nieruchomosci-online.pl" + rawUrl;

        results.push({
            external_id:       "NO-" + id,
            url:               fullUrl + "?i",  // ?i forces detail view
            category:          "mieszkanie-krakow",
            title:             "Oferta NO: " + id,
            price: 0, price_per_m2: 0, area: 0,
            lot_size: 0, construction_year: 0,
            created_at:        new Date().toISOString(),
            property_portal:   "Nieruchomosci online",
        });
    }

### Step 3 -- Deduplicate within a single run

    const uniqueMap = new Map();
    results.forEach(r => uniqueMap.set(r.external_id, r));
    return Array.from(uniqueMap.values()).map(json => ({ json }));

---

## 5. Skill: Merge Offer Metadata with Detail Page HTML

Runs after the second HTTP Request (individual offer page fetch).
Attaches the full raw HTML so the AI Agent has the complete description.

    const items = $input.all();

    return items.map(item => ({
        json: {
            ...item.json,              // carry all existing fields
            raw_html: item.json.data,  // detail page HTML for AI
        }
    }));

Reference samples:
  n8n/parsers/js/Code in JavaScript - merge offer with desc - INPUT.json
  n8n/parsers/js/Code in JavaScript - merge offer with desc - OUTPUT.json

---

## 6. Database Schema -- rea_property_offers

| Column | Type | Notes |
|---|---|---|
| external_id | TEXT PK | OT-id, NO-id, or MD5 hash |
| category | TEXT | e.g. mieszkanie-krakow |
| url | TEXT | |
| title | TEXT | |
| price | NUMERIC | PLN |
| price_per_m2 | NUMERIC | PLN/m2 |
| area | NUMERIC | m2 |
| lot_size | NUMERIC | |
| construction_year | INTEGER | |
| rooms | TEXT | May be N/A for Otodom |
| district | TEXT | |
| ai_rating | INTEGER | 0=not rated, 1-10=AI score |
| user_rating | TEXT | pending / like / dislike |
| user_notes | TEXT | |
| property_portal | TEXT | Otodom / Nieruchomosci online |
| created_at | TIMESTAMPTZ | |
| last_seen_at | TIMESTAMPTZ | |
| sent_at | TIMESTAMPTZ | |

### Upsert -- prevent duplicates across workflow runs

    INSERT INTO rea_property_offers
        (external_id, url, title, price, price_per_m2, area, category, property_portal, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (external_id) DO NOTHING;

To refresh price on re-scrape:

    ON CONFLICT (external_id) DO UPDATE
        SET last_seen_at = EXCLUDED.created_at,
            price        = EXCLUDED.price;

---

## 7. HTTP Request Node -- Configuration

| Setting | Value |
|---|---|
| Method | GET |
| Response Format | String (HTML in item.json.data) |
| Timeout | 30 000 ms |
| User-Agent header | Mozilla/5.0 (Windows NT 10.0; Win64; x64) |

If portal returns binary, set Format to File and decode:
  html = Buffer.from(item.binary.data.data, "base64").toString("utf-8")

### Pagination

Use an expression in the URL for paginated lists:
  https://www.otodom.pl/.../wyniki?page={{ $json.page }}

### Rate limiting

Add a Wait node (1-3 seconds) between detail page fetches to avoid IP bans.

---

## 8. AI Agent Integration

The AI Agent receives the merged offer (including raw_html) and must return:
- ai_rating: integer 1-10
- summary: 2-3 sentence evaluation

### Recommended system prompt

    You are a real estate analyst helping evaluate apartments in Krakow, Poland.
    Score from 1 (very bad) to 10 (excellent).
    Consider: price vs market average, area, location, condition, red flags.

    Return ONLY valid JSON:
    { "ai_rating": <1-10>, "summary": "<2-3 sentence evaluation>" }

### Extracting the result after the AI node

    const items = $input.all();
    return items.map(item => ({
        json: {
            ...item.json,
            ai_rating: parseInt(item.json.output?.ai_rating) || 0,
        }
    }));

---

## 9. FastAPI Backend -- Endpoints

Base URL: http://localhost:3001 (dev), set via REACT_APP_API_URL.

| Method | Endpoint | Description |
|---|---|---|
| GET | /api/offers | List with filters, sort, pagination |
| GET | /api/offers/{external_id} | Single offer detail |
| PATCH | /api/offers/{external_id} | Update user_rating / user_notes |
| GET | /api/stats | Aggregated stats for Summary page |
| GET | /api/categories | Distinct list of categories |

Allowed sort_by: created_at, price, price_per_m2, area, ai_rating, title
PATCH body: { "user_rating": "like" | "dislike" | "pending", "user_notes": "..." }

---

## 10. Debugging in n8n

### Inspect raw HTTP response

Add a No Operation node after HTTP Request.
Open output -- item.json.data contains the full HTML string.

### Offline test samples

| Sample file | Content |
|---|---|
| n8n/parsers/js/otodom-mieszkanie-http_output.json | Otodom listing page response |
| n8n/parsers/js/no-mieszkanie-http_output.html | NO listing page HTML |
| n8n/parsers/js/HTTP Request - offer details - OUTPUT.json | NO detail page response |

### Common problems

| Symptom | Likely cause | Fix |
|---|---|---|
| pageProps block not found | Otodom changed script tag attributes | Try fallback regex without type attribute |
| Empty ads array | Otodom JSON path changed | Log Object.keys(pageProps) to inspect structure |
| No offers from NO | URL pattern changed | Adjust digit range in regex (currently 7-10) |
| PostgreSQL duplicate key | external_id already in DB | Use ON CONFLICT DO NOTHING |
| item.json.data undefined | HTTP node in File mode | Switch to String mode or decode binary |
| AI returns invalid JSON | Model hallucination | Wrap JSON.parse in try/catch |

---

## 11. File Reference

| File | Purpose |
|---|---|
| n8n/parsers/oto-parser.js | Otodom list parser -- production |
| n8n/parsers/no-parser.js | NO list parser -- production |
| n8n/parsers/js/otodom-list.js | Otodom list parser with MD5 IDs -- final version |
| n8n/parsers/js/otodom-list.old.js | Earlier Otodom parser variant |
| n8n/parsers/js/no-mieszkanie-http_output.html | Saved NO HTML for offline testing |
| n8n/parsers/js/otodom-mieszkanie-http_output.json | Saved Otodom response for testing |
| n8n/parsers/js/HTTP Request - offer details - OUTPUT.json | Example NO detail page response |
| n8n/parsers/js/Code in JavaScript - merge offer with desc - INPUT.json | Merge node sample input |
| n8n/parsers/js/Code in JavaScript - merge offer with desc - OUTPUT.json | Merge node sample output |
| rea-fe/api/main.py | FastAPI backend -- all endpoints |
| rea-fe/frontend/src/api.js | Frontend API client |
