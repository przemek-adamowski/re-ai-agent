import os
import unittest

import asyncpg
from fastapi import HTTPException

from main import get_import_run, get_import_run_events, get_import_run_new_pending, list_import_runs


class _PoolAcquire:
    def __init__(self, conn: asyncpg.Connection) -> None:
        self.conn = conn

    async def __aenter__(self) -> asyncpg.Connection:
        return self.conn

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class _PoolWrapper:
    def __init__(self, conn: asyncpg.Connection) -> None:
        self.conn = conn

    def acquire(self) -> _PoolAcquire:
        return _PoolAcquire(self.conn)


class _State:
    def __init__(self, pool: _PoolWrapper) -> None:
        self.pool = pool


class _AppStub:
    def __init__(self, conn: asyncpg.Connection) -> None:
        self.state = _State(_PoolWrapper(conn))


class ImportRunsApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.conn = await asyncpg.connect(
            user=os.getenv("POSTGRES_USER", "re_ai_agent_sql_user"),
            password=os.getenv("POSTGRES_PASSWORD", "czubata.26.reaia"),
            database=os.getenv("POSTGRES_DB", "re_ai_agent_data"),
            host=os.getenv("POSTGRES_HOST", "postgres"),
            port=5432,
        )
        await self.conn.execute(
            """
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
            CREATE TABLE IF NOT EXISTS rea_property_offers (
                external_id TEXT PRIMARY KEY,
                category TEXT,
                url TEXT NOT NULL,
                title TEXT,
                price NUMERIC,
                price_per_m2 NUMERIC,
                area NUMERIC,
                lot_size NUMERIC,
                construction_year INTEGER,
                ai_rating INTEGER,
                ai_analysis_html TEXT,
                user_rating TEXT DEFAULT 'pending',
                user_grade SMALLINT,
                user_notes TEXT,
                user_rated_at TIMESTAMP,
                property_portal TEXT,
                district TEXT,
                location_text TEXT,
                geo_status TEXT DEFAULT 'unknown',
                geo_confidence TEXT DEFAULT 'low',
                geo_reason TEXT,
                policy_version TEXT,
                is_soft_blocked BOOLEAN DEFAULT FALSE,
                is_in_trash BOOLEAN DEFAULT FALSE,
                needs_manual_review BOOLEAN DEFAULT FALSE,
                is_exception_candidate BOOLEAN DEFAULT FALSE,
                review_status TEXT DEFAULT 'not_needed',
                review_reason TEXT,
                reviewed_by TEXT,
                reviewed_at TIMESTAMP,
                pre_trash_review_status TEXT,
                excluded_from_feedback_loop BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_at TIMESTAMP
            );
            """
        )
        self.previous_app = getattr(__import__("main"), "app")
        __import__("main").app = _AppStub(self.conn)

        self.run_ids = ["TEST-RUN-API-001", "TEST-RUN-API-002"]
        self.offer_ids = ["TEST-OFFER-001", "TEST-OFFER-002"]
        await self.conn.execute(
            "DELETE FROM rea_import_run_offer_events WHERE run_id = ANY($1::text[])",
            self.run_ids,
        )
        await self.conn.execute(
            "DELETE FROM rea_import_run_stage_metrics WHERE run_id = ANY($1::text[])",
            self.run_ids,
        )
        await self.conn.execute(
            "DELETE FROM rea_property_offers WHERE external_id = ANY($1::text[])",
            self.offer_ids,
        )
        await self.conn.execute(
            "DELETE FROM rea_import_runs WHERE run_id = ANY($1::text[])",
            self.run_ids,
        )

        await self.conn.execute(
            """
            INSERT INTO rea_import_runs (
                run_id, workflow_name, workflow_version, trigger_source, started_at, finished_at, status, summary
            ) VALUES
                ('TEST-RUN-API-001', 'Real Estate AI Agent', '1.6.0', 'schedule', NOW() - INTERVAL '2 minute', NOW() - INTERVAL '1 minute', 'completed', '{"entered_workflow": 4, "validated_for_sql": 4}'::jsonb),
                ('TEST-RUN-API-002', 'Real Estate AI Agent', '1.6.0', 'backfill', NOW() - INTERVAL '4 minute', NOW() - INTERVAL '3 minute', 'completed', '{"entered_workflow": 2, "validated_for_sql": 2}'::jsonb)
            """
        )
        await self.conn.execute(
            """
            INSERT INTO rea_import_run_stage_metrics (
                run_id, stage_key, stage_order, input_count, output_count, dropped_count, error_count, duration_ms, metadata
            ) VALUES
                ('TEST-RUN-API-001', 'parse_list', 1, 4, 4, 0, 0, 125, '{"by_portal": {"otodom": 4}}'::jsonb),
                ('TEST-RUN-API-001', 'validate_before_sql', 4, 4, 4, 0, 0, 80, '{"drops": {}}'::jsonb)
            ON CONFLICT (run_id, stage_key) DO UPDATE SET
                input_count = EXCLUDED.input_count,
                output_count = EXCLUDED.output_count,
                dropped_count = EXCLUDED.dropped_count,
                error_count = EXCLUDED.error_count,
                duration_ms = EXCLUDED.duration_ms,
                metadata = EXCLUDED.metadata
            """
        )
        await self.conn.execute(
            """
            INSERT INTO rea_property_offers (
                external_id, category, url, title, price, price_per_m2, area, ai_rating, user_rating, property_portal, district, review_status, created_at
            ) VALUES
                ('TEST-OFFER-001', 'test', 'https://example.com/1', 'Pending review offer', 1000000, 10000, 100, 8, 'pending', 'Otodom', 'Debniki', 'pending', NOW() - INTERVAL '10 minute'),
                ('TEST-OFFER-002', 'test', 'https://example.com/2', 'Existing active offer', 900000, 9000, 100, 7, 'pending', 'Otodom', 'Debniki', 'not_needed', NOW() - INTERVAL '20 minute')
            ON CONFLICT (external_id) DO UPDATE SET
                title = EXCLUDED.title,
                review_status = EXCLUDED.review_status,
                created_at = EXCLUDED.created_at
            """
        )
        await self.conn.execute(
            """
            INSERT INTO rea_import_run_offer_events (
                run_id, stage_key, stage_order, external_id, url, event_type, event_reason, is_new_offer, review_status, payload, created_at
            ) VALUES
                ('TEST-RUN-API-001', 'parse_list', 1, 'TEST-OFFER-001', 'https://example.com/1', 'entered', NULL, TRUE, NULL, '{"portal":"otodom"}'::jsonb, NOW() - INTERVAL '90 second'),
                ('TEST-RUN-API-001', 'validate_before_sql', 4, 'TEST-OFFER-001', 'https://example.com/1', 'passed', NULL, TRUE, NULL, '{"validator":"ok"}'::jsonb, NOW() - INTERVAL '70 second'),
                ('TEST-RUN-API-001', 'final_policy_state', 6, 'TEST-OFFER-001', 'https://example.com/1', 'final_state', 'pending', TRUE, 'pending', '{"ai_rating":8}'::jsonb, NOW() - INTERVAL '50 second'),
                ('TEST-RUN-API-001', 'final_policy_state', 6, 'TEST-OFFER-002', 'https://example.com/2', 'final_state', 'not_needed', FALSE, 'not_needed', '{"ai_rating":7}'::jsonb, NOW() - INTERVAL '40 second')
            """
        )

    async def asyncTearDown(self) -> None:
        await self.conn.execute(
            "DELETE FROM rea_import_run_offer_events WHERE run_id = ANY($1::text[])",
            self.run_ids,
        )
        await self.conn.execute(
            "DELETE FROM rea_import_run_stage_metrics WHERE run_id = ANY($1::text[])",
            self.run_ids,
        )
        await self.conn.execute(
            "DELETE FROM rea_property_offers WHERE external_id = ANY($1::text[])",
            self.offer_ids,
        )
        await self.conn.execute(
            "DELETE FROM rea_import_runs WHERE run_id = ANY($1::text[])",
            self.run_ids,
        )
        __import__("main").app = self.previous_app
        await self.conn.close()

    async def test_list_import_runs_returns_runs_sorted_desc(self) -> None:
        result = await list_import_runs(limit=1)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["run_id"], "TEST-RUN-API-001")
        self.assertEqual(result[0]["summary"]["entered_workflow"], 4)

    async def test_list_import_runs_filters_by_trigger_source(self) -> None:
        result = await list_import_runs(limit=50, trigger_source="backfill")

        run_ids = [item["run_id"] for item in result]
        self.assertIn("TEST-RUN-API-002", run_ids)
        self.assertNotIn("TEST-RUN-API-001", run_ids)
        self.assertTrue(all(item["trigger_source"] == "backfill" for item in result))

    async def test_get_import_run_returns_run_and_stage_metrics(self) -> None:
        result = await get_import_run("TEST-RUN-API-001")

        self.assertEqual(result["run"]["run_id"], "TEST-RUN-API-001")
        self.assertEqual(result["run"]["summary"]["validated_for_sql"], 4)
        self.assertEqual(len(result["stage_metrics"]), 2)
        self.assertEqual(result["stage_metrics"][0]["stage_key"], "parse_list")
        self.assertEqual(result["stage_metrics"][0]["metadata"]["by_portal"]["otodom"], 4)

    async def test_get_import_run_raises_404_for_missing_run(self) -> None:
        with self.assertRaises(HTTPException) as context:
            await get_import_run("TEST-RUN-API-MISSING")

        self.assertEqual(context.exception.status_code, 404)

    async def test_get_import_run_events_filters_and_paginates(self) -> None:
        result = await get_import_run_events("TEST-RUN-API-001", stage_key="final_policy_state", event_type="final_state", limit=1, offset=0)

        self.assertEqual(result["total"], 2)
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["events"][0]["stage_key"], "final_policy_state")
        self.assertEqual(result["events"][0]["event_type"], "final_state")

    async def test_get_import_run_new_pending_returns_only_new_pending_offers(self) -> None:
        result = await get_import_run_new_pending("TEST-RUN-API-001")

        self.assertEqual([item["external_id"] for item in result], ["TEST-OFFER-001"])
        self.assertEqual(result[0]["review_status"], "pending")

    async def test_get_import_run_events_raises_404_for_missing_run(self) -> None:
        with self.assertRaises(HTTPException) as context:
            await get_import_run_events("TEST-RUN-API-MISSING")

        self.assertEqual(context.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
