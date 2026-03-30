const items = $input.all();
const results = [];

for (const item of items) {
    // 1. Try to get HTML from various possible locations in n8n
    let html = "";
    
    if (item.binary && item.binary.data) {
        // If configured as "File"
        html = Buffer.from(item.binary.data.data, 'base64').toString('utf-8');
    } else if (typeof item.json === 'string') {
        html = item.json;
    } else if (item.json && item.json.data) {
        html = item.json.data;
    } else {
        // Last resort: convert everything received to text
        html = JSON.stringify(item.json);
    }

    // 2. Search for offer links (format: /something/8digitnumber.html)
    // Using wider ID range (7-10 digits) as numbers keep growing
    const regex = /href="([^"]+?\/(\d{7,10})\.html)"/g; 
    let match;

    while ((match = regex.exec(html)) !== null) {
        let rawUrl = match[1];
        const id = match[2];

        // 3. Build full, correct URL with ?i parameter
        const fullUrl = rawUrl.startsWith('http') 
            ? rawUrl 
            : `https://www.nieruchomosci-online.pl${rawUrl}`;

        results.push({
            external_id: `NO-${id}`,
            url: fullUrl + "?i",
            category: "mieszkanie-krakow",
            title: `Oferta NO: ${id}`,
            price: 0,
            price_per_m2: 0,
            area: 0,
            lot_size: 0,
            construction_year: 0,
            created_at: new Date().toISOString(),
            property_portal: 'Nieruchomości online'
        });
    }
}

// 4. Remove duplicates by ID
const uniqueMap = new Map();
results.forEach(res => uniqueMap.set(res.external_id, res));

return Array.from(uniqueMap.values()).map(json => ({ json }));