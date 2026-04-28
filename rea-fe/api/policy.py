from __future__ import annotations

import re
import unicodedata
from typing import Any, Mapping

POLICY_VERSION = "south-krakow-v1"

GRADE_TO_LABEL = {
    1: "strong_dislike",
    2: "dislike",
    3: "neutral",
    4: "like",
    5: "strong_like",
}

SOUTH_DISTRICTS: dict[str, tuple[str, ...]] = {
    "VIII Dębniki": (
        "debniki",
        "district viii debniki",
        "dzielnica viii debniki",
        "viii debniki",
    ),
    "IX Łagiewniki-Borek Fałęcki": (
        "lagiewniki borek falecki",
        "lagiewniki-borek falecki",
        "district ix lagiewniki borek falecki",
        "dzielnica ix lagiewniki borek falecki",
        "ix lagiewniki borek falecki",
    ),
    "X Swoszowice": (
        "swoszowice",
        "district x swoszowice",
        "dzielnica x swoszowice",
        "x swoszowice",
    ),
    "XI Podgórze Duchackie": (
        "podgorze duchackie",
        "district xi podgorze duchackie",
        "dzielnica xi podgorze duchackie",
        "xi podgorze duchackie",
    ),
    "XII Bieżanów-Prokocim": (
        "biezanow prokocim",
        "biezanow-prokocim",
        "district xii biezanow prokocim",
        "dzielnica xii biezanow prokocim",
        "xii biezanow prokocim",
    ),
    "XIII Podgórze": (
        "district xiii podgorze",
        "dzielnica xiii podgorze",
        "xiii podgorze",
        "podgorze",
    ),
}

OTHER_DISTRICTS: dict[str, tuple[str, ...]] = {
    "I Stare Miasto": ("stare miasto", "district i stare miasto", "i stare miasto"),
    "II Grzegórzki": ("grzegorzki", "district ii grzegorzki", "ii grzegorzki"),
    "III Prądnik Czerwony": (
        "pradnik czerwony",
        "district iii pradnik czerwony",
        "iii pradnik czerwony",
    ),
    "IV Prądnik Biały": (
        "pradnik bialy",
        "district iv pradnik bialy",
        "iv pradnik bialy",
    ),
    "V Krowodrza": ("krowodrza", "district v krowodrza", "v krowodrza"),
    "VI Bronowice": ("bronowice", "district vi bronowice", "vi bronowice"),
    "VII Zwierzyniec": ("zwierzyniec", "district vii zwierzyniec", "vii zwierzyniec"),
    "XIV Czyżyny": ("czyzyny", "district xiv czyzyny", "xiv czyzyny"),
    "XV Mistrzejowice": ("mistrzejowice", "district xv mistrzejowice", "xv mistrzejowice"),
    "XVI Bieńczyce": ("bienczyce", "district xvi bienczyce", "xvi bienczyce"),
    "XVII Wzgórza Krzesławickie": (
        "wzgorza krzeslawickie",
        "district xvii wzgorza krzeslawickie",
        "xvii wzgorza krzeslawickie",
    ),
    "XVIII Nowa Huta": ("nowa huta", "district xviii nowa huta", "xviii nowa huta"),
}

DISTRICT_MATCHES = [
    *[(name, aliases, "in_region") for name, aliases in SOUTH_DISTRICTS.items()],
    *[(name, aliases, "out_of_region") for name, aliases in OTHER_DISTRICTS.items()],
]
DISTRICT_MATCHES.sort(key=lambda item: max(len(alias) for alias in item[1]), reverse=True)

HTML_TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = HTML_TAG_RE.sub(" ", text)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return WHITESPACE_RE.sub(" ", text).strip()


def to_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return bool(value)


def detect_district(*parts: Any) -> tuple[str, str] | None:
    haystack = normalize_text(" ".join(str(part) for part in parts if part))
    if not haystack:
        return None
    for canonical_name, aliases, geo_status in DISTRICT_MATCHES:
        if any(alias in haystack for alias in aliases):
            return canonical_name, geo_status
    return None


