import asyncio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import asyncpg
import os

app = FastAPI(title="REA Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    db_config = {
        "user": os.getenv("POSTGRES_USER"),
        "password": os.getenv("POSTGRES_PASSWORD"),
        "database": os.getenv("POSTGRES_DB"),
        "host": os.getenv("POSTGRES_HOST", "postgres"),
        "port": int(os.getenv("POSTGRES_PORT", "5432")),
        "min_size": 2,
        "max_size": 10,
    }

    # Postgres may accept TCP before being ready to serve connections.
    last_error = None
    for attempt in range(1, 31):
        try:
            app.state.pool = await asyncpg.create_pool(**db_config)
            return
        except Exception as exc:
            last_error = exc
            await asyncio.sleep(1)

    raise RuntimeError("Database connection pool startup failed after retries") from last_error


@app.on_event("shutdown")
async def shutdown():
    await app.state.pool.close()


class OfferUpdate(BaseModel):
    user_rating: Optional[str] = None
    user_grade: Optional[int] = None
    user_notes: Optional[str] = None


ALLOWED_SORT = {"created_at", "price", "price_per_m2", "area", "ai_rating", "user_grade", "user_rated_at", "title"}

USER_RATING_ALIASES = {
    "like": ("like", "👍 I like it"),
    "dislike": ("dislike", "👎 I don't like it"),
    "pending": ("pending",),
}

LEGACY_RATING_TO_GRADE = {
    "like": 4,
    "👍 I like it": 4,
    "dislike": 2,
    "👎 I don't like it": 2,
    "pending": None,
}

GRADE_TO_LABEL = {
    1: "strong_dislike",
    2: "dislike",
    3: "neutral",
    4: "like",
    5: "strong_like",
}


def parse_int(value):
    if value is None:
        return None
    return int(value)


def build_where(params):
    conds, vals, idx = [], [], 1
    for key, col, cast in [
        ("category", "category", str),
        ("ai_rating_min", "ai_rating", int),
        ("ai_rating_max", "ai_rating", int),
        ("price_min", "price", float),
        ("price_max", "price", float),
        ("area_min", "area", float),
        ("area_max", "area", float),
    ]:
        v = params.get(key)
        if v is None:
            continue
        op = ">=" if key.endswith("_min") else "<=" if key.endswith("_max") else "="
        conds.append(f"{col} {op} ${idx}")
        vals.append(cast(v))
        idx += 1

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

    return " AND ".join(conds) or "1=1", vals


def ser(row):
    o = dict(row)
    for k in ("created_at", "last_seen_at", "sent_at", "user_rated_at"):
        if o.get(k):
            o[k] = o[k].isoformat()
    for k in ("price", "price_per_m2", "area", "lot_size"):
        if o.get(k) is not None:
            o[k] = float(o[k])
    grade = o.get("user_grade")
    o["user_grade_label"] = GRADE_TO_LABEL.get(grade, "unrated")
    return o


@app.get("/api/offers")
async def list_offers(
    user_rating: Optional[str] = None,
    user_grade: Optional[str] = None,
    category: Optional[str] = None,
    ai_rating_min: Optional[int] = None,
    ai_rating_max: Optional[int] = None,
    price_min: Optional[float] = None,
    price_max: Optional[float] = None,
    area_min: Optional[float] = None,
    area_max: Optional[float] = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    limit: int = 100,
    offset: int = 0,
):
    if sort_by not in ALLOWED_SORT:
        sort_by = "created_at"
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"

    params = {
        "user_rating": user_rating, "user_grade": user_grade, "category": category,
        "ai_rating_min": ai_rating_min, "ai_rating_max": ai_rating_max,
        "price_min": price_min, "price_max": price_max,
        "area_min": area_min, "area_max": area_max,
    }
    where, vals = build_where(params)

    async with app.state.pool.acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM rea_property_offers WHERE {where}", *vals)
        rows = await conn.fetch(
            f"SELECT external_id, category, url, title, price, price_per_m2, area, lot_size,"
            f" construction_year, ai_rating, user_rating, user_grade, user_notes, user_rated_at, created_at, last_seen_at, sent_at"
            f" FROM rea_property_offers WHERE {where}"
            f" ORDER BY {sort_by} {sort_dir} LIMIT {int(limit)} OFFSET {int(offset)}",
            *vals,
        )
    return {"total": total, "offers": [ser(r) for r in rows]}


@app.get("/api/offers/{external_id}")
async def get_offer(external_id: str):
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM rea_property_offers WHERE external_id = $1", external_id)
    if not row:
        raise HTTPException(status_code=404, detail="Offer not found")
    return ser(row)


