const items = $input.all();
const html = items[0].json.data || "";

const SOUTH_DISTRICTS = ["debniki", "lagiewniki borek falecki", "swoszowice", "podgorze duchackie", "biezanow prokocim", "podgorze"];
const OTHER_DISTRICTS = [
    "stare miasto", "grzegorzki", "pradnik czerwony", "pradnik bialy", "krowodrza", "bronowice",
    "zwierzyniec", "czyzyny", "mistrzejowice", "bienczyce", "wzgorza krzeslawickie", "nowa huta"
];

function normalizeText(value) {
    return (value || "")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function classifyOffer(offer) {
    const haystack = normalizeText([offer.district, offer.location_text, offer.title].filter(Boolean).join(" "));
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

const jsonMatch = html.match(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?pageProps[\s\S]*?)<\/script>/);

if (!jsonMatch) {
    return [{ json: { error: "Failed to extract JSON with offers" } }];
}

try {
    const fullData = JSON.parse(jsonMatch[1].trim());
    const ads = fullData?.props?.pageProps?.data?.searchAds?.items ||
                fullData?.props?.pageProps?.apolloState?.data?.searchAds?.items || [];

    if (ads.length === 0) return [];

    return ads.map((ad) => {
        const district = ad.location?.address?.district?.name || null;
        const locationText = [
            ad.location?.address?.city?.name,
            district,
            ad.location?.address?.subdistrict?.name,
            ad.location?.address?.street?.name,
        ].filter(Boolean).join(", ");

        return {
            json: classifyOffer({
                external_id: "OT-" + ad.id,
                category: "mieszkanie-krakow",
                url: "https://www.otodom.pl/pl/oferta/" + ad.slug,
                title: "Oferta OT: " + ad.title,
                price: ad.totalPrice?.value || 0,
                price_per_m2: ad.pricePerSquareMeter?.value || 0,
                area: ad.areaInSquareMeters || 0,
                rooms: ad.roomsNumber || 0,
                lot_size: 0,
                construction_year: 0,
                created_at: new Date().toISOString(),
                property_portal: "Otodom",
                district,
                location_text: locationText || null,
            }),
        };
    });
} catch (e) {
    return [{ json: { error: "JSON parsing error: " + e.message } }];
}