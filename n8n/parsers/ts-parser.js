const items = $input.all();
const html = items[0].json.data || "";

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
    json: {
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
        raw_html: html
    }
}];
