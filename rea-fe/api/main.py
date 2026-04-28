import asyncio
import os
from typing import Any, Literal, Optional

import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from policy import POLICY_VERSION, restore_review_status

app = FastAPI(title="REA Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class OfferUpdate(BaseModel):
    title: Optional[str] = None
    user_rating: Optional[str] = None
    user_grade: Optional[int] = None
    user_notes: Optional[str] = None


class ReviewAction(BaseModel):
    action: Literal["approve", "keep_blocked", "trash", "restore"]
    actor: str = "frontend"
    reason: str


ALLOWED_SORT = {
    "created_at",
    "price",
    "price_per_m2",
    "area",
    "ai_rating",
    "user_grade",
    "user_rated_at",
    "title",
    "district",
    "reviewed_at",
}

USER_RATING_ALIASES = {
    "like": ("like", "👍 I like it"),
    "dislike": ("dislike", "👎 I don't like it"),
    "pending": ("pending",),
}

LEGACY_RATING_TO_GRADE = {
    "strong_dislike": 1,
    "dislike": 2,
    "👎 I don't like it": 2,
    "neutral": 3,
    "like": 4,
    "👍 I like it": 4,
    "strong_like": 5,
    "pending": None,
}

GRADE_TO_LABEL = {
    1: "strong_dislike",
    2: "dislike",
    3: "neutral",
    4: "like",
    5: "strong_like",
}

SERIALIZED_TIMESTAMPS = (
    "created_at",
    "last_seen_at",
    "sent_at",
    "user_rated_at",
    "reviewed_at",
)

NUMERIC_FIELDS = ("price", "price_per_m2", "area", "lot_size")

OFFERS_SELECT = """
SELECT
    external_id,
    category,
    url,
    title,
    price,
    price_per_m2,
    area,
    lot_size,
    construction_year,
    ai_rating,
    ai_analysis_html,
    user_rating,
    user_grade,
    user_notes,
    user_rated_at,
    property_portal,
    district,
    location_text,
    geo_status,
    geo_confidence,
    geo_reason,
    policy_version,
    is_soft_blocked,
    is_in_trash,
    needs_manual_review,
    is_exception_candidate,
    review_status,
    review_reason,
    reviewed_by,
    reviewed_at,
    pre_trash_review_status,
    excluded_from_feedback_loop,
    created_at,
    last_seen_at,
    sent_at
FROM rea_property_offers
"""

SCHEMA_SQL = [
    f"""
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
        policy_version TEXT DEFAULT '{POLICY_VERSION}',
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
    """,
    f"""
    ALTER TABLE rea_property_offers
        ADD COLUMN IF NOT EXISTS user_grade SMALLINT,
        ADD COLUMN IF NOT EXISTS user_rated_at TIMESTAMP,
        ADD COLUMN IF NOT EXISTS property_portal TEXT,
        ADD COLUMN IF NOT EXISTS district TEXT,
        ADD COLUMN IF NOT EXISTS location_text TEXT,
        ADD COLUMN IF NOT EXISTS geo_status TEXT DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS geo_confidence TEXT DEFAULT 'low',
        ADD COLUMN IF NOT EXISTS geo_reason TEXT,
        ADD COLUMN IF NOT EXISTS policy_version TEXT DEFAULT '{POLICY_VERSION}',
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
    """,
    """
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
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_property_created_at ON rea_property_offers(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_property_user_grade ON rea_property_offers(user_grade);
    CREATE INDEX IF NOT EXISTS idx_property_user_rated_at ON rea_property_offers(user_rated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_property_geo_status ON rea_property_offers(geo_status);
    CREATE INDEX IF NOT EXISTS idx_property_soft_blocked ON rea_property_offers(is_soft_blocked);
    CREATE INDEX IF NOT EXISTS idx_property_in_trash ON rea_property_offers(is_in_trash);
    CREATE INDEX IF NOT EXISTS idx_property_manual_review ON rea_property_offers(needs_manual_review);
    CREATE INDEX IF NOT EXISTS idx_property_feedback_exclusion ON rea_property_offers(excluded_from_feedback_loop);
    CREATE INDEX IF NOT EXISTS idx_offer_audit_external_id ON rea_offer_audit_log(external_id, created_at DESC);
    """,
    """
    ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_user_grade;
    ALTER TABLE rea_property_offers ADD CONSTRAINT chk_user_grade CHECK (user_grade IS NULL OR user_grade BETWEEN 1 AND 5);
    ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_geo_status;
    ALTER TABLE rea_property_offers ADD CONSTRAINT chk_geo_status CHECK (geo_status IS NULL OR geo_status IN ('in_region', 'out_of_region', 'unknown'));
    ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_geo_confidence;
    ALTER TABLE rea_property_offers ADD CONSTRAINT chk_geo_confidence CHECK (geo_confidence IS NULL OR geo_confidence IN ('high', 'medium', 'low'));
    ALTER TABLE rea_property_offers DROP CONSTRAINT IF EXISTS chk_review_status;
    ALTER TABLE rea_property_offers ADD CONSTRAINT chk_review_status CHECK (review_status IS NULL OR review_status IN ('not_needed', 'pending', 'approved', 'blocked', 'trashed'));
    """,
    f"""
    CREATE OR REPLACE FUNCTION rea_apply_offer_policy() RETURNS TRIGGER AS $$
    DECLARE
        normalized_haystack TEXT;
        normalized_district TEXT;
        matched_district TEXT := NULL;
        matched_is_south BOOLEAN := FALSE;
    BEGIN
        IF TG_OP = 'UPDATE' THEN
            IF NULLIF(BTRIM(COALESCE(NEW.title, '')), '') IS NULL
               AND NULLIF(BTRIM(COALESCE(OLD.title, '')), '') IS NOT NULL THEN
                NEW.title := OLD.title;
            END IF;
        END IF;

        NEW.district := NULLIF(BTRIM(COALESCE(NEW.district, '')), '');
        NEW.location_text := NULLIF(BTRIM(COALESCE(NEW.location_text, '')), '');
        normalized_haystack := translate(
            lower(
                regexp_replace(
                    concat_ws(' ', COALESCE(NEW.district, ''), COALESCE(NEW.location_text, ''), COALESCE(NEW.title, ''), regexp_replace(COALESCE(NEW.ai_analysis_html, ''), '<[^>]+>', ' ', 'g')),
                    '\\s+',
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
        NEW.policy_version := '{POLICY_VERSION}';

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
    """,
    """
    DROP TRIGGER IF EXISTS trg_rea_apply_offer_policy ON rea_property_offers;
    CREATE TRIGGER trg_rea_apply_offer_policy
    BEFORE INSERT OR UPDATE ON rea_property_offers
    FOR EACH ROW
    EXECUTE FUNCTION rea_apply_offer_policy();
    """,
    """
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
    """,
    """
    DROP TRIGGER IF EXISTS trg_rea_log_offer_audit ON rea_property_offers;
    CREATE TRIGGER trg_rea_log_offer_audit
    AFTER INSERT OR UPDATE ON rea_property_offers
    FOR EACH ROW
    EXECUTE FUNCTION rea_log_offer_audit();
    """,
]


async def ensure_schema(conn: asyncpg.Connection) -> None:
    for statement in SCHEMA_SQL:
        await conn.execute(statement)

    await conn.execute(
        """
        UPDATE rea_property_offers
        SET user_grade = CASE user_rating
            WHEN 'strong_dislike' THEN 1
            WHEN 'dislike' THEN 2
            WHEN '👎 I don''t like it' THEN 2
            WHEN 'neutral' THEN 3
            WHEN 'like' THEN 4
            WHEN '👍 I like it' THEN 4
            WHEN 'strong_like' THEN 5
            ELSE user_grade
        END
        WHERE user_rating IN (
            'strong_dislike', 'dislike', '👎 I don''t like it',
            'neutral', 'like', '👍 I like it', 'strong_like'
        )
        AND user_grade IS DISTINCT FROM CASE user_rating
            WHEN 'strong_dislike' THEN 1
            WHEN 'dislike' THEN 2
            WHEN '👎 I don''t like it' THEN 2
            WHEN 'neutral' THEN 3
            WHEN 'like' THEN 4
            WHEN '👍 I like it' THEN 4
            WHEN 'strong_like' THEN 5
        END;
        """
    )
    await conn.execute(
        """
        UPDATE rea_property_offers
        SET user_rated_at = COALESCE(user_rated_at, CURRENT_TIMESTAMP)
        WHERE user_grade IS NOT NULL AND user_rated_at IS NULL;
        """
    )
    await conn.execute(
        """
        UPDATE rea_property_offers
        SET ai_rating = NULL
        WHERE ai_rating = 0;
        """
    )
    await conn.execute(
        """
        UPDATE rea_property_offers
        SET review_status = review_status
        WHERE policy_version IS DISTINCT FROM $1
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
        """,
        POLICY_VERSION,
    )


@app.on_event("startup")
async def startup() -> None:
    db_config = {
        "user": os.getenv("POSTGRES_USER"),
        "password": os.getenv("POSTGRES_PASSWORD"),
        "database": os.getenv("POSTGRES_DB"),
        "host": os.getenv("POSTGRES_HOST", "postgres"),
        "port": int(os.getenv("POSTGRES_PORT", "5432")),
        "min_size": 2,
        "max_size": 10,
    }

    last_error: Exception | None = None
    for _ in range(30):
        try:
            app.state.pool = await asyncpg.create_pool(**db_config)
            async with app.state.pool.acquire() as conn:
                await ensure_schema(conn)
            return
        except Exception as exc:  # pragma: no cover - startup retry path
            last_error = exc
            await asyncio.sleep(1)

    raise RuntimeError("Database connection pool startup failed after retries") from last_error


@app.on_event("shutdown")
async def shutdown() -> None:
    await app.state.pool.close()


def parse_int(value: Any) -> int | None:
    if value is None:
        return None
    return int(value)


def build_where(params: dict[str, Any]) -> tuple[str, list[Any]]:
    conds: list[str] = []
    vals: list[Any] = []
    idx = 1

    review_queue_only = bool(params.get("review_queue_only"))
    show_out_of_region = bool(params.get("show_out_of_region"))
    show_trash = bool(params.get("show_trash"))

    if review_queue_only:
        conds.append("COALESCE(needs_manual_review, FALSE) = TRUE")
        conds.append("COALESCE(is_in_trash, FALSE) = FALSE")
    else:
        if not show_trash:
            conds.append("COALESCE(is_in_trash, FALSE) = FALSE")
        if not show_out_of_region:
            conds.append("COALESCE(is_soft_blocked, FALSE) = FALSE")

    for key, col, cast in [
        ("category", "category", str),
        ("geo_status", "geo_status", str),
        ("review_status", "review_status", str),
        ("ai_rating_min", "ai_rating", int),
        ("ai_rating_max", "ai_rating", int),
        ("price_min", "price", float),
        ("price_max", "price", float),
        ("area_min", "area", float),
        ("area_max", "area", float),
    ]:
        value = params.get(key)
        if value is None:
            continue
        op = ">=" if key.endswith("_min") else "<=" if key.endswith("_max") else "="
        conds.append(f"{col} {op} ${idx}")
        vals.append(cast(value))
        idx += 1

    if params.get("exception_only"):
        conds.append("COALESCE(is_exception_candidate, FALSE) = TRUE")

    user_grade_filter = params.get("user_grade")
    if user_grade_filter == "null":
        conds.append("user_grade IS NULL")
    elif user_grade_filter is not None:
        conds.append(f"user_grade = ${idx}")
        vals.append(parse_int(user_grade_filter))
        idx += 1

    user_rating = params.get("user_rating")
    if user_rating is not None:
        variants = USER_RATING_ALIASES.get(user_rating, (user_rating,))
        placeholders = []
        for variant in variants:
            placeholders.append(f"${idx}")
            vals.append(variant)
            idx += 1
        conds.append(f"user_rating IN ({', '.join(placeholders)})")

    search = params.get("search")
    if search is not None:
        normalized_search = str(search).strip()
        if normalized_search:
            conds.append(
                (
                    "concat_ws(' ', "
                    "COALESCE(external_id, ''), "
                    "COALESCE(category, ''), "
                    "COALESCE(url, ''), "
                    "COALESCE(title, ''), "
                    "regexp_replace(COALESCE(ai_analysis_html, ''), '<[^>]+>', ' ', 'g'), "
                    "COALESCE(user_rating, ''), "
                    "COALESCE(user_notes, ''), "
                    "COALESCE(property_portal, ''), "
                    "COALESCE(district, ''), "
                    "COALESCE(location_text, ''), "
                    "COALESCE(geo_status, ''), "
                    "COALESCE(geo_confidence, ''), "
                    "COALESCE(geo_reason, ''), "
                    "COALESCE(policy_version, ''), "
                    "COALESCE(review_status, ''), "
                    "COALESCE(review_reason, ''), "
                    "COALESCE(reviewed_by, ''), "
                    "COALESCE(pre_trash_review_status, '')"
                    f") ILIKE ${idx}"
                )
            )
            vals.append(f"%{normalized_search}%")
            idx += 1

    return " AND ".join(conds) or "1=1", vals


def serialize_offer(row: asyncpg.Record) -> dict[str, Any]:
    offer = dict(row)
    for key in SERIALIZED_TIMESTAMPS:
        if offer.get(key):
            offer[key] = offer[key].isoformat()
    for key in NUMERIC_FIELDS:
        if offer.get(key) is not None:
            offer[key] = float(offer[key])
    grade = offer.get("user_grade")
    offer["user_grade_label"] = GRADE_TO_LABEL.get(grade, "unrated") if isinstance(grade, int) else "unrated"
    return offer


def serialize_audit(row: asyncpg.Record) -> dict[str, Any]:
    event = dict(row)
    if event.get("created_at"):
        event["created_at"] = event["created_at"].isoformat()
    return event


async def fetch_offer_or_404(conn: asyncpg.Connection, external_id: str) -> asyncpg.Record:
    row = await conn.fetchrow(f"{OFFERS_SELECT} WHERE external_id = $1", external_id)
    if not row:
        raise HTTPException(status_code=404, detail="Offer not found")
    return row


@app.get("/api/offers")
async def list_offers(
    user_rating: Optional[str] = None,
    user_grade: Optional[str] = None,
    category: Optional[str] = None,
    geo_status: Optional[str] = None,
    review_status: Optional[str] = None,
    ai_rating_min: Optional[int] = None,
    ai_rating_max: Optional[int] = None,
    price_min: Optional[float] = None,
    price_max: Optional[float] = None,
    area_min: Optional[float] = None,
    area_max: Optional[float] = None,
    show_out_of_region: bool = False,
    show_trash: bool = False,
    review_queue_only: bool = False,
    exception_only: bool = False,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    limit: int = 100,
    offset: int = 0,
    search: Optional[str] = None,
):
    if sort_by not in ALLOWED_SORT:
        sort_by = "created_at"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    params = {
        "user_rating": user_rating,
        "user_grade": user_grade,
        "category": category,
        "search": search,
        "geo_status": geo_status,
        "review_status": review_status,
        "ai_rating_min": ai_rating_min,
        "ai_rating_max": ai_rating_max,
        "price_min": price_min,
        "price_max": price_max,
        "area_min": area_min,
        "area_max": area_max,
        "show_out_of_region": show_out_of_region,
        "show_trash": show_trash,
        "review_queue_only": review_queue_only,
        "exception_only": exception_only,
    }
    where, vals = build_where(params)

    async with app.state.pool.acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM rea_property_offers WHERE {where}", *vals)
        rows = await conn.fetch(
            f"{OFFERS_SELECT} WHERE {where} ORDER BY {sort_by} {sort_dir} LIMIT {int(limit)} OFFSET {int(offset)}",
            *vals,
        )

    return {"total": total, "offers": [serialize_offer(row) for row in rows]}


@app.get("/api/offers/{external_id}")
async def get_offer(external_id: str):
    async with app.state.pool.acquire() as conn:
        row = await fetch_offer_or_404(conn, external_id)
    return serialize_offer(row)


@app.get("/api/offers/{external_id}/audit")
async def get_offer_audit(external_id: str, limit: int = 20):
    async with app.state.pool.acquire() as conn:
        await fetch_offer_or_404(conn, external_id)
        rows = await conn.fetch(
            """
            SELECT id, external_id, event_type, actor, reason, old_values, new_values, policy_version, created_at
            FROM rea_offer_audit_log
            WHERE external_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2
            """,
            external_id,
            limit,
        )
    return [serialize_audit(row) for row in rows]


@app.patch("/api/offers/{external_id}")
async def update_offer(external_id: str, update: OfferUpdate):
    fields: list[str] = []
    vals: list[Any] = []
    idx = 1

    resolved_grade = update.user_grade
    if resolved_grade is not None and resolved_grade not in (1, 2, 3, 4, 5):
        raise HTTPException(status_code=400, detail="Invalid user_grade")

    if update.user_rating is not None:
        if update.user_rating not in LEGACY_RATING_TO_GRADE:
            raise HTTPException(status_code=400, detail="Invalid user_rating")
        mapped_grade = LEGACY_RATING_TO_GRADE[update.user_rating]
        if resolved_grade is None:
            resolved_grade = mapped_grade

    if update.user_grade is not None and update.user_rating is not None:
        mapped_grade = LEGACY_RATING_TO_GRADE[update.user_rating]
        if mapped_grade != update.user_grade:
            raise HTTPException(status_code=400, detail="Conflicting user_rating and user_grade")

    if update.user_grade is not None or update.user_rating is not None:
        fields.append(f"user_grade = ${idx}")
        vals.append(resolved_grade)
        idx += 1

        label = "pending" if resolved_grade is None else GRADE_TO_LABEL[resolved_grade]
        fields.append(f"user_rating = ${idx}")
        vals.append(label)
        idx += 1
        fields.append("user_rated_at = NULL" if resolved_grade is None else "user_rated_at = NOW()")

    if update.user_notes is not None:
        fields.append(f"user_notes = ${idx}")
        vals.append(update.user_notes)
        idx += 1

    if update.title is not None:
        cleaned_title = update.title.strip()
        if not cleaned_title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        fields.append(f"title = ${idx}")
        vals.append(cleaned_title)
        idx += 1

    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(
            f"UPDATE rea_property_offers SET {', '.join(fields)} WHERE external_id = ${len(vals) + 1} RETURNING *",
            *vals,
            external_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Offer not found")
    return serialize_offer(row)


@app.post("/api/offers/{external_id}/review")
async def review_offer(external_id: str, payload: ReviewAction):
    reason = payload.reason.strip()
    actor = payload.actor.strip() or "frontend"
    if not reason:
        raise HTTPException(status_code=400, detail="Review reason is required")

    async with app.state.pool.acquire() as conn:
        current_row = await fetch_offer_or_404(conn, external_id)
        current = dict(current_row)

        updates: dict[str, Any] = {
            "review_reason": reason,
            "reviewed_by": actor,
            "reviewed_at": "NOW()",
        }

        if payload.action == "approve":
            updates["review_status"] = "approved"
            updates["is_in_trash"] = False
            updates["pre_trash_review_status"] = None
        elif payload.action == "keep_blocked":
            updates["review_status"] = "blocked"
            updates["is_in_trash"] = False
        elif payload.action == "trash":
            updates["review_status"] = "trashed"
            updates["is_in_trash"] = True
            updates["pre_trash_review_status"] = current.get("review_status") if current.get("review_status") != "trashed" else current.get("pre_trash_review_status")
        elif payload.action == "restore":
            updates["review_status"] = restore_review_status(current)
            updates["is_in_trash"] = False
            updates["pre_trash_review_status"] = None

        set_fragments: list[str] = []
        values: list[Any] = []
        index = 1
        for column, value in updates.items():
            if value == "NOW()":
                set_fragments.append(f"{column} = NOW()")
                continue
            set_fragments.append(f"{column} = ${index}")
            values.append(value)
            index += 1

        row = await conn.fetchrow(
            f"UPDATE rea_property_offers SET {', '.join(set_fragments)} WHERE external_id = ${index} RETURNING *",
            *values,
            external_id,
        )

    if not row:
        raise HTTPException(status_code=404, detail="Offer not found")
    return serialize_offer(row)


@app.get("/api/stats")
async def get_stats(
    user_rating: Optional[str] = None,
    user_grade: Optional[int] = None,
    category: Optional[str] = None,
    geo_status: Optional[str] = None,
    review_status: Optional[str] = None,
    ai_rating_min: Optional[int] = None,
    ai_rating_max: Optional[int] = None,
    price_min: Optional[float] = None,
    price_max: Optional[float] = None,
    area_min: Optional[float] = None,
    area_max: Optional[float] = None,
    show_out_of_region: bool = False,
    show_trash: bool = False,
    review_queue_only: bool = False,
    exception_only: bool = False,
):
    params = {
        "user_rating": user_rating,
        "user_grade": user_grade,
        "category": category,
        "geo_status": geo_status,
        "review_status": review_status,
        "ai_rating_min": ai_rating_min,
        "ai_rating_max": ai_rating_max,
        "price_min": price_min,
        "price_max": price_max,
        "area_min": area_min,
        "area_max": area_max,
        "show_out_of_region": show_out_of_region,
        "show_trash": show_trash,
        "review_queue_only": review_queue_only,
        "exception_only": exception_only,
    }
    where, vals = build_where(params)

    async with app.state.pool.acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM rea_property_offers WHERE {where}", *vals)
        rating_rows = await conn.fetch(
            f"SELECT user_grade, COUNT(*) AS count FROM rea_property_offers WHERE {where} GROUP BY user_grade ORDER BY user_grade",
            *vals,
        )
        ai_rows = await conn.fetch(
            f"SELECT ai_rating, COUNT(*) AS count FROM rea_property_offers WHERE {where} AND ai_rating BETWEEN 1 AND 10 GROUP BY ai_rating ORDER BY ai_rating",
            *vals,
        )
        unrated_ai_count = await conn.fetchval(
            f"SELECT COUNT(*) FROM rea_property_offers WHERE {where} AND (ai_rating IS NULL OR ai_rating < 1 OR ai_rating > 10)",
            *vals,
        )
        price_cat_rows = await conn.fetch(
            f"""
            SELECT category, AVG(price_per_m2) AS avg_price_m2, MIN(price_per_m2) AS min_price_m2,
                   MAX(price_per_m2) AS max_price_m2, COUNT(*) AS count
            FROM rea_property_offers
            WHERE {where} AND price_per_m2 IS NOT NULL AND price_per_m2 > 0
            GROUP BY category
            ORDER BY category
            """,
            *vals,
        )
        price_rows = await conn.fetch(
            f"SELECT price FROM rea_property_offers WHERE {where} AND price IS NOT NULL AND price > 0 ORDER BY price",
            *vals,
        )

    prices = [float(row["price"]) for row in price_rows]
    price_histogram: list[dict[str, Any]] = []
    if prices:
        min_price, max_price = min(prices), max(prices)
        if min_price == max_price:
            price_histogram = [{"range": f"{int(min_price / 1000)}k", "count": len(prices)}]
        else:
            buckets = min(10, len(set(prices)))
            bucket_size = (max_price - min_price) / buckets
            for bucket in range(buckets):
                low = min_price + bucket * bucket_size
                high = min_price + (bucket + 1) * bucket_size
                count = sum(1 for price in prices if (low <= price < high) or (bucket == buckets - 1 and price == high))
                price_histogram.append({"range": f"{int(low / 1000)}-{int(high / 1000)}k", "count": count})

    return {
        "total": total,
        "user_rating_breakdown": [
            {
                "status": GRADE_TO_LABEL.get(row["user_grade"], "unrated"),
                "grade": row["user_grade"],
                "count": row["count"],
            }
            for row in rating_rows
        ],
        "ai_rating_distribution": [{"rating": row["ai_rating"], "count": row["count"]} for row in ai_rows],
        "unrated_ai_count": unrated_ai_count,
        "price_per_m2_by_category": [
            {
                "category": row["category"],
                "avg": round(float(row["avg_price_m2"]), 0),
                "min": round(float(row["min_price_m2"]), 0),
                "max": round(float(row["max_price_m2"]), 0),
                "count": row["count"],
            }
            for row in price_cat_rows
        ],
        "price_histogram": price_histogram,
    }


@app.get("/api/categories")
async def get_categories():
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT DISTINCT category
            FROM rea_property_offers
            WHERE category IS NOT NULL
              AND COALESCE(is_in_trash, FALSE) = FALSE
                            AND COALESCE(is_soft_blocked, FALSE) = FALSE
            ORDER BY category
            """
        )
    return [row["category"] for row in rows]
