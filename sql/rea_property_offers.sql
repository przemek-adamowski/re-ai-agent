CREATE TABLE IF NOT EXISTS rea_property_offers (
    external_id TEXT PRIMARY KEY,
    category TEXT,
    url TEXT NOT NULL,
    title TEXT,
    price NUMERIC,
    price_per_m2 NUMERIC,
    area NUMERIC,
    lot_size NUMERIC,
    construction_year INTEGER,
    ai_rating INTEGER,
    ai_analysis_html TEXT,
    user_rating TEXT DEFAULT 'pending',
    user_grade SMALLINT,
    user_notes TEXT,
    user_rated_at TIMESTAMP,
    property_portal TEXT,
    district TEXT,
    location_text TEXT,
    geo_status TEXT DEFAULT 'unknown',
    geo_confidence TEXT DEFAULT 'low',
    geo_reason TEXT,
    policy_version TEXT DEFAULT 'south-krakow-v1',
    is_soft_blocked BOOLEAN DEFAULT FALSE,
    is_in_trash BOOLEAN DEFAULT FALSE,
    needs_manual_review BOOLEAN DEFAULT FALSE,
    is_exception_candidate BOOLEAN DEFAULT FALSE,
    review_status TEXT DEFAULT 'not_needed',
    review_reason TEXT,
    reviewed_by TEXT,
    reviewed_at TIMESTAMP,
    pre_trash_review_status TEXT,
    excluded_from_feedback_loop BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP
);

