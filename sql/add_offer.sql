INSERT INTO rea_property_offers (
    external_id,        -- $1
    category,           -- $2
    url,                -- $3
    title,              -- $4
    price,              -- $5
    price_per_m2,       -- $6
    area,               -- $7
    lot_size,           -- $8
    construction_year,  -- $9
    ai_rating, 
    user_rating,
    user_notes,
    created_at,         -- $10
    last_seen_at        -- $10
) VALUES (
    $1, 
    $2, 
    $3, 
    $4, 
    $5, 
    $6, 
    $7, 
    $8, 
    $9, 
    0,                  -- ai_rating (domyślnie)
    'pending',          -- user_rating (domyślnie)
    NULL,               -- user_notes
    $10::timestamp, 
    $10::timestamp
) 
ON CONFLICT (external_id) DO NOTHING
RETURNING *;

{{ $json.external_id }},
{{ $json.category }},
{{ $json.url }},
{{ $json.title }},
{{ Number($json.price) || 0 }},
{{ Number($json.price_per_m2) || 0 }},
{{ Number($json.area) || 0 }},
{{ $json.lot_size || null }},
{{ $json.construction_year || null }},
{{ $json.created_at || new Date().toISOString() }}