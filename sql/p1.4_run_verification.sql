-- P1.4 verification queries for the latest "Real Estate AI Agent" run.
-- Run after a scheduled execution on workflow version 1.6.0 or newer.
-- 1. Run row with frozen summary.
WITH latest_run AS (
    SELECT run_id,
        started_at,
        finished_at,
        status,
        workflow_version,
        summary
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT *
FROM latest_run;
-- 2. Final policy stage metrics.
WITH latest_run AS (
    SELECT run_id
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT stage_order,
    stage_key,
    input_count,
    output_count,
    dropped_count,
    error_count,
    metadata
FROM rea_import_run_stage_metrics
WHERE run_id = (
        SELECT run_id
        FROM latest_run
    )
    AND stage_key = 'final_policy_state';
-- 3. Final policy event breakdown by review state.
WITH latest_run AS (
    SELECT run_id
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT review_status,
    is_new_offer,
    COUNT(*) AS cnt
FROM rea_import_run_offer_events
WHERE run_id = (
        SELECT run_id
        FROM latest_run
    )
    AND stage_key = 'final_policy_state'
GROUP BY review_status,
    is_new_offer
ORDER BY review_status,
    is_new_offer;
-- 4. New offers that ended in review queue.
WITH latest_run AS (
    SELECT run_id
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
)
SELECT external_id,
    url,
    review_status,
    is_new_offer,
    payload,
    created_at
FROM rea_import_run_offer_events
WHERE run_id = (
        SELECT run_id
        FROM latest_run
    )
    AND stage_key = 'final_policy_state'
    AND is_new_offer = TRUE
    AND review_status = 'pending'
ORDER BY created_at DESC,
    external_id;
-- 5. Summary cross-check against stage metrics.
WITH latest_run AS (
    SELECT run_id,
        summary
    FROM rea_import_runs
    WHERE workflow_name = 'Real Estate AI Agent'
    ORDER BY started_at DESC
    LIMIT 1
), stage_metrics AS (
    SELECT stage_key,
        output_count,
        dropped_count,
        metadata
    FROM rea_import_run_stage_metrics
    WHERE run_id = (
            SELECT run_id
            FROM latest_run
        )
)
SELECT (
        SELECT summary->>'entered_workflow'
        FROM latest_run
    ) AS summary_entered_workflow,
    (
        SELECT output_count::text
        FROM stage_metrics
        WHERE stage_key = 'parse_list'
    ) AS metrics_parse_list_out,
    (
        SELECT summary->>'validated_for_sql'
        FROM latest_run
    ) AS summary_validated_for_sql,
    (
        SELECT output_count::text
        FROM stage_metrics
        WHERE stage_key = 'validate_before_sql'
    ) AS metrics_validate_out,
    (
        SELECT summary->>'inserted_new'
        FROM latest_run
    ) AS summary_inserted_new,
    (
        SELECT metadata->>'inserted'
        FROM stage_metrics
        WHERE stage_key = 'upsert_offer'
    ) AS metrics_inserted_new,
    (
        SELECT summary->>'updated_existing'
        FROM latest_run
    ) AS summary_updated_existing,
    (
        SELECT metadata->>'updated'
        FROM stage_metrics
        WHERE stage_key = 'upsert_offer'
    ) AS metrics_updated_existing,
    (
        SELECT summary->>'new_to_review'
        FROM latest_run
    ) AS summary_new_to_review,
    (
        SELECT metadata->>'new_pending_review'
        FROM stage_metrics
        WHERE stage_key = 'final_policy_state'
    ) AS metrics_new_to_review;
