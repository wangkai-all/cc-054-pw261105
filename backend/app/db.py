"""SQLite 持久化：方案与输入快照。"""
import json
import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("PACING_DB", Path(__file__).resolve().parent.parent / "data" / "pacing.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS simulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    carryover_enabled INTEGER NOT NULL,
    days INTEGER NOT NULL,
    base_budget_cents INTEGER NOT NULL,
    units_json TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    pauses_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    total_budget_cents INTEGER NOT NULL DEFAULT 0,
    total_spend_cents INTEGER NOT NULL DEFAULT 0,
    total_impressions INTEGER NOT NULL DEFAULT 0
);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(SCHEMA)
    return conn


def save_simulation(payload: dict, totals: dict) -> int:
    conn = connect()
    try:
        cur = conn.execute(
            """INSERT INTO simulations
               (title, carryover_enabled, days, base_budget_cents, units_json,
                profile_json, pauses_json, total_budget_cents,
                total_spend_cents, total_impressions)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload["title"],
                1 if payload["carryover_enabled"] else 0,
                payload["days"],
                payload["base_budget_cents"],
                json.dumps(payload["units"], ensure_ascii=False),
                json.dumps(payload["profile"], ensure_ascii=False),
                json.dumps(payload["pauses"], ensure_ascii=False),
                totals["total_budget_cents"],
                totals["total_spend_cents"],
                totals["total_impressions"],
            ),
        )
        conn.commit()
        return int(cur.lastrowid)
    finally:
        conn.close()


def list_simulations(limit: int = 10) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT id, title, carryover_enabled, days, base_budget_cents,
                      total_budget_cents, total_spend_cents, total_impressions,
                      created_at
               FROM simulations ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
