const crypto = require('crypto');

const items = $input.all();
const results = [];

function classifyOffer(offer) {
    return {
        ...offer,
        geo_status: 'unknown',
        geo_confidence: 'low',
        geo_reason: 'Krakow detected but district is missing or unsupported.',
        policy_version: 'south-krakow-v1',
        is_exception_candidate: false,
        review_status: 'pending',
        is_soft_blocked: true,
        needs_manual_review: true,
        excluded_from_feedback_loop: true,
        is_in_trash: false,
    };
}

function extractHtml(item) {
    if (item.binary && item.binary.data) {
        return Buffer.from(item.binary.data.data, 'base64').toString('utf-8');
    }

    if (typeof item === 'string') {
        return item;
    }

    if (item && item.data) {
        return item.data;
    }

    if (typeof item.json === 'string') {
        return item.json;
    }

    if (item.json && item.json.data) {
        return item.json.data;
    }

    return JSON.stringify(item.json || item);
}

function cleanText(value) {
    if (!value) {
        return '';
    }

    return String(value)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&sup2;/g, '²')
        .replace(/\s+/g, ' ')
        .trim();
}

function toNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }

    if (value === null || value === undefined || value === '') {
        return 0;
    }

    const normalized = String(value)
        .replace(/\u00a0/g, '')
        .replace(/\s+/g, '')
        .replace(',', '.')
        .replace(/[^\d.-]/g, '');

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseArea(value) {
    const text = cleanText(value);
    const match = text.match(/od\s*([\d.,]+)\s*m(?:²|2)/i);
    return match ? toNumber(match[1]) : 0;
}

function stripQuery(url) {
    return String(url || '').split('?')[0].trim();
}

function buildDetailUrl(url) {
    const normalized = stripQuery(url);
    return normalized ? `${normalized}?i` : '';
}

function extractDistrict(locationText) {
    const location = cleanText(locationText);

    if (!location) {
        return 'Kraków';
    }

    const district = location.replace(/,\s*Krak[óo]w$/i, '').trim();
    return district || 'Kraków';
}

function findOfferList(node) {
    if (!node) {
        return [];
    }

    if (Array.isArray(node)) {
        const directOffers = node.filter((entry) => entry && entry['@type'] === 'Offer');
        if (directOffers.length > 0) {
            return directOffers;
        }

        for (const entry of node) {
            const nestedOffers = findOfferList(entry);
            if (nestedOffers.length > 0) {
                return nestedOffers;
            }
        }

        return [];
    }

    if (typeof node !== 'object') {
        return [];
    }

    for (const value of Object.values(node)) {
        const nestedOffers = findOfferList(value);
        if (nestedOffers.length > 0) {
            return nestedOffers;
        }
    }

    return [];
}

function parseJsonLdOffers(html) {
    const blocks = [];
    const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = regex.exec(html)) !== null) {
        blocks.push(match[1]);
    }

    for (const block of blocks) {
        try {
            const parsed = JSON.parse(block.trim());
            const offers = findOfferList(parsed);

            if (offers.length > 0) {
                return offers;
            }
        } catch (error) {
        }
    }

    return [];
}

function parseTiles(html) {
    const markers = [];
    const regex = /<div class="tile tile-tile[\s\S]*?data-id="([^"]+)"[\s\S]*?data-first-ad="([^"]*)"[\s\S]*?data-market-type="([^"]+)"/g;
    let match;

    while ((match = regex.exec(html)) !== null) {
        markers.push({
            index: match.index,
            tileId: match[1],
            firstAd: match[2],
            marketType: match[3],
        });
    }

    return markers.map((marker, index) => {
        const end = index + 1 < markers.length ? markers[index + 1].index : html.length;
        const slice = html.slice(marker.index, end);
        const nameMatch = slice.match(/id="tertiary-name_\d+"[^>]*>([\s\S]*?)<\/(?:a|span)>/);
        const locationMatch = slice.match(/id="tertiary-province_\d+"[^>]*>([\s\S]*?)<\/p>/);
        const listingMatch = slice.match(/<p class="title-d[^"]*"[^>]*>([\s\S]*?)<\/p>/);
        const urlMatch = slice.match(/<a href="([^"]+\.html(?:\?[^"]*)?)"/);

        return {
            id: marker.tileId,
            firstAd: marker.firstAd,
            marketType: marker.marketType,
            name: cleanText(nameMatch && nameMatch[1]),
            locationText: cleanText(locationMatch && locationMatch[1]),
            listingText: cleanText(listingMatch && listingMatch[1]),
            url: urlMatch ? urlMatch[1] : '',
        };
    });
}

function buildExternalId(tile, url, index) {
    if (tile && tile.firstAd) {
        return `NO-${tile.firstAd}`;
    }

    if (tile && tile.id) {
        return `NO-${tile.id}`;
    }

    if (url) {
        return `NO-${crypto.createHash('md5').update(url).digest('hex')}`;
    }

    return `NO-${index + 1}`;
}

function buildTitle(tile, offer, fallbackId) {
    if (tile && tile.name) {
        return tile.name;
    }

    const offerName = cleanText(offer && offer.name);
    if (offerName && tile && tile.locationText) {
        return `${offerName} - ${tile.locationText}`;
    }

    if (offerName) {
        return offerName;
    }

    if (tile && tile.listingText && tile.locationText) {
        return `${tile.listingText} - ${tile.locationText}`;
    }

    return `Oferta NO: ${fallbackId}`;
}

try {
    for (const item of items) {
        const html = extractHtml(item);
        const offers = parseJsonLdOffers(html);
        const tiles = parseTiles(html);
        const total = Math.max(offers.length, tiles.length);

        if (total === 0) {
            continue;
        }

        for (let index = 0; index < total; index += 1) {
            const offer = offers[index] || {};
            const tile = tiles[index] || {};
            const baseUrl = stripQuery(offer.url || tile.url);
            const locationText = tile.locationText || 'Kraków';

            results.push(classifyOffer({
                external_id: buildExternalId(tile, baseUrl, index),
                url: buildDetailUrl(baseUrl),
                category: 'mieszkanie-krakow',
                title: buildTitle(tile, offer, tile.firstAd || tile.id || index + 1),
                price: toNumber(offer.price),
                price_per_m2: toNumber(offer.priceSpecification && offer.priceSpecification.price),
                area: parseArea(offer.name || tile.listingText),
                lot_size: 0,
                construction_year: 0,
                created_at: new Date().toISOString(),
                property_portal: 'Nieruchomości online',
                location_text: locationText,
                district: extractDistrict(locationText),
                market_type: tile.marketType || '',
                source_offer_id: tile.id || '',
            }));
        }
    }
} catch (error) {
    return [{ json: { error: `Parsing error: ${error.message}` } }];
}

const uniqueMap = new Map();
results.forEach((result) => uniqueMap.set(result.external_id, result));

return Array.from(uniqueMap.values()).map((json) => ({ json }));