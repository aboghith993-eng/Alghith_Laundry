"""تصدير الكشف من قاعدة الإنتاج إلى ملف Seed داخل تطبيق الجوال.

يكتب الملف ``laundry_mobile_project/assets/seed_roster.json`` بنفس بنية لقطة
الخادم، ليُحمَّل تلقائياً عند أول تشغيل قبل أول مزامنة (مثل تطبيق رحلات السائقين).

الاستخدام:
    $env:DATABASE_URL = "<رابط Supabase>"
    .venv\\Scripts\\python.exe export_seed.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
OUTPUT = BASE_DIR / "laundry_mobile_project" / "assets" / "seed_roster.json"

EMPLOYEE_COLUMNS = (
    "id",
    "employee_code",
    "name",
    "company",
    "department",
    "phone",
    "person_type",
    "active",
    "notes",
    "service_type",
    "shift_system",
    "shift_description",
    "work_days",
    "rest_days",
    "cycle_start",
    "cycle_anchor",
    "cycle_day",
    "status_label",
    "departure_time",
    "housing_location",
    "job_title",
    "gender",
    "transport_class",
)


def open_connection() -> tuple[object, object]:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        import psycopg
        from psycopg.rows import dict_row

        conn = psycopg.connect(url, row_factory=dict_row, sslmode="require", prepare_threshold=None)
        return conn, lambda sql: sql.replace("?", "%s")
    import sqlite3

    path = Path(os.environ.get("DATABASE_PATH", str(BASE_DIR / "instance" / "laundry.db")))
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn, lambda sql: sql


def json_row(row: dict[str, object]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in row.items():
        if isinstance(value, bool):
            result[key] = value
        elif isinstance(value, datetime):
            result[key] = value.isoformat(timespec="seconds")
        elif isinstance(value, date):
            result[key] = value.isoformat()
        else:
            result[key] = value
    return result


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    conn, translate = open_connection()
    employees = [
        json_row(dict(row))
        for row in conn.execute(
            f"SELECT {', '.join(EMPLOYEE_COLUMNS)} FROM employees ORDER BY employee_code"
        ).fetchall()
    ]
    for employee in employees:
        employee["active"] = bool(employee.get("active"))
    items = [
        json_row(dict(row))
        for row in conn.execute(
            "SELECT id, code, name, unit, rate, active FROM service_items ORDER BY name"
        ).fetchall()
    ]
    for item in items:
        item["active"] = bool(item.get("active"))
    settings = {
        row["key"]: row["value"]
        for row in conn.execute("SELECT key, value FROM settings").fetchall()
    }
    conn.close()

    payload = {
        "version": 4,
        "source": "bundled-seed",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "employees": employees,
        "service_items": items,
        "settings": settings,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"تم تصدير {len(employees)} موظفاً و{len(items)} صنفاً إلى: {OUTPUT}")
    print(f"حجم الملف: {OUTPUT.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
