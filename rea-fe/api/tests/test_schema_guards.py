import os
import uuid
import unittest

import asyncpg

from main import ensure_schema


class SchemaGuardsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.conn = await asyncpg.connect(
            user=os.getenv("POSTGRES_USER", "re_ai_agent_sql_user"),
            password=os.getenv("POSTGRES_PASSWORD", "czubata.26.reaia"),
            database=os.getenv("POSTGRES_DB", "re_ai_agent_data"),
            host=os.getenv("POSTGRES_HOST", "postgres"),
            port=5432,
        )
        await ensure_schema(self.conn)
        self.created_ids: list[str] = []

    async def asyncTearDown(self) -> None:
        if self.created_ids:
            await self.conn.execute(
                "DELETE FROM rea_offer_audit_log WHERE external_id = ANY($1::text[])",
                self.created_ids,
            )
            await self.conn.execute(
                "DELETE FROM rea_property_offers WHERE external_id = ANY($1::text[])",
                self.created_ids,
            )
        await self.conn.close()

    async def _insert_offer(self, external_id: str, title: str, user_rating: str = "pending", user_grade: int | None = None) -> None:
        self.created_ids.append(external_id)
        await self.conn.execute(
            """
            INSERT INTO rea_property_offers (
                external_id,
                category,
                url,
                title,
                user_rating,
                user_grade,
                ai_analysis_html
            ) VALUES ($1, 'test', $2, $3, $4, $5, '<p>test</p>')
            """,
            external_id,
            f"https://example.com/{external_id}",
            title,
            user_rating,
            user_grade,
        )

    async def test_backfill_corrects_legacy_rating_mismatch(self) -> None:
        external_id = f"TEST-GRADE-{uuid.uuid4().hex[:12]}"
        await self._insert_offer(external_id, "Grade backfill test", user_rating="strong_like", user_grade=3)

        await ensure_schema(self.conn)

        corrected_grade = await self.conn.fetchval(
            "SELECT user_grade FROM rea_property_offers WHERE external_id = $1",
            external_id,
        )
        self.assertEqual(corrected_grade, 5)

    async def test_trigger_preserves_non_empty_title_on_blank_update(self) -> None:
        external_id = f"TEST-TITLE-{uuid.uuid4().hex[:12]}"
        original_title = "Oferta testowa: poprawny tytul"
        await self._insert_offer(external_id, original_title)

        await self.conn.execute(
            "UPDATE rea_property_offers SET title = '' WHERE external_id = $1",
            external_id,
        )

        current_title = await self.conn.fetchval(
            "SELECT title FROM rea_property_offers WHERE external_id = $1",
            external_id,
        )
        self.assertEqual(current_title, original_title)


if __name__ == "__main__":
    unittest.main()
