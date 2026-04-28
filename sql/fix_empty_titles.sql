-- Repair empty offer titles without manual edits.
-- Strategy:
-- 1) Restore from audit history when a non-empty title existed in the past.
-- 2) For remaining rows, generate a fallback title from URL slug.
-- Step 1: restore last known non-empty title from audit log.
WITH latest_non_empty_title AS (
    SELECT DISTINCT ON (external_id) external_id,
        NULLIF(BTRIM(new_values->>'title'), '') AS recovered_title
    FROM rea_offer_audit_log
    WHERE NULLIF(BTRIM(new_values->>'title'), '') IS NOT NULL
    ORDER BY external_id,
        created_at DESC,
        id DESC
)
UPDATE rea_property_offers AS o
SET title = t.recovered_title
FROM latest_non_empty_title AS t
WHERE o.external_id = t.external_id
    AND NULLIF(BTRIM(o.title), '') IS NULL;
-- Step 2: generate fallback title from URL when title is still empty.
WITH generated AS (
    SELECT external_id,
        CASE
            WHEN external_id LIKE 'OT-%' THEN 'Oferta OT: ' || INITCAP(
                REGEXP_REPLACE(
                    REPLACE(
                        COALESCE(
                            NULLIF(
                                SUBSTRING(
                                    url
                                    FROM '.*/([^/]+)-ID[^/]*$'
                                ),
                                ''
                            ),
                            NULLIF(
                                SUBSTRING(
                                    url
                                    FROM '.*/([^/]+)$'
                                ),
                                ''
                            ),
                            external_id
                        ),
                        ',',
                        ' '
                    ),
                    '[-_]+',
                    ' ',
                    'g'
                )
            )
            WHEN external_id LIKE 'NO-%' THEN 'Oferta NO: ' || INITCAP(
                REGEXP_REPLACE(
                    REPLACE(
                        COALESCE(
                            NULLIF(
                                SUBSTRING(
                                    url
                                    FROM '.*/([^/]+)/[0-9]+\\.html$'
                                ),
                                ''
                            ),
                            NULLIF(
                                SUBSTRING(
                                    url
                                    FROM '.*/([^/]+)$'
                                ),
                                ''
                            ),
                            external_id
                        ),
                        ',',
                        ' '
                    ),
                    '[-_]+',
                    ' ',
                    'g'
                )
            )
            ELSE 'Oferta: ' || external_id
        END AS generated_title
    FROM rea_property_offers
    WHERE NULLIF(BTRIM(title), '') IS NULL
)
UPDATE rea_property_offers AS o
SET title = g.generated_title
FROM generated AS g
WHERE o.external_id = g.external_id
    AND NULLIF(BTRIM(o.title), '') IS NULL
    AND NULLIF(BTRIM(g.generated_title), '') IS NOT NULL;
-- Verification query.
-- SELECT external_id, title, url
-- FROM rea_property_offers
-- WHERE NULLIF(BTRIM(title), '') IS NULL
-- ORDER BY external_id;