@app.patch("/api/offers/{external_id}")
async def update_offer(external_id: str, update: OfferUpdate):
    fields, vals, idx = [], [], 1

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

        if resolved_grade is None:
            label = "pending"
        else:
            label = GRADE_TO_LABEL[resolved_grade]

        fields.append(f"user_rating = ${idx}")
        vals.append(label)
        idx += 1

        if resolved_grade is None:
            fields.append("user_rated_at = NULL")
        else:
            fields.append("user_rated_at = NOW()")
    if update.user_notes is not None:
        fields.append(f"user_notes = ${idx}")
        vals.append(update.user_notes)
        idx += 1
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    query = f"UPDATE rea_property_offers SET {', '.join(fields)} WHERE external_id = ${len(vals) + 1} RETURNING *"
    async with app.state.pool.acquire() as conn:
        row = await conn.fetchrow(query, *vals, external_id)
    if not row:
        raise HTTPException(status_code=404, detail="Offer not found")
    return ser(row)


@app.get("/api/stats")
async def get_stats(
    user_rating: Optional[str] = None,
    user_grade: Optional[int] = None,
    category: Optional[str] = None,
    ai_rating_min: Optional[int] = None,
    ai_rating_max: Optional[int] = None,
    price_min: Optional[float] = None,
    price_max: Optional[float] = None,
    area_min: Optional[float] = None,
    area_max: Optional[float] = None,
):
    params = {
        "user_rating": user_rating, "user_grade": user_grade, "category": category,
        "ai_rating_min": ai_rating_min, "ai_rating_max": ai_rating_max,
        "price_min": price_min, "price_max": price_max,
        "area_min": area_min, "area_max": area_max,
    }
    where, vals = build_where(params)

    async with app.state.pool.acquire() as conn:
        total = await conn.fetchval(f"SELECT COUNT(*) FROM rea_property_offers WHERE {where}", *vals)
        rating_rows = await conn.fetch(
            f"SELECT user_grade, COUNT(*) as count FROM rea_property_offers WHERE {where} GROUP BY user_grade ORDER BY user_grade", *vals)
        ai_rows = await conn.fetch(
            f"SELECT ai_rating, COUNT(*) as count FROM rea_property_offers WHERE {where} AND ai_rating IS NOT NULL GROUP BY ai_rating ORDER BY ai_rating", *vals)
        price_cat_rows = await conn.fetch(
            f"SELECT category, AVG(price_per_m2) as avg_price_m2, MIN(price_per_m2) as min_price_m2,"
            f" MAX(price_per_m2) as max_price_m2, COUNT(*) as count"
            f" FROM rea_property_offers WHERE {where} AND price_per_m2 IS NOT NULL AND price_per_m2 > 0"
            f" GROUP BY category ORDER BY category", *vals)
        price_rows = await conn.fetch(
            f"SELECT price FROM rea_property_offers WHERE {where} AND price IS NOT NULL AND price > 0 ORDER BY price", *vals)

    prices = [float(r["price"]) for r in price_rows]
    price_histogram = []
    if prices:
        min_p, max_p = min(prices), max(prices)
        if min_p == max_p:
            price_histogram = [{"range": f"{int(min_p/1000)}k", "count": len(prices)}]
        else:
            nb = min(10, len(set(prices)))
            bs = (max_p - min_p) / nb
            for i in range(nb):
                lo, hi = min_p + i * bs, min_p + (i + 1) * bs
                cnt = sum(1 for p in prices if (lo <= p < hi) or (i == nb - 1 and p == hi))
                price_histogram.append({"range": f"{int(lo/1000)}-{int(hi/1000)}k", "count": cnt})

    return {
        "total": total,
        "user_rating_breakdown": [
            {
                "status": GRADE_TO_LABEL.get(r["user_grade"], "unrated"),
                "grade": r["user_grade"],
                "count": r["count"],
            }
            for r in rating_rows
        ],
        "ai_rating_distribution": [{"rating": r["ai_rating"], "count": r["count"]} for r in ai_rows],
        "price_per_m2_by_category": [
            {"category": r["category"], "avg": round(float(r["avg_price_m2"]), 0),
             "min": round(float(r["min_price_m2"]), 0), "max": round(float(r["max_price_m2"]), 0),
             "count": r["count"]} for r in price_cat_rows
        ],
        "price_histogram": price_histogram,
    }


@app.get("/api/categories")
async def get_categories():
    async with app.state.pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT category FROM rea_property_offers WHERE category IS NOT NULL ORDER BY category")
    return [r["category"] for r in rows]
