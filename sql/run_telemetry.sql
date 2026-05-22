CREATE TABLE IF NOT EXISTS rea_import_runs (
    run_id TEXT PRIMARY KEY,
    workflow_name TEXT NOT NULL,
    workflow_version TEXT,
    trigger_source TEXT NOT NULL DEFAULT 'schedule',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    portal_scope TEXT,
    notes TEXT,
    raw_execution_id TEXT,
    summary JSONB
);
CREATE INDEX IF NOT EXISTS idx_rea_import_runs_started_at ON rea_import_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rea_import_runs_status ON rea_import_runs (status);
CREATE TABLE IF NOT EXISTS rea_import_run_stage_metrics (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES rea_import_runs(run_id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    stage_order INTEGER NOT NULL,
    input_count INTEGER NOT NULL DEFAULT 0,
    output_count INTEGER NOT NULL DEFAULT 0,
    dropped_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(run_id, stage_key)
);
CREATE INDEX IF NOT EXISTS idx_stage_metrics_run ON rea_import_run_stage_metrics (run_id, stage_order);
CREATE TABLE IF NOT EXISTS rea_import_run_offer_events (
    id BIGSERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES rea_import_runs(run_id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    stage_order INTEGER,
    external_id TEXT,
    url TEXT,
    event_type TEXT NOT NULL,
    event_reason TEXT,
    is_new_offer BOOLEAN,
    review_status TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_run_events_run_stage ON rea_import_run_offer_events (run_id, stage_key);
CREATE INDEX IF NOT EXISTS idx_run_events_external_id ON rea_import_run_offer_events (external_id);
CREATE INDEX IF NOT EXISTS idx_run_events_event_type ON rea_import_run_offer_events (run_id, event_type);
