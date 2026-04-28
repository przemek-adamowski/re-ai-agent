const items = $input.all();
const html = items[0].json.data || "";

const SOUTH_DISTRICTS = ["debniki", "lagiewniki borek falecki", "swoszowice", "podgorze duchackie", "biezanow prokocim", "podgorze"];
const OTHER_DISTRICTS = [
    "stare miasto", "grzegorzki", "pradnik czerwony", "pradnik bialy", "krowodrza", "bronowice",
    "zwierzyniec", "czyzyny", "mistrzejowice", "bienczyce", "wzgorza krzeslawickie", "nowa huta"
];

if (!html || html.length < 100) {
    return [{ json: { error: "No HTML content found" } }];
}

function extractText(html, regex) {
    const m = html.match(regex);
    return m ? m[1].trim() : "";
}

function parseNumber(str) {
    if (!str) return 0;
    const cleaned = str.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
}

function normalizeText(value) {
    return (value || "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/<[^>]+>/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function classifyOffer(offer) {
    const haystack = normalizeText([offer.district, offer.location_text, offer.title, offer.raw_html].filter(Boolean).join(" "));
    const exceptionCandidate = Number(offer.area) > 120 || (Number(offer.price_per_m2) > 0 && Number(offer.price_per_m2) < 11000);
    let geoStatus = "unknown";
    let geoConfidence = "low";
    let geoReason = "No supported location signal found.";

    if (SOUTH_DISTRICTS.some((district) => haystack.includes(district))) {
        geoStatus = "in_region";
        geoConfidence = offer.district ? "high" : "medium";
        geoReason = `Matched south Krakow district: ${offer.district || "listing text"}`;
    } else if (OTHER_DISTRICTS.some((district) => haystack.includes(district))) {
        geoStatus = "out_of_region";
        geoConfidence = offer.district ? "high" : "medium";
        geoReason = `Matched district outside the south Krakow allowlist: ${offer.district || "listing text"}`;
    } else if (haystack.includes("krakow")) {
        geoReason = "Krakow detected but district is missing or unsupported.";
    }

    let reviewStatus = "not_needed";
    let isSoftBlocked = false;
    let needsManualReview = false;
    let excludedFromFeedbackLoop = false;

    if (geoStatus === "out_of_region" && !exceptionCandidate) {
        reviewStatus = "blocked";
        isSoftBlocked = true;
        excludedFromFeedbackLoop = true;
    } else if (geoStatus !== "in_region") {
        reviewStatus = "pending";
        isSoftBlocked = true;
        needsManualReview = true;
        excludedFromFeedbackLoop = true;
    }

    return {
        ...offer,
        geo_status: geoStatus,
        geo_confidence: geoConfidence,
        geo_reason: geoReason,
        policy_version: "south-krakow-v1",
        is_exception_candidate: exceptionCandidate,
        review_status: reviewStatus,
        is_soft_blocked: isSoftBlocked,
        needs_manual_review: needsManualReview,
        excluded_from_feedback_loop: excludedFromFeedbackLoop,
        is_in_trash: false,
    };
}

function extractSpec(html, label) {
    const re = new RegExp(
        '<p class="spacificationLabel">[^<]*?' + label + '[^<]*?</p>\\s*<p class="spacificationValue">([\\s\\S]*?)</p>',
        "i"
    );
    const m = html.match(re);
    if (!m) return "";
    return m[1].replace(/<[^>]+>/g, "").trim();
}

const refId = extractText(html, /<p class="subHeader">\s*(.*?)\s*<\/p>/);
const url = extractText(html, /<link rel="canonical" href="([^"]+)"/);

let title = extractText(html, /<h1[^>]*>\s*([\s\S]*?)\s*<\/h1>/);
title = title.replace(/<[^>]+>/g, "").trim();

const priceRaw = extractText(html, /<h2 class="h3">\s*([\s\S]*?)\s*<span class="price-for-m2"/);
const price = parseNumber(priceRaw.replace(/<[^>]+>/g, "").replace(/PLN|zł/gi, ""));

const ppm2Raw = extractText(html, /class="price-for-m2"[^>]*>([\s\S]*?)<\/span>/);
const pricePerM2 = parseNumber(ppm2Raw.replace(/<[^>]+>/g, "").replace(/zł za m2?/gi, ""));

const areaRaw = extractSpec(html, "Powierzchnia");
const area = parseNumber(areaRaw.replace(/m2?/gi, ""));

const roomsRaw = extractSpec(html, "Ilość pokoi");
const rooms = parseNumber(roomsRaw) || 0;

return [{
    json: classifyOffer({
        external_id: "TS-" + (refId ? refId.replace(/\//g, "-") : Date.now()),
        category: "mieszkanie-krakow",
        url: url,
        title: "Oferta TS: " + (title || refId),
        price: price,
        price_per_m2: pricePerM2,
        area: area,
        rooms: rooms,
        lot_size: 0,
        construction_year: 0,
        created_at: new Date().toISOString(),
        property_portal: 'Tecnocasa',
        location_text: title,
        raw_html: html
    })
}];
