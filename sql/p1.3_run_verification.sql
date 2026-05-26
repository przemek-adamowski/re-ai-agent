-- P1.3 verification queries for the latest "Real Estate AI Agent" run.
-- Run individual sections after a manual scheduled execution.
-- 1. Stage metrics overview for the latest run.
WITH latest_run AS (
    SELECT run_id,
        started_at,
        status
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT r.run_id,
    r.started_at,
    r.status,
    m.stage_order,
    m.stage_key,
    m.input_count,
    m.output_count,
    m.dropped_count,
    m.error_count,
    m.metadata
FROM latest_run r
    LEFT JOIN rea_import_run_stage_metrics m ON m.run_id = r.run_id
ORDER BY m.stage_order;
-- 2. Event breakdown by stage, event type, and drop reason.
WITH latest_run AS (
    SELECT run_id
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT stage_order,
    stage_key,
    event_type,
    COALESCE(event_reason, 'ok') AS event_reason,
    COUNT(*) AS cnt
FROM rea_import_run_offer_events
WHERE run_id = (
        SELECT run_id
        FROM latest_run
    )
GROUP BY stage_order,
    stage_key,
    event_type,
    COALESCE(event_reason, 'ok')
ORDER BY stage_order,
    stage_key,
    event_type,
    event_reason;
-- 3. Funnel invariant check for P1.3.
WITH latest_run AS (
    SELECT run_id
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT MAX(
        CASE
            WHEN stage_key = 'parse_list' THEN output_count
        END
    ) AS parse_list_out,
    MAX(
        CASE
            WHEN stage_key = 'fetch_detail' THEN input_count
        END
    ) AS fetch_detail_in,
    MAX(
        CASE
            WHEN stage_key = 'fetch_detail' THEN output_count
        END
    ) AS fetch_detail_out,
    MAX(
        CASE
            WHEN stage_key = 'merge_detail' THEN input_count
        END
    ) AS merge_detail_in,
    MAX(
        CASE
            WHEN stage_key = 'merge_detail' THEN output_count
        END
    ) AS merge_detail_out,
    MAX(
        CASE
            WHEN stage_key = 'validate_before_sql' THEN input_count
        END
    ) AS validate_in,
    MAX(
        CASE
            WHEN stage_key = 'validate_before_sql' THEN output_count
        END
    ) AS validate_out,
    MAX(
        CASE
            WHEN stage_key = 'upsert_offer' THEN input_count
        END
    ) AS upsert_in
FROM rea_import_run_stage_metrics
WHERE run_id = (
        SELECT run_id
        FROM latest_run
    );
-- 4. Dropped offers for fetch_detail and merge_detail.
WITH latest_run AS (
    SELECT run_id
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT stage_key,
    external_id,
    url,
    event_type,
    event_reason,
    payload,
    created_at
FROM rea_import_run_offer_events
WHERE run_id = (
        SELECT run_id
        FROM latest_run
    )
    AND stage_key IN ('fetch_detail', 'merge_detail')
    AND event_type = 'dropped'
ORDER BY stage_order,
    created_at,
    external_id;
-- 5. Focused metrics check for fetch_detail and merge_detail.
WITH latest_run AS (
    SELECT run_id
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT stage_key,
    input_count,
    output_count,
    dropped_count,
    error_count,
    metadata->'drops' AS drops
FROM rea_import_run_stage_metrics
WHERE run_id = (
        SELECT run_id
        FROM latest_run
    )
    AND stage_key IN ('fetch_detail', 'merge_detail');
