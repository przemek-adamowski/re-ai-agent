# Plan wdrozenia: lokalny Mistral przez Ollama

Cel: zastapienie oceniania ofert przez Anthropic lokalnym modelem Mistral serwowanym przez Ollama, z bezpiecznym rolloutem i mozliwoscia szybkiego rollbacku.

Instrukcja aktualizacji postepu:
- Zostawiamy status jako `[ ]` dla zadan niewykonanych.
- Po wykonaniu zmieniasz recznie `[ ]` na `[x]`.

## Etap 1. Przygotowanie i decyzje architektoniczne

### 1. Strategia przelaczenia providerow

- [x] Ustalic tryb przejscia: feature flaga (provider switch), bez twardego cut-over.
- [x] Ustawic provider domyslny: `ollama`.
- [x] Zostawic fallback: `anthropic` na czas stabilizacji.
- [x] Potwierdzic scope: oba branche AI w workflow (batch + single offer re-evaluate).

### 2. Infrastruktura lokalna (Ollama)

- [x] Dodac/uszczegolowic konfiguracje Ollama w `docker-compose.yml` albo potwierdzic hostowa instancje.
- [x] Zapewnic lacznosc `n8n` -> `ollama` (port `11434`).
- [x] Pobierac model `mistral` (lub wybrany wariant) i potwierdzic gotowosc endpointu.
- [x] Dodac prosty health-check komenda testowa do runbooka operacyjnego.

## Etap 2. Integracja z workflow n8n

### 3. Zmiany w n8n workflow

- [x] Dodac node modelu Ollama Chat Model w `n8n/workflows/Real Estate AI Agent.json`.
- [x] Podpiac Ollama do `AI Agent` (glowny pipeline).
- [x] Podpiac Ollama do `AI Agent - Single Offer Re-evaluate`.
- [x] Odlaczyc `Anthropic Chat Model` od aktywnych agentow (bez usuwania, jako rollback path).
- [x] Zweryfikowac, ze nie zmieniono innych backupowych workflow JSON.

### 4. Prompt i format wyjscia (JSON)

- [ ] Utrzymac strict JSON output requirement w promptach obu agentow.
- [ ] Doregulowac prompt pod lokalny model (bez markdown, bez komentarzy, tylko JSON).
- [ ] Sprawdzic zgodnosc pol: `external_id`, `title`, `price`, `price_per_m2`, `area`, `lot_size`, `construction_year`, `ai_rating`, `ai_analysis_html`.
- [ ] Potwierdzic dzialanie parsera `n8n/parsers/js/js-ai-agent-output-parser.js` dla odpowiedzi Ollama.

### 5. Stabilnosc, limity i retry

- [ ] Zachowac retry (`retryOnFail`) i `waitBetweenTries` w obu AI Agent node.
- [ ] Dodac/utrzymac ograniczenie dlugosci `ai_input_md` (np. 8k-15k znakow) przed AI.
- [ ] Dostosowac timeouty do inferencji lokalnej (CPU/GPU).
- [ ] Zweryfikowac, ze parse failures nie psuja zapisu do DB.

## Etap 3. Jakosc danych i obserwowalnosc

### 6. Telemetria i obserwowalnosc

- [ ] Dodac pola telemetryczne: `ai_provider=ollama`, `ai_model=mistral`.
- [ ] Rejestrowac `ai_parse_valid`, czas inferencji i bledy parse.
- [ ] Potwierdzic, ze backend/API nie wymaga zmian kontraktu (czyta wynik z DB jak dotad).

## Etap 4. Walidacja i testy akceptacyjne

### 7. Testy akceptacyjne

- [ ] Smoke test na 10-20 ofertach (brak null/undefined i poprawny `ai_rating` 1-10).
- [ ] E2E: webhook `offer-re-evaluate` zwraca HTTP 200.
- [ ] E2E: rekord w `rea_property_offers` ma uzupelnione `ai_rating` i `ai_analysis_html`.
- [ ] Porownanie jakosci: ten sam zestaw ~30 ofert (Anthropic vs Mistral), ocena odchylen i spojnosci.

## Etap 5. Publikacja, rollout i rollback

### 8. Rollout i rollback

- [ ] Wlaczyc najpierw tylko sciezke `single-offer re-evaluate`.
- [ ] Po stabilizacji wlaczyc pelny harmonogram scrape.
- [ ] Przygotowac rollback: szybki powrot provider switch na `anthropic`.
- [ ] Udokumentowac warunki rollbacku (np. parse_fail > prog, timeout rate > prog).

### 9. Governance i publikacja

- [ ] Podbic wersje workflow semver `minor` (nowa funkcjonalnosc).
- [ ] Uruchomic `node scripts/bump-workflow-version.js X.Y.Z`.
- [ ] Opublikowac workflow zgodnie z runbookiem `docs/n8n-workflow-publish-runbook.md`.
- [ ] Zweryfikowac po publikacji: poprawne markery w DB, zdrowie n8n i webhooki.

### 10. Definition of Done

- [ ] Oba AI branche dzialaja na Ollama/Mistral.
- [ ] Brak regresji w zapisie do `rea_property_offers`.
- [ ] Webhook re-evaluate dziala stabilnie po restarcie n8n.
- [ ] Plan testowy zakonczony i odhaczony.
- [ ] Zaktualizowana dokumentacja operacyjna.