ALTER TABLE rea_property_offers
    ADD COLUMN IF NOT EXISTS user_grade SMALLINT,
    ADD COLUMN IF NOT EXISTS user_rated_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS property_portal TEXT,
    ADD COLUMN IF NOT EXISTS district TEXT,
    ADD COLUMN IF NOT EXISTS location_text TEXT,
    ADD COLUMN IF NOT EXISTS geo_status TEXT DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS geo_confidence TEXT DEFAULT 'low',
    ADD COLUMN IF NOT EXISTS geo_reason TEXT,
    ADD COLUMN IF NOT EXISTS policy_version TEXT DEFAULT 'south-krakow-v1',
    ADD COLUMN IF NOT EXISTS is_soft_blocked BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_in_trash BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS needs_manual_review BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_exception_candidate BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'not_needed',
    ADD COLUMN IF NOT EXISTS review_reason TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
    ADD COLUMN IF NOT EXISTS pre_trash_review_status TEXT,
    ADD COLUMN IF NOT EXISTS excluded_from_feedback_loop BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS rea_offer_audit_log (
    id BIGSERIAL PRIMARY KEY,
    external_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL DEFAULT 'system',
    reason TEXT,
    old_values JSONB,
    new_values JSONB,
    policy_version TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_property_created_at ON rea_property_offers(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_user_grade ON rea_property_offers(user_grade);
CREATE INDEX IF NOT EXISTS idx_property_user_rated_at ON rea_property_offers(user_rated_at DESC);
CREATE INDEX IF NOT EXISTS idx_property_geo_status ON rea_property_offers(geo_status);
CREATE INDEX IF NOT EXISTS idx_property_soft_blocked ON rea_property_offers(is_soft_blocked);
CREATE INDEX IF NOT EXISTS idx_property_in_trash ON rea_property_offers(is_in_trash);
CREATE INDEX IF NOT EXISTS idx_property_manual_review ON rea_property_offers(needs_manual_review);
CREATE INDEX IF NOT EXISTS idx_property_feedback_exclusion ON rea_property_offers(excluded_from_feedback_loop);
CREATE INDEX IF NOT EXISTS idx_offer_audit_external_id ON rea_offer_audit_log(external_id, created_at DESC);

ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_user_grade;
ALTER TABLE rea_property_offers ADD CONSTRAINT chk_user_grade CHECK (user_grade IS NULL OR user_grade BETWEEN 1 AND 5);
ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_geo_status;
ALTER TABLE rea_property_offers ADD CONSTRAINT chk_geo_status CHECK (geo_status IS NULL OR geo_status IN ('in_region', 'out_of_region', 'unknown'));
ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_geo_confidence;
ALTER TABLE rea_property_offers ADD CONSTRAINT chk_geo_confidence CHECK (geo_confidence IS NULL OR geo_confidence IN ('high', 'medium', 'low'));
ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_review_status;
ALTER TABLE rea_property_offers ADD CONSTRAINT chk_review_status CHECK (review_status IS NULL OR review_status IN ('not_needed', 'pending', 'approved', 'blocked', 'trashed'));

CREATE OR REPLACE FUNCTION rea_apply_offer_policy() RETURNS TRIGGER AS $$
DECLARE
    normalized_haystack TEXT;
    normalized_district TEXT;
    matched_district TEXT := NULL;
    matched_is_south BOOLEAN := FALSE;
BEGIN
    NEW.district := NULLIF(BTRIM(COALESCE(NEW.district, '')), '');
    NEW.location_text := NULLIF(BTRIM(COALESCE(NEW.location_text, '')), '');
    normalized_haystack := translate(
        lower(
            regexp_replace(
                concat_ws(' ', COALESCE(NEW.district, ''), COALESCE(NEW.location_text, ''), COALESCE(NEW.title, ''), regexp_replace(COALESCE(NEW.ai_analysis_html, ''), '<[^>]+>', ' ', 'g')),
                '\s+',
                ' ',
                'g'
            )
        ),
        'ąćęłńóśżźĄĆĘŁŃÓŚŻŹ',
        'acelnoszzACELNOSZZ'
    );
    normalized_district := translate(lower(COALESCE(NEW.district, '')), 'ąćęłńóśżźĄĆĘŁŃÓŚŻŹ', 'acelnoszzACELNOSZZ');

    IF position('podgorze duchackie' in normalized_haystack) > 0 THEN
        matched_district := 'XI Podgórze Duchackie';
        matched_is_south := TRUE;
    ELSIF position('lagiewniki borek falecki' in normalized_haystack) > 0 OR position('lagiewniki-borek falecki' in normalized_haystack) > 0 THEN
        matched_district := 'IX Łagiewniki-Borek Fałęcki';
        matched_is_south := TRUE;
    ELSIF position('biezanow prokocim' in normalized_haystack) > 0 OR position('biezanow-prokocim' in normalized_haystack) > 0 THEN
        matched_district := 'XII Bieżanów-Prokocim';
        matched_is_south := TRUE;
    ELSIF position('debniki' in normalized_haystack) > 0 THEN
        matched_district := 'VIII Dębniki';
        matched_is_south := TRUE;
    ELSIF position('swoszowice' in normalized_haystack) > 0 THEN
        matched_district := 'X Swoszowice';
        matched_is_south := TRUE;
    ELSIF position('xiii podgorze' in normalized_haystack) > 0 OR position('district xiii podgorze' in normalized_haystack) > 0 OR position('dzielnica xiii podgorze' in normalized_haystack) > 0 OR position('podgorze' in normalized_haystack) > 0 THEN
        matched_district := 'XIII Podgórze';
        matched_is_south := TRUE;
    ELSIF position('stare miasto' in normalized_haystack) > 0 THEN
        matched_district := 'I Stare Miasto';
    ELSIF position('grzegorzki' in normalized_haystack) > 0 THEN
        matched_district := 'II Grzegórzki';
    ELSIF position('pradnik czerwony' in normalized_haystack) > 0 THEN
        matched_district := 'III Prądnik Czerwony';
    ELSIF position('pradnik bialy' in normalized_haystack) > 0 THEN
        matched_district := 'IV Prądnik Biały';
    ELSIF position('krowodrza' in normalized_haystack) > 0 THEN
        matched_district := 'V Krowodrza';
    ELSIF position('bronowice' in normalized_haystack) > 0 THEN
        matched_district := 'VI Bronowice';
    ELSIF position('zwierzyniec' in normalized_haystack) > 0 THEN
        matched_district := 'VII Zwierzyniec';
    ELSIF position('czyzyny' in normalized_haystack) > 0 THEN
        matched_district := 'XIV Czyżyny';
    ELSIF position('mistrzejowice' in normalized_haystack) > 0 THEN
        matched_district := 'XV Mistrzejowice';
    ELSIF position('bienczyce' in normalized_haystack) > 0 THEN
        matched_district := 'XVI Bieńczyce';
    ELSIF position('wzgorza krzeslawickie' in normalized_haystack) > 0 THEN
        matched_district := 'XVII Wzgórza Krzesławickie';
    ELSIF position('nowa huta' in normalized_haystack) > 0 THEN
        matched_district := 'XVIII Nowa Huta';
    END IF;

    IF matched_district IS NOT NULL THEN
        NEW.district := matched_district;
    END IF;

    IF matched_district IS NOT NULL THEN
        IF matched_is_south THEN
            NEW.geo_status := 'in_region';
            NEW.geo_reason := 'Matched south Krakow district: ' || matched_district;
        ELSE
            NEW.geo_status := 'out_of_region';
            NEW.geo_reason := 'Matched district outside the south Krakow allowlist: ' || matched_district;
        END IF;

        IF normalized_district <> '' THEN
            NEW.geo_confidence := 'high';
        ELSE
            NEW.geo_confidence := 'medium';
        END IF;
    ELSIF position('krakow' in normalized_haystack) > 0 THEN
        NEW.geo_status := 'unknown';
        NEW.geo_confidence := 'low';
        NEW.geo_reason := 'Krakow detected but district is missing or unsupported.';
    ELSE
        NEW.geo_status := 'unknown';
        NEW.geo_confidence := 'low';
        NEW.geo_reason := 'No supported location signal found.';
    END IF;

    NEW.is_exception_candidate := COALESCE(NEW.area, 0) > 120 OR (COALESCE(NEW.price_per_m2, 0) > 0 AND COALESCE(NEW.price_per_m2, 0) < 11000);
    NEW.policy_version := 'south-krakow-v1';

    IF COALESCE(NEW.is_in_trash, FALSE) OR NEW.review_status = 'trashed' THEN
        NEW.is_in_trash := TRUE;
        NEW.review_status := 'trashed';
        NEW.is_soft_blocked := FALSE;
        NEW.needs_manual_review := FALSE;
        NEW.excluded_from_feedback_loop := TRUE;
    ELSIF NEW.review_status = 'approved' THEN
        NEW.is_in_trash := FALSE;
        NEW.is_soft_blocked := FALSE;
        NEW.needs_manual_review := FALSE;
        NEW.excluded_from_feedback_loop := FALSE;
    ELSIF NEW.review_status = 'blocked' THEN
        NEW.is_in_trash := FALSE;
        NEW.is_soft_blocked := TRUE;
        NEW.needs_manual_review := FALSE;
        NEW.excluded_from_feedback_loop := TRUE;
    ELSIF NEW.geo_status = 'in_region' THEN
        NEW.is_in_trash := FALSE;
        NEW.review_status := 'not_needed';
        NEW.is_soft_blocked := FALSE;
        NEW.needs_manual_review := FALSE;
        NEW.excluded_from_feedback_loop := FALSE;
    ELSIF NEW.geo_status = 'out_of_region' AND NOT COALESCE(NEW.is_exception_candidate, FALSE) THEN
        NEW.is_in_trash := FALSE;
        NEW.review_status := 'blocked';
        NEW.is_soft_blocked := TRUE;
        NEW.needs_manual_review := FALSE;
        NEW.excluded_from_feedback_loop := TRUE;
    ELSE
        NEW.is_in_trash := FALSE;
        NEW.review_status := 'pending';
        NEW.is_soft_blocked := TRUE;
        NEW.needs_manual_review := TRUE;
        NEW.excluded_from_feedback_loop := TRUE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rea_apply_offer_policy ON rea_property_offers;
CREATE TRIGGER trg_rea_apply_offer_policy
BEFORE INSERT OR UPDATE ON rea_property_offers
FOR EACH ROW
EXECUTE FUNCTION rea_apply_offer_policy();

CREATE OR REPLACE FUNCTION rea_log_offer_audit() RETURNS TRIGGER AS $$
DECLARE
    audit_event TEXT;
    audit_actor TEXT;
    audit_reason TEXT;
BEGIN
    audit_actor := COALESCE(NULLIF(NEW.reviewed_by, ''), 'system');
    audit_reason := NULLIF(NEW.review_reason, '');

    IF TG_OP = 'INSERT' THEN
        INSERT INTO rea_offer_audit_log (external_id, event_type, actor, reason, old_values, new_values, policy_version)
        VALUES (NEW.external_id, 'created', audit_actor, audit_reason, NULL, to_jsonb(NEW), NEW.policy_version);
        RETURN NEW;
    END IF;

    IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
        IF COALESCE(OLD.is_in_trash, FALSE) = FALSE AND COALESCE(NEW.is_in_trash, FALSE) = TRUE THEN
            audit_event := 'trashed';
        ELSIF COALESCE(OLD.is_in_trash, FALSE) = TRUE AND COALESCE(NEW.is_in_trash, FALSE) = FALSE THEN
            audit_event := 'restored';
        ELSIF OLD.review_status IS DISTINCT FROM NEW.review_status THEN
            audit_event := 'reviewer_decision';
        ELSIF OLD.geo_status IS DISTINCT FROM NEW.geo_status
            OR OLD.geo_confidence IS DISTINCT FROM NEW.geo_confidence
            OR COALESCE(OLD.is_soft_blocked, FALSE) IS DISTINCT FROM COALESCE(NEW.is_soft_blocked, FALSE)
            OR COALESCE(OLD.needs_manual_review, FALSE) IS DISTINCT FROM COALESCE(NEW.needs_manual_review, FALSE)
            OR COALESCE(OLD.is_exception_candidate, FALSE) IS DISTINCT FROM COALESCE(NEW.is_exception_candidate, FALSE) THEN
            audit_event := 'policy_applied';
        ELSE
            audit_event := 'updated';
        END IF;

        INSERT INTO rea_offer_audit_log (external_id, event_type, actor, reason, old_values, new_values, policy_version)
        VALUES (NEW.external_id, audit_event, audit_actor, audit_reason, to_jsonb(OLD), to_jsonb(NEW), NEW.policy_version);
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rea_log_offer_audit ON rea_property_offers;
CREATE TRIGGER trg_rea_log_offer_audit
AFTER INSERT OR UPDATE ON rea_property_offers
FOR EACH ROW
EXECUTE FUNCTION rea_log_offer_audit();

UPDATE rea_property_offers
SET user_grade = CASE
    WHEN user_rating IN ('like', '👍 I like it') THEN 4
    WHEN user_rating IN ('dislike', '👎 I don''t like it') THEN 2
    ELSE user_grade
END
WHERE user_grade IS NULL AND user_rating IN ('like', '👍 I like it', 'dislike', '👎 I don''t like it');

UPDATE rea_property_offers
SET user_rated_at = COALESCE(user_rated_at, CURRENT_TIMESTAMP)
WHERE user_grade IS NOT NULL AND user_rated_at IS NULL;

UPDATE rea_property_offers
SET review_status = review_status
WHERE policy_version IS DISTINCT FROM 'south-krakow-v1'
    OR geo_status IS NULL
    OR geo_confidence IS NULL
    OR geo_reason IS NULL
    OR review_status IS NULL
    OR is_soft_blocked IS NULL
    OR is_in_trash IS NULL
    OR needs_manual_review IS NULL
    OR excluded_from_feedback_loop IS NULL
    OR (
          COALESCE(geo_status, 'unknown') = 'unknown'
          AND COALESCE(review_status, 'not_needed') = 'not_needed'
          AND COALESCE(is_soft_blocked, FALSE) = FALSE
          AND COALESCE(needs_manual_review, FALSE) = FALSE
        );