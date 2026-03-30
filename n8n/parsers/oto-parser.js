const items = $input.all();
const html = items[0].json.data || "";

const jsonMatch = html.match(/<script\b[^>]*type="application\/json"[^>]*>([\s\S]*?pageProps[\s\S]*?)<\/script>/);

if (!jsonMatch) {
    return [{ json: { error: "Failed to extract JSON with offers" } }];
}

try {
    const fullData = JSON.parse(jsonMatch[1].trim());
    const ads = fullData?.props?.pageProps?.data?.searchAds?.items || 
                fullData?.props?.pageProps?.apolloState?.data?.searchAds?.items || [];

    if (ads.length === 0) return [];

    return ads.map(ad => ({
        json: {
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
            property_portal: 'Otodom'          
        }
    }));

} catch (e) {
    return [{ json: { error: "JSON parsing error: " + e.message } }];
}