def has_krakow_marker(*parts: Any) -> bool:
    haystack = normalize_text(" ".join(str(part) for part in parts if part))
    return "krakow" in haystack


def is_exception_candidate(area: Any, price_per_m2: Any) -> bool:
    area_value = to_float(area)
    price_m2_value = to_float(price_per_m2)
    return (area_value is not None and area_value > 120) or (
        price_m2_value is not None and 0 < price_m2_value < 11000
    )


def default_review_status(geo_status: str, exception_candidate: bool) -> str:
    if geo_status == "in_region":
        return "not_needed"
    if geo_status == "out_of_region" and not exception_candidate:
        return "blocked"
    return "pending"


def derive_lifecycle(
    geo_status: str,
    exception_candidate: bool,
    current_review_status: Any,
    is_in_trash: Any,
) -> dict[str, Any]:
    review_status = (current_review_status or "").strip()
    trash_flag = to_bool(is_in_trash) or review_status == "trashed"

    if trash_flag:
        return {
            "review_status": "trashed",
            "is_in_trash": True,
            "is_soft_blocked": False,
            "needs_manual_review": False,
            "excluded_from_feedback_loop": True,
        }

    if review_status == "approved":
        return {
            "review_status": "approved",
            "is_in_trash": False,
            "is_soft_blocked": False,
            "needs_manual_review": False,
            "excluded_from_feedback_loop": False,
        }

    if review_status == "blocked":
        return {
            "review_status": "blocked",
            "is_in_trash": False,
            "is_soft_blocked": True,
            "needs_manual_review": False,
            "excluded_from_feedback_loop": True,
        }

    review_status = default_review_status(geo_status, exception_candidate)

    if review_status == "not_needed":
        return {
            "review_status": review_status,
            "is_in_trash": False,
            "is_soft_blocked": False,
            "needs_manual_review": False,
            "excluded_from_feedback_loop": False,
        }

    return {
        "review_status": review_status,
        "is_in_trash": False,
        "is_soft_blocked": True,
        "needs_manual_review": review_status == "pending",
        "excluded_from_feedback_loop": True,
    }


def classify_offer(data: Mapping[str, Any]) -> dict[str, Any]:
    district = data.get("district")
    location_text = data.get("location_text")
    title = data.get("title")
    ai_analysis_html = data.get("ai_analysis_html")
    url = data.get("url")
    category = data.get("category")

    district_match = detect_district(district)
    text_match = detect_district(location_text, title, ai_analysis_html)

    matched_district: str | None = None
    geo_status = "unknown"
    geo_confidence = "low"
    geo_reason = "No supported location signal found."

    if district_match:
        matched_district, geo_status = district_match
        geo_confidence = "high"
        if matched_district != district:
            geo_reason = f"District normalized to {matched_district}."
        else:
            geo_reason = f"Matched district {matched_district}."
    elif text_match:
        matched_district, geo_status = text_match
        geo_confidence = "medium"
        geo_reason = f"Matched district {matched_district} from listing text."
    elif has_krakow_marker(district, location_text, title, ai_analysis_html, url, category):
        geo_reason = "Krakow detected but district is missing or unsupported."

    exception_candidate = is_exception_candidate(data.get("area"), data.get("price_per_m2"))
    lifecycle = derive_lifecycle(
        geo_status,
        exception_candidate,
        data.get("review_status"),
        data.get("is_in_trash"),
    )

    return {
        "district": matched_district or district,
        "geo_status": geo_status,
        "geo_confidence": geo_confidence,
        "geo_reason": geo_reason,
        "policy_version": POLICY_VERSION,
        "is_exception_candidate": exception_candidate,
        **lifecycle,
    }


def restore_review_status(data: Mapping[str, Any]) -> str:
    pre_trash_review_status = (data.get("pre_trash_review_status") or "").strip()
    if pre_trash_review_status and pre_trash_review_status != "trashed":
        return pre_trash_review_status

    classification = classify_offer({
        **data,
        "review_status": None,
        "is_in_trash": False,
    })
    return classification["review_status"]