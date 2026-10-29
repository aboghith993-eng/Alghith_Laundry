from __future__ import annotations

import csv
import io
import os
import secrets
import sqlite3
import time

import psycopg
from psycopg.rows import dict_row
from datetime import date, datetime
from functools import wraps
from pathlib import Path
from typing import Any, Callable

from flask import (
    Flask, abort, flash, g, make_response, redirect, render_template,
    request, send_from_directory, session, url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
# ملفات واجهة تطبيق الجوال (نفس المصدر المُحزَّم داخل Android عبر Capacitor).
MOBILE_WWW_DIR = BASE_DIR / "mobile" / "www"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
DB_PATH = Path(os.environ.get("DATABASE_PATH", str(INSTANCE_DIR / "laundry.db")))
if not DATABASE_URL:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)


class PostgresConnection:
    """Small compatibility adapter so the same application can use SQLite locally
    and Supabase PostgreSQL in production. SQL placeholders are translated safely.
    """
    def __init__(self, dsn: str):
        self.raw = psycopg.connect(dsn, row_factory=dict_row, prepare_threshold=None, sslmode="require")

    @staticmethod
    def _sql(sql: str) -> str:
        # The app uses positional ? placeholders throughout; its SQL contains no
        # question-mark operators or literal question marks.
        return sql.replace("?", "%s")

    def execute(self, sql: str, params: Any = ()) -> Any:
        return self.raw.execute(self._sql(sql), params or ())

    def executemany(self, sql: str, params: Any) -> Any:
        with self.raw.cursor() as cur:
            cur.executemany(self._sql(sql), params)
            return cur

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        self.raw.close()




def persistent_secret() -> str:
    env_secret = os.environ.get("SECRET_KEY")
    if env_secret:
        return env_secret
    if DATABASE_URL:
        raise RuntimeError("عيّن SECRET_KEY عشوائياً في متغيرات Render قبل تشغيل النظام.")
    path = INSTANCE_DIR / ".secret_key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


app = Flask(__name__)
app.config.update(
    SECRET_KEY=persistent_secret(),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=bool(DATABASE_URL),
    MAX_CONTENT_LENGTH=4 * 1024 * 1024,
)

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin','admin','contractor','supervisor')),
    active INTEGER NOT NULL DEFAULT 1,
    company_id INTEGER REFERENCES companies(id),
    system_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    employee_code TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    person_type TEXT NOT NULL DEFAULT 'company' CHECK (person_type IN ('company','general')),
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    service_type TEXT NOT NULL DEFAULT '',
    shift_system TEXT NOT NULL DEFAULT '',
    shift_description TEXT NOT NULL DEFAULT '',
    work_days INTEGER NOT NULL DEFAULT 0,
    rest_days INTEGER NOT NULL DEFAULT 0,
    cycle_start TEXT NOT NULL DEFAULT '',
    cycle_anchor TEXT NOT NULL DEFAULT '',
    cycle_day INTEGER NOT NULL DEFAULT 0,
    status_label TEXT NOT NULL DEFAULT '',
    departure_time TEXT NOT NULL DEFAULT '',
    housing_location TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    transport_class TEXT NOT NULL DEFAULT '',
    UNIQUE (company_id, employee_code)
);
CREATE TABLE IF NOT EXISTS service_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'قطعة',
    rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS laundry_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    reference TEXT UNIQUE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    person_name TEXT NOT NULL DEFAULT '',
    service_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','delivered')),
    delivered_at TEXT,
    delivered_by INTEGER REFERENCES users(id),
    subtotal REAL NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by INTEGER REFERENCES users(id),
    confirmed_at TEXT,
    rejection_reason TEXT NOT NULL DEFAULT '',
    client_uuid TEXT,
    receiver_kind TEXT NOT NULL DEFAULT '' CHECK (receiver_kind IN ('','same_employee','other')),
    receiver_name TEXT NOT NULL DEFAULT '',
    received_at TEXT
);
CREATE TABLE IF NOT EXISTS laundry_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    service_item_id INTEGER REFERENCES service_items(id),
    item_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    line_total REAL NOT NULL CHECK (line_total >= 0),
    received_quantity REAL
);
CREATE TABLE IF NOT EXISTS laundry_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    order_id INTEGER NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    receiver_kind TEXT NOT NULL DEFAULT 'same_employee' CHECK (receiver_kind IN ('same_employee','other')),
    receiver_name TEXT NOT NULL DEFAULT '',
    received_by INTEGER REFERENCES users(id),
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS laundry_receipt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id INTEGER NOT NULL REFERENCES laundry_receipts(id) ON DELETE CASCADE,
    order_item_id INTEGER NOT NULL REFERENCES laundry_order_items(id) ON DELETE CASCADE,
    quantity REAL NOT NULL CHECK (quantity > 0)
);
CREATE TABLE IF NOT EXISTS settings (
    company_id INTEGER NOT NULL REFERENCES companies(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (company_id, key)
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON laundry_orders(company_id, service_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON laundry_orders(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_uuid ON laundry_orders(company_id, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order ON laundry_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_order ON laundry_receipts(company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON laundry_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
"""

POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin','admin','contractor','supervisor')),
    active SMALLINT NOT NULL DEFAULT 1,
    company_id BIGINT REFERENCES companies(id),
    system_admin SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    employee_code TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    person_type TEXT NOT NULL DEFAULT 'company' CHECK (person_type IN ('company','general')),
    active SMALLINT NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    service_type TEXT NOT NULL DEFAULT '',
    shift_system TEXT NOT NULL DEFAULT '',
    shift_description TEXT NOT NULL DEFAULT '',
    work_days INTEGER NOT NULL DEFAULT 0,
    rest_days INTEGER NOT NULL DEFAULT 0,
    cycle_start TEXT NOT NULL DEFAULT '',
    cycle_anchor TEXT NOT NULL DEFAULT '',
    cycle_day INTEGER NOT NULL DEFAULT 0,
    status_label TEXT NOT NULL DEFAULT '',
    departure_time TEXT NOT NULL DEFAULT '',
    housing_location TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    transport_class TEXT NOT NULL DEFAULT '',
    UNIQUE (company_id, employee_code)
);
CREATE TABLE IF NOT EXISTS service_items (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'قطعة',
    rate DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (rate >= 0),
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS laundry_orders (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    reference TEXT UNIQUE,
    employee_id BIGINT NOT NULL REFERENCES employees(id),
    person_name TEXT NOT NULL DEFAULT '',
    service_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','delivered')),
    delivered_at TIMESTAMPTZ,
    delivered_by BIGINT REFERENCES users(id),
    subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by BIGINT REFERENCES users(id),
    confirmed_at TIMESTAMPTZ,
    rejection_reason TEXT NOT NULL DEFAULT '',
    client_uuid TEXT,
    receiver_kind TEXT NOT NULL DEFAULT '' CHECK (receiver_kind IN ('','same_employee','other')),
    receiver_name TEXT NOT NULL DEFAULT '',
    received_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS laundry_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    service_item_id BIGINT REFERENCES service_items(id),
    item_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_price DOUBLE PRECISION NOT NULL CHECK (unit_price >= 0),
    line_total DOUBLE PRECISION NOT NULL CHECK (line_total >= 0),
    received_quantity DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS laundry_receipts (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    order_id BIGINT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    receiver_kind TEXT NOT NULL DEFAULT 'same_employee' CHECK (receiver_kind IN ('same_employee','other')),
    receiver_name TEXT NOT NULL DEFAULT '',
    received_by BIGINT REFERENCES users(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS laundry_receipt_items (
    id BIGSERIAL PRIMARY KEY,
    receipt_id BIGINT NOT NULL REFERENCES laundry_receipts(id) ON DELETE CASCADE,
    order_item_id BIGINT NOT NULL REFERENCES laundry_order_items(id) ON DELETE CASCADE,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0)
);
CREATE TABLE IF NOT EXISTS settings (
    company_id BIGINT NOT NULL REFERENCES companies(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (company_id, key)
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON laundry_orders(company_id, service_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON laundry_orders(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_uuid ON laundry_orders(company_id, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order ON laundry_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_order ON laundry_receipts(company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON laundry_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
"""

SEED_SERVICES = [
    ("WASH_CLOTHES", "غسل ملابس الموظفين", "كيلوجرام", 0),
    ("IRON_CLOTHES", "كي الملابس", "قطعة", 0),
    ("WASH_IRON", "غسل وكي الملابس", "قطعة", 0),
    ("BED_SHEET", "غسل ملاية سرير", "قطعة", 0),
    ("PILLOW_CASE", "غسل لباس مخدة", "قطعة", 0),
    ("BLANKET", "غسل بطانية", "قطعة", 0),
    ("OTHER", "خدمة أخرى", "قطعة", 0),
]

# أعمدة بيانات الدوام ونوع الخدمة المستمدة من كشف الموظفين.
# cycle_anchor هو تاريخ إسناد الدورة: به يُحسب يوم الدورة لأي تاريخ لاحق.
EMPLOYEE_SHIFT_COLUMNS = (
    ("service_type", "TEXT NOT NULL DEFAULT ''"),
    ("shift_system", "TEXT NOT NULL DEFAULT ''"),
    ("shift_description", "TEXT NOT NULL DEFAULT ''"),
    ("work_days", "INTEGER NOT NULL DEFAULT 0"),
    ("rest_days", "INTEGER NOT NULL DEFAULT 0"),
    ("cycle_start", "TEXT NOT NULL DEFAULT ''"),
    ("cycle_anchor", "TEXT NOT NULL DEFAULT ''"),
    ("cycle_day", "INTEGER NOT NULL DEFAULT 0"),
    ("status_label", "TEXT NOT NULL DEFAULT ''"),
    ("departure_time", "TEXT NOT NULL DEFAULT ''"),
    ("housing_location", "TEXT NOT NULL DEFAULT ''"),
    ("job_title", "TEXT NOT NULL DEFAULT ''"),
    ("gender", "TEXT NOT NULL DEFAULT ''"),
    ("transport_class", "TEXT NOT NULL DEFAULT ''"),
)


#: الشركة الافتراضية التي تُنقل إليها البيانات القائمة عند أول ترقية.
DEFAULT_COMPANY_CODE = (os.environ.get("DEFAULT_COMPANY_CODE") or "SUGAR").strip().upper()
DEFAULT_COMPANY_NAME = (os.environ.get("DEFAULT_COMPANY_NAME") or "الشركة اليمنية لتكرير السكر").strip()

SETTING_DEFAULTS = [("currency", "ريال يمني"), ("company_name", "مغسلة الشركة")]


def default_company_id() -> int:
    """معرّف الشركة الأولى (الافتراضية) في التثبيت."""
    cached = app.config.get("DEFAULT_COMPANY_ID")
    if cached:
        return int(cached)
    row = get_db().execute("SELECT id FROM companies ORDER BY active DESC, id LIMIT 1").fetchone()
    if not row:
        raise RuntimeError("لا توجد شركة في قاعدة البيانات.")
    app.config["DEFAULT_COMPANY_ID"] = int(row["id"])
    return int(row["id"])


def current_company_id() -> int | None:
    """الشركة المرتبطة بالجلسة الحالية؛ None لحساب المدير العام."""
    if g.get("company_scope_resolved"):
        return g.get("company_id")
    g.company_scope_resolved = True
    g.company_id = default_company_id()
    return g.company_id


def require_company_id() -> int:
    company_id = current_company_id()
    if company_id is None:
        abort(403, description="اختر شركة أولاً؛ حساب المدير العام لا يدير بيانات التشغيل.")
    return int(company_id)


def set_company_scope(company_id: int | None) -> None:
    g.company_scope_resolved = True
    g.company_id = int(company_id) if company_id else None


def seed_company_defaults(conn: Any, company_id: int, company_name: str) -> None:
    defaults = [(company_id, key, value) for key, value in SETTING_DEFAULTS]
    defaults.append((company_id, "company_name", company_name))
    conn.executemany(
        "INSERT INTO settings(company_id,key,value) VALUES(?,?,?) ON CONFLICT(company_id,key) DO NOTHING",
        defaults,
    )
    conn.executemany(
        "INSERT INTO service_items(company_id,code,name,unit,rate) VALUES(?,?,?,?,?) "
        "ON CONFLICT(company_id,code) DO NOTHING",
        [(company_id, code, name, unit, rate) for code, name, unit, rate in SEED_SERVICES],
    )
    conn.execute(
        "INSERT INTO employees(company_id,employee_code,name,company,department,person_type,notes) "
        "VALUES(?,'GEN-001','موظف عام','زوار وضيوف من خارج الشركة','عام','general',"
        "'سجل عام؛ اكتب اسم الزائر الفعلي عند إنشاء طلب المغسلة') "
        "ON CONFLICT(company_id,employee_code) DO NOTHING",
        (company_id,),
    )


def create_company(conn: Any, code: str, name: str, active: bool = True) -> int:
    """ينشئ شركة جديدة مع إعداداتها وأصنافها وسجل الموظف العام."""
    code = code.strip().upper()
    name = name.strip()
    if not code or not name:
        raise ValueError("رمز الشركة واسمها مطلوبان.")
    row = conn.execute(
        "INSERT INTO companies(code,name,active) VALUES(?,?,?) RETURNING id",
        (code, name, 1 if active else 0),
    ).fetchone()
    company_id = int(row["id"])
    seed_company_defaults(conn, company_id, name)
    return company_id


def get_db() -> Any:
    if "db" not in g:
        if DATABASE_URL:
            g.db = PostgresConnection(DATABASE_URL)
        else:
            conn = sqlite3.connect(DB_PATH, timeout=20)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 20000")
            g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_error: BaseException | None = None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def _split_schema(schema: str) -> tuple[list[str], list[str]]:
    tables: list[str] = []
    indexes: list[str] = []
    for statement in schema.split(";"):
        stripped = statement.strip()
        if not stripped:
            continue
        if stripped.upper().startswith(("CREATE INDEX", "CREATE UNIQUE INDEX")):
            indexes.append(stripped)
        else:
            tables.append(stripped)
    return tables, indexes


def _schema_table_ddl(schema: str, table: str) -> str:
    for statement in schema.split(";"):
        if statement.strip().startswith(f"CREATE TABLE IF NOT EXISTS {table} "):
            return statement.strip()
    raise RuntimeError(f"تعذر العثور على تعريف الجدول {table}")


def _sqlite_columns(conn: Any, table: str) -> list[str]:
    return [row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]


def _sqlite_table_sql(conn: Any, table: str) -> str:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return (row["sql"] if row else "") or ""


def _sqlite_rebuild(conn: Any, table: str, ddl: str) -> None:
    """إعادة بناء جدول SQLite لتغيير قيود التفرد/المفاتيح مع الحفاظ على البيانات."""
    if not _sqlite_table_sql(conn, table):
        return
    conn.commit()
    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute("PRAGMA legacy_alter_table = ON")
    legacy = f"{table}__legacy"
    if _sqlite_table_sql(conn, legacy):
        current_rows = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        if current_rows:
            conn.execute(f"DROP TABLE {legacy}")
        else:
            conn.execute(f"DROP TABLE {table}")
    if _sqlite_table_sql(conn, legacy) and not _sqlite_table_sql(conn, table):
        conn.execute(f"ALTER TABLE {legacy} RENAME TO {table}")
    conn.execute(f"ALTER TABLE {table} RENAME TO {legacy}")
    conn.execute(ddl)
    legacy_columns = set(_sqlite_columns(conn, legacy))
    columns = ", ".join(column for column in _sqlite_columns(conn, table) if column in legacy_columns)
    if columns:
        conn.execute(f"INSERT INTO {table} ({columns}) SELECT {columns} FROM {legacy}")
    conn.execute(f"DROP TABLE {legacy}")
    conn.execute("PRAGMA legacy_alter_table = OFF")
    conn.commit()
    conn.execute("PRAGMA foreign_keys = ON")


def _is_system_admin(user: Any) -> bool:
    if not user:
        return False
    try:
        v = row_value(user, "system_admin", 0)
        try:
            if int(v) == 1:
                return True
        except Exception:
            if v:
                return True
    except Exception:
        pass
    try:
        if row_value(user, "role") == "super_admin":
            return True
    except Exception:
        pass
    return False

def _ensure_system_admins(conn: Any) -> None:
    try:
        conn.execute("UPDATE users SET system_admin=1 WHERE role='super_admin'")
    except Exception:
        pass
    try:
        cur = conn.execute("SELECT COUNT(*) AS c FROM users WHERE COALESCE(system_admin,0)=1")
        row = cur.fetchone()
        if not row or (row["c"] if hasattr(row,"__getitem__") else row[0]) == 0:
            conn.execute("UPDATE users SET system_admin=1 WHERE id=(SELECT MIN(id) FROM users WHERE role='admin')")
    except Exception:
        pass


def _ensure_company_row(conn: Any) -> int:

    row = conn.execute("SELECT id FROM companies ORDER BY id LIMIT 1").fetchone()
    if row:
        return int(row["id"])
    created = conn.execute(
        "INSERT INTO companies(code,name,active) VALUES(?,?,1)",
        (DEFAULT_COMPANY_CODE, DEFAULT_COMPANY_NAME),
    )
    last_id = getattr(created, "lastrowid", None)
    if last_id:
        return int(last_id)
    row = conn.execute("SELECT id FROM companies WHERE code=?", (DEFAULT_COMPANY_CODE,)).fetchone()
    return int(row["id"])


def _migrate_sqlite(conn: Any) -> int:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS companies ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, "
        "active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
    )
    for table in ("users", "employees", "service_items", "laundry_orders", "settings"):
        if table not in (
            row["name"] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        ):
            continue
        if "company_id" not in _sqlite_columns(conn, table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN company_id INTEGER REFERENCES companies(id)")
    company_id = _ensure_company_row(conn)
    for table in ("users", "employees", "service_items", "laundry_orders", "settings"):
        if table == "users":
            conn.execute(
                "UPDATE users SET company_id=? WHERE company_id IS NULL AND role<>'super_admin'",
                (company_id,),
            )
        else:
            conn.execute(f"UPDATE {table} SET company_id=? WHERE company_id IS NULL", (company_id,))
    conn.execute("UPDATE users SET company_id=NULL WHERE role='super_admin'")
    if "system_admin" not in _sqlite_columns(conn, "users"):
        conn.execute("ALTER TABLE users ADD COLUMN system_admin INTEGER NOT NULL DEFAULT 0")
    _ensure_system_admins(conn)
    if "system_admin" not in _sqlite_columns(conn, "users"):
        conn.execute("ALTER TABLE users ADD COLUMN system_admin INTEGER NOT NULL DEFAULT 0")
    _ensure_system_admins(conn)
    if "employee_code TEXT NOT NULL UNIQUE" in _sqlite_table_sql(conn, "employees"):
        _sqlite_rebuild(conn, "employees", _schema_table_ddl(SQLITE_SCHEMA, "employees"))
    if "code TEXT NOT NULL UNIQUE" in _sqlite_table_sql(conn, "service_items"):
        _sqlite_rebuild(conn, "service_items", _schema_table_ddl(SQLITE_SCHEMA, "service_items"))
    if "key TEXT PRIMARY KEY" in _sqlite_table_sql(conn, "settings"):
        _sqlite_rebuild(conn, "settings", _schema_table_ddl(SQLITE_SCHEMA, "settings"))
    users_sql = _sqlite_table_sql(conn, "users")
    if users_sql and "CHECK (role IN ('admin'" in users_sql:
        _sqlite_rebuild(conn, "users", _schema_table_ddl(SQLITE_SCHEMA, "users"))
    conn.execute("DROP INDEX IF EXISTS idx_orders_client_uuid")
    return company_id


def _pg_unique_constraints(conn: Any, table: str) -> list[Any]:
    return conn.execute(
        """
        SELECT c.conname, pg_get_constraintdef(c.oid) AS defn
        FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=current_schema() AND c.contype='u' AND t.relname=?
        """,
        (table,),
    ).fetchall()


def _pg_primary_key(conn: Any, table: str) -> Any | None:
    return conn.execute(
        """
        SELECT c.conname, pg_get_constraintdef(c.oid) AS defn
        FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=current_schema() AND c.contype='p' AND t.relname=?
        """,
        (table,),
    ).fetchone()


def _migrate_postgres(conn: Any) -> int:
    for table in ("users", "employees", "service_items", "laundry_orders", "settings"):
        conn.execute(
            f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS company_id BIGINT REFERENCES companies(id)"
        )
    company_id = _ensure_company_row(conn)
    for table in ("users", "employees", "service_items", "laundry_orders", "settings"):
        if table == "users":
            conn.execute(
                "UPDATE users SET company_id=? WHERE company_id IS NULL AND role<>'super_admin'",
                (company_id,),
            )
        else:
            conn.execute(f"UPDATE {table} SET company_id=? WHERE company_id IS NULL", (company_id,))
    conn.execute("UPDATE users SET company_id=NULL WHERE role='super_admin'")
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS system_admin SMALLINT NOT NULL DEFAULT 0")
    _ensure_system_admins(conn)
    for table, column in (("employees", "employee_code"), ("service_items", "code")):
        for constraint in _pg_unique_constraints(conn, table):
            definition = (constraint["defn"] or "").replace(" ", "").upper()
            if definition == f"UNIQUE({column.upper()})":
                conn.execute(f'ALTER TABLE {table} DROP CONSTRAINT "{constraint["conname"]}"')
    key = _pg_primary_key(conn, "settings")
    if key and "COMPANY_ID" not in (key["defn"] or "").replace(" ", "").upper():
        conn.execute(f'ALTER TABLE settings DROP CONSTRAINT "{key["conname"]}"')
        conn.execute("ALTER TABLE settings ADD PRIMARY KEY (company_id, key)")
    role_checks = conn.execute(
        """
        SELECT c.conname, pg_get_constraintdef(c.oid) AS defn
        FROM pg_constraint c
        JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname=current_schema() AND c.contype='c' AND t.relname='users'
        """
    ).fetchall()
    for check in role_checks:
        if "role" in (check["defn"] or ""):
            conn.execute(f'ALTER TABLE users DROP CONSTRAINT "{check["conname"]}"')
    conn.execute(
        "ALTER TABLE users ADD CONSTRAINT users_role_check "
        "CHECK (role IN ('super_admin','admin','contractor','supervisor'))"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_company_code "
        "ON employees(company_id, employee_code)"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_service_items_company_code "
        "ON service_items(company_id, code)"
    )
    for table in ("employees", "service_items", "laundry_orders", "settings"):
        conn.execute(f"ALTER TABLE {table} ALTER COLUMN company_id SET NOT NULL")
    conn.execute("DROP INDEX IF EXISTS idx_orders_client_uuid")
    return company_id


def init_db() -> None:
    """Create app tables, migrate to multi-company, seed data and first admins."""
    if DATABASE_URL:
        conn: Any = PostgresConnection(DATABASE_URL)
        try:
            # Prevent concurrent Gunicorn workers/restarts from racing through first-time setup.
            conn.execute("SELECT pg_advisory_xact_lock(8675309)")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS companies ("
                "id BIGSERIAL PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, "
                "active SMALLINT NOT NULL DEFAULT 1, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
            tables, indexes = _split_schema(POSTGRES_SCHEMA)
            for statement in tables:
                conn.execute(statement)
            company_id = _migrate_postgres(conn)
            for statement in indexes:
                conn.execute(statement)
            existing_columns = {row["column_name"] for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='laundry_orders'"
            ).fetchall()}
            migrations = {
                "fulfillment_status": "ALTER TABLE laundry_orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','delivered'))",
                "delivered_at": "ALTER TABLE laundry_orders ADD COLUMN delivered_at TIMESTAMPTZ",
                "delivered_by": "ALTER TABLE laundry_orders ADD COLUMN delivered_by BIGINT REFERENCES users(id)",
                "client_uuid": "ALTER TABLE laundry_orders ADD COLUMN client_uuid TEXT",
                "receiver_kind": "ALTER TABLE laundry_orders ADD COLUMN receiver_kind TEXT NOT NULL DEFAULT '' CHECK (receiver_kind IN ('','same_employee','other'))",
                "receiver_name": "ALTER TABLE laundry_orders ADD COLUMN receiver_name TEXT NOT NULL DEFAULT ''",
                "received_at": "ALTER TABLE laundry_orders ADD COLUMN received_at TIMESTAMPTZ",
            }
            for column, statement in migrations.items():
                if column not in existing_columns:
                    conn.execute(statement)
            item_columns = {row["column_name"] for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='laundry_order_items'"
            ).fetchall()}
            if "received_quantity" not in item_columns:
                conn.execute("ALTER TABLE laundry_order_items ADD COLUMN received_quantity DOUBLE PRECISION")
            employee_columns = {row["column_name"] for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='employees'"
            ).fetchall()}
            for column, definition in EMPLOYEE_SHIFT_COLUMNS:
                if column not in employee_columns:
                    conn.execute(f"ALTER TABLE employees ADD COLUMN {column} {definition}")
            company_row = conn.execute("SELECT name FROM companies WHERE id=?", (company_id,)).fetchone()
            seed_company_defaults(conn, company_id, company_row["name"] if company_row else DEFAULT_COMPANY_NAME)
            existing_admin = conn.execute(
                "SELECT id FROM users WHERE role IN ('admin','super_admin') LIMIT 1"
            ).fetchone()
            if not existing_admin:
                initial_password = os.environ.get("INITIAL_ADMIN_PASSWORD", "")
                if len(initial_password) < 12:
                    raise RuntimeError(
                        "قاعدة Supabase لا تحتوي حساب مدير بعد. أضف INITIAL_ADMIN_PASSWORD "
                        "(12 حرفاً على الأقل) إلى متغيرات Render ثم أعد النشر."
                    )
                username = os.environ.get("INITIAL_ADMIN_USERNAME", "admin").strip() or "admin"
                full_name = os.environ.get("INITIAL_ADMIN_NAME", "مدير النظام").strip() or "مدير النظام"
                existing_username = conn.execute("SELECT role FROM users WHERE username=?", (username,)).fetchone()
                if existing_username and existing_username["role"] not in ("admin", "super_admin"):
                    raise RuntimeError(
                        f"اسم المستخدم الأولي {username} مستخدم لحساب غير إداري. "
                        "اختر INITIAL_ADMIN_USERNAME مختلفاً في Render."
                    )
                conn.execute(
                    "INSERT INTO users(username,password_hash,full_name,role,company_id) "
                    "VALUES(?,?,?,'admin',?) ON CONFLICT(username) DO NOTHING",
                    (username, generate_password_hash(initial_password), full_name, company_id),
                )
            super_password = os.environ.get("SUPER_ADMIN_PASSWORD", "")
            has_super = conn.execute("SELECT id FROM users WHERE role='super_admin' LIMIT 1").fetchone()
            if super_password and not has_super:
                if len(super_password) < 12:
                    raise RuntimeError("SUPER_ADMIN_PASSWORD يجب أن يكون 12 حرفاً على الأقل.")
                super_username = os.environ.get("SUPER_ADMIN_USERNAME", "superadmin").strip() or "superadmin"
                conn.execute(
                    "INSERT INTO users(username,password_hash,full_name,role,company_id) "
                    "VALUES(?,?,?,'super_admin',NULL) ON CONFLICT(username) DO NOTHING",
                    (super_username, generate_password_hash(super_password), "المدير العام"),
                )
            conn.commit()
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(DB_PATH, timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        tables, indexes = _split_schema(SQLITE_SCHEMA)
        for statement in tables:
            conn.execute(statement)
        company_id = _migrate_sqlite(conn)
        existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(laundry_orders)").fetchall()}
        if "fulfillment_status" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','delivered'))")
        if "delivered_at" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN delivered_at TEXT")
        if "delivered_by" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN delivered_by INTEGER REFERENCES users(id)")
        if "client_uuid" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN client_uuid TEXT")
        if "receiver_kind" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN receiver_kind TEXT NOT NULL DEFAULT '' CHECK (receiver_kind IN ('','same_employee','other'))")
        if "receiver_name" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN receiver_name TEXT NOT NULL DEFAULT ''")
        if "received_at" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN received_at TEXT")
        order_item_columns = {row["name"] for row in conn.execute("PRAGMA table_info(laundry_order_items)").fetchall()}
        if "received_quantity" not in order_item_columns:
            conn.execute("ALTER TABLE laundry_order_items ADD COLUMN received_quantity REAL")
        employee_columns = {row["name"] for row in conn.execute("PRAGMA table_info(employees)").fetchall()}
        for column, definition in EMPLOYEE_SHIFT_COLUMNS:
            if column not in employee_columns:
                conn.execute(f"ALTER TABLE employees ADD COLUMN {column} {definition}")
        for statement in indexes:
            conn.execute(statement)
        company_row = conn.execute("SELECT name FROM companies WHERE id=?", (company_id,)).fetchone()
        seed_company_defaults(conn, company_id, company_row["name"] if company_row else DEFAULT_COMPANY_NAME)
        demo_users = [
            ("admin", "Admin@12345", "مدير النظام", "admin"),
            ("contractor", "Laundry@12345", "متعهد المغسلة", "contractor"),
            ("supervisor", "Housing@12345", "مشرف السكن", "supervisor"),
            ("super", "Super@12345", "المدير العام", "super_admin"),
        ]
        for username, password, full_name, role in demo_users:
            scoped_company = None if role == "super_admin" else company_id
            conn.execute(
                "INSERT OR IGNORE INTO users(username,password_hash,full_name,role,company_id) VALUES(?,?,?,?,?)",
                (username, generate_password_hash(password), full_name, role, scoped_company),
            )
        conn.commit()
        conn.close()


#: نوع الخدمة المعتمد لخدمة المغسلة السكنية.
HOUSING_SERVICE_TYPES = ("سكن", "نقل-سكن")


def row_value(row: Any, key: str, default: Any = "") -> Any:
    """قراءة قيمة من صف قاعدة بيانات مع قيمة افتراضية عند غياب العمود."""
    try:
        value = row[key]
    except (KeyError, IndexError, TypeError):
        return default
    return default if value is None else value


def employee_cycle(employee: Any, on_date: date | None = None) -> dict[str, Any]:
    """حساب موضع الموظف داخل دورة دوامه في تاريخ معيّن.

    يعتمد على cycle_anchor المخزَّن مع الموظف: تاريخ إسناد الدورة الذي يجعل
    يوم الدورة في تاريخ مرجعي معروف يساوي القيمة المسجّلة في كشف الموظفين.
    """
    target = on_date or date.today()
    if isinstance(target, str):
        try:
            target = date.fromisoformat(target)
        except ValueError:
            target = date.today()
    work_days = int(row_value(employee, "work_days", 0) or 0)
    rest_days = int(row_value(employee, "rest_days", 0) or 0)
    cycle_length = work_days + rest_days
    result: dict[str, Any] = {
        "day": 0,
        "cycle_length": cycle_length,
        "work_days": work_days,
        "rest_days": rest_days,
        "on_duty": False,
        "known": False,
        "label": "",
    }
    if cycle_length <= 0:
        return result
    anchor = safe_date(row_value(employee, "cycle_anchor"), "")
    if not anchor:
        return result
    offset = (target - date.fromisoformat(anchor)).days % cycle_length
    day = offset + 1
    result["day"] = day
    result["known"] = True
    result["on_duty"] = day <= work_days
    result["label"] = "دوام" if result["on_duty"] else "راحة"
    return result


def employee_shift_warnings(employee: Any, service_date: str) -> list[str]:
    """تنبيهات توافق الموظف مع نوع الخدمة ودورة دوامه في تاريخ الطلب."""
    warnings: list[str] = []
    if employee is None:
        return warnings
    service_type = str(row_value(employee, "service_type")).strip()
    if service_type and service_type not in HOUSING_SERVICE_TYPES:
        warnings.append(
            f"نوع خدمة الموظف «{service_type}» وليس «سكن»، فهذه الخدمة تخص السكن فقط."
        )
    cycle = employee_cycle(employee, service_date)
    if cycle["known"] and not cycle["on_duty"]:
        warnings.append(
            f"التاريخ {service_date} يقع في مرحلة الراحة لدورة دوام الموظف "
            f"(اليوم {cycle['day']} من {cycle['cycle_length']}، والدوام {cycle['work_days']} يوم عمل)."
        )
    return warnings


def bootstrap_database(attempts: int = 5) -> None:
    """Create the tables, seed data and the first admin before serving requests.

    Called once at import time so both `python app.py` and `gunicorn app:app`
    start with a ready database. Every statement inside init_db() is idempotent,
    so running it on every start is safe.
    """
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            init_db()
            return
        except (sqlite3.OperationalError, psycopg.OperationalError) as exc:
            # Another worker (or a concurrent start) may be creating the schema.
            last_error = exc
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError(f"تعذر تجهيز قاعدة البيانات: {last_error}") from last_error


bootstrap_database()


def get_setting(key: str, default: str = "") -> str:
    company_id = current_company_id()
    if company_id is None:
        return default
    row = get_db().execute(
        "SELECT value FROM settings WHERE company_id=? AND key=?", (company_id, key)
    ).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    company_id = require_company_id()
    get_db().execute(
        "INSERT INTO settings(company_id,key,value) VALUES(?,?,?) "
        "ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value",
        (company_id, key, value.strip()),
    )
    get_db().commit()


def current_user() -> Any | None:
    user_id = session.get("user_id")
    if not user_id:
        return None
    user = get_db().execute(
        "SELECT id,username,full_name,role,active,company_id FROM users WHERE id=?", (user_id,)
    ).fetchone()
    if not user or not user["active"]:
        session.clear()
        return None
    return user


def login_required(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        user = current_user()
        if user is None:
            return redirect(url_for("login", next=request.path))
        if row_value(user,"role") == "super_admin" and _is_system_admin(user) and not (
            request.path.startswith("/companies")
            or request.path.startswith("/admin/orders")
            or request.path.startswith("/account")
            or request.path.startswith("/logout")
            or request.path.startswith("/static")
        ):
            return redirect(url_for("companies"))
        return view(*args, **kwargs)
    return wrapped


def roles_required(*roles: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view)
        @login_required
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            user = current_user()
            if not user or user["role"] not in roles:
                abort(403)
            return view(*args, **kwargs)
        return wrapped
    return decorator


def csrf_value() -> str:
    if "_csrf_token" not in session:
        session["_csrf_token"] = secrets.token_urlsafe(32)
    return str(session["_csrf_token"])


@app.before_request
def protect_posts() -> None:
    # مسارات /api/ تستخدم رموزاً موقّعة (Bearer) بدل جلسة النموذج، فلا يشملها CSRF.
    if request.path.startswith("/api/"):
        return
    if request.method == "POST":
        supplied = request.form.get("csrf_token", "")
        expected = session.get("_csrf_token", "")
        if not supplied or not expected or not secrets.compare_digest(supplied, expected):
            abort(400, description="انتهت صلاحية النموذج. حدّث الصفحة ثم أعد المحاولة.")


@app.before_request
def resolve_company_scope() -> None:
    """يحدّد الشركة الحالية من جلسة المستخدم قبل أي استعلام."""
    if request.path.startswith("/api/"):
        return
    user = current_user()
    set_company_scope(user["company_id"] if user else None)


@app.context_processor
def inject_globals() -> dict[str, Any]:
    labels = {
        "super_admin": "المدير العام",
        "admin": "مدير النظام",
        "contractor": "متعهد المغسلة",
        "supervisor": "مشرف السكن",
    }
    user = current_user()
    company_name = get_setting("company_name", "مغسلة الشركة")
    if user and user["company_id"]:
        row = get_db().execute("SELECT name FROM companies WHERE id=?", (user["company_id"],)).fetchone()
        if row:
            company_name = row["name"]
    return {
        "current_user": user,
        "role_labels": labels,
        "csrf_token": csrf_value,
        "currency": get_setting("currency", "ريال يمني"),
        "company_name": company_name,
        "is_super_admin": _is_system_admin(user),
        "database_label": "Supabase PostgreSQL" if DATABASE_URL else "SQLite محلية للتجربة",
        "today": date.today().isoformat(),
    }


def money(value: float | int | None) -> str:
    try:
        return f"{float(value or 0):,.2f}"
    except (TypeError, ValueError):
        return "0.00"


app.jinja_env.filters["money"] = money


def order_query(where: str = "", params: tuple[Any, ...] = ()) -> list[Any]:
    company_id = require_company_id()
    sql = """
        SELECT o.*, e.employee_code, e.name AS employee_name, e.company, e.department,
               e.service_type, e.shift_system, e.shift_description, e.work_days, e.rest_days,
               e.cycle_start, e.cycle_anchor, e.cycle_day, e.status_label, e.departure_time,
               e.housing_location, e.job_title, e.gender, e.transport_class,
               u.full_name AS creator_name, confirmer.full_name AS confirmer_name,
               deliverer.full_name AS deliverer_name
        FROM laundry_orders o
        JOIN employees e ON e.id=o.employee_id
        JOIN users u ON u.id=o.created_by
        LEFT JOIN users confirmer ON confirmer.id=o.confirmed_by
        LEFT JOIN users deliverer ON deliverer.id=o.delivered_by
        WHERE o.company_id = ?
    """
    query_params: list[Any] = [company_id]
    if where:
        sql += " AND " + where
        query_params.extend(params)
    sql += " ORDER BY o.service_date DESC, o.id DESC"
    return get_db().execute(sql, tuple(query_params)).fetchall()


def order_items(order_id: int) -> list[Any]:
    company_id = require_company_id()
    return get_db().execute(
        "SELECT i.* FROM laundry_order_items i JOIN laundry_orders o ON o.id=i.order_id "
        "WHERE i.order_id=? AND o.company_id=? ORDER BY i.id",
        (order_id, company_id),
    ).fetchall()


def order_items_with_received(order_id: int) -> list[dict[str, Any]]:
    """أصناف الطلب مع إجمالي الكمية المستلمة والكمية المتبقية للاستلام."""
    rows: list[dict[str, Any]] = []
    for item in order_items(order_id):
        data = dict(item)
        quantity = float(item["quantity"] or 0)
        received = float(item["received_quantity"] or 0)
        data["received_total"] = received
        data["remaining"] = max(quantity - received, 0.0)
        rows.append(data)
    return rows


def order_receipts(order_id: int) -> list[dict[str, Any]]:
    """سجل عمليات استلام الأصناف من المغسلة لهذا الطلب (قد تكون على دفعات)."""
    db = get_db()
    company_id = require_company_id()
    receipts = db.execute(
        "SELECT r.*, u.full_name AS recorded_by_name FROM laundry_receipts r "
        "LEFT JOIN users u ON u.id=r.received_by WHERE r.order_id=? AND r.company_id=? ORDER BY r.id",
        (order_id, company_id),
    ).fetchall()
    result: list[dict[str, Any]] = []
    for receipt in receipts:
        pieces = db.execute(
            "SELECT ri.quantity, i.item_name, i.unit FROM laundry_receipt_items ri "
            "JOIN laundry_order_items i ON i.id=ri.order_item_id WHERE ri.receipt_id=? ORDER BY ri.id",
            (receipt["id"],),
        ).fetchall()
        result.append({"receipt": receipt, "pieces": pieces})
    return result


def safe_date(value: str, fallback: str) -> str:
    try:
        return date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        return fallback


def employee_item_summary(order_ids: list[int], group_by: str = "employee") -> dict[str, Any]:
    """تجميع كميات كل صنف لكل موظف أو لكل نوع خدمة ضمن الطلبات المحددة.

    group_by='employee'     → صف لكل موظف مع أعمدة الأصناف وكمياتها.
    group_by='service_type' → صف لكل نوع خدمة (سكن/نقل/...) مع نفس الأعمدة.
    """
    if not order_ids:
        return {"columns": [], "rows": []}
    placeholders = ",".join("?" * len(order_ids))
    rows = get_db().execute(
        f"""
        SELECT e.id AS employee_id, e.employee_code, e.name AS employee_name, e.service_type,
               i.item_name, SUM(COALESCE(i.received_quantity, i.quantity)) AS qty
        FROM laundry_order_items i
        JOIN laundry_orders o ON o.id=i.order_id
        JOIN employees e ON e.id=o.employee_id
        WHERE o.id IN ({placeholders}) AND o.company_id = ?
        GROUP BY e.id, e.employee_code, e.name, e.service_type, i.item_name
        ORDER BY LOWER(e.name), i.item_name
        """,
        (*order_ids, require_company_id()),
    ).fetchall()
    grouped: dict[Any, dict[str, Any]] = {}
    item_names: set[str] = set()
    for row in rows:
        if group_by == "service_type":
            key: Any = row["service_type"] or "غير محدد"
            entry = grouped.setdefault(key, {
                "key": key,
                "label": key,
                "employee_code": "",
                "employee_name": key,
                "service_type": key,
                "quantities": {},
                "total": 0.0,
            })
        else:
            key = row["employee_id"]
            entry = grouped.setdefault(key, {
                "key": key,
                "label": row["employee_name"],
                "employee_code": row["employee_code"],
                "employee_name": row["employee_name"],
                "service_type": row["service_type"] or "غير محدد",
                "quantities": {},
                "total": 0.0,
            })
        quantity = float(row["qty"] or 0)
        entry["quantities"][row["item_name"]] = entry["quantities"].get(row["item_name"], 0.0) + quantity
        entry["total"] += quantity
        item_names.add(row["item_name"])
    ordered_items = sorted(item_names)
    result = list(grouped.values())
    if group_by == "service_type":
        result.sort(key=lambda entry: str(entry["label"]))
    return {"columns": ordered_items, "rows": result}


HOUSING_TARGET_SHEETS = 2
HOUSING_TARGET_PILLOWS = 2
HOUSING_MIN_CYCLE_DAYS = 30
HOUSING_ITEM_RULES = (
    ("bed_sheet", {"BED_SHEET", "BEDSHEET", "SHEET"}, ("ملاية", "ملاءة", "ملاءات", "شرشف", "شراشف")),
    ("pillow_case", {"PILLOW_CASE", "PILLOWCASE", "PILLOW"}, ("مخد", "وساد", "لباس مخدة")),
    ("blanket", {"BLANKET"}, ("بطاني", "لحاف", "ألحفة")),
)


def housing_item_key(code: str | None, name: str | None) -> str | None:
    """تصنيف صنف الغسيل إلى: ملاية سرير / لباس مخدة / بطانية (أو None)."""
    code_text = (code or "").strip().upper()
    name_text = (name or "").strip()
    for key, codes, words in HOUSING_ITEM_RULES:
        if code_text in codes or any(word in name_text for word in words):
            return key
    return None


def housing_report_data(
    company_id: int,
    start: str,
    end: str,
    housing_only: bool = False,
) -> dict[str, Any]:
    """تقرير تغطية غسيل سكن الموظفين خلال فترة محددة.

    - يُحتسب المتواجد بالسكن من نوع الخدمة (سكن / نقل-سكن).
    - الاستحقاق: قطعتا ملاية سرير + قطعتا لباس مخدة لكل دورة دوام كاملة.
    - دورة الدوام = أيام العمل + أيام الراحة، وبحدٍّ أدنى 30 يوماً (دورة 7 أيام تُحسب 30).
    - التغطية تُحسب من الكميات المُسلَّمة فعلياً (delivered) وغير المرفوضة.
    """
    start_date = date.fromisoformat(start)
    end_date = date.fromisoformat(end)
    if end_date < start_date:
        start_date, end_date = end_date, start_date
    period_days = (end_date - start_date).days + 1
    db = get_db()

    employees = db.execute(
        "SELECT id, employee_code, name, department, job_title, housing_location, "
        "service_type, shift_system, shift_description, work_days, rest_days, status_label "
        "FROM employees WHERE company_id=? AND active=1 ORDER BY name",
        (company_id,),
    ).fetchall()

    item_rows = db.execute(
        "SELECT o.employee_id, i.item_name, COALESCE(i.received_quantity, i.quantity) AS quantity, COALESCE(s.code, '') AS item_code "
        "FROM laundry_order_items i "
        "JOIN laundry_orders o ON o.id=i.order_id "
        "LEFT JOIN service_items s ON s.id=i.service_item_id "
        "WHERE o.company_id=? AND o.service_date>=? AND o.service_date<=? "
        "AND o.status<>'rejected' AND o.fulfillment_status='delivered'",
        (company_id, start_date.isoformat(), end_date.isoformat()),
    ).fetchall()

    quantities: dict[int, dict[str, float]] = {}
    for item in item_rows:
        key = housing_item_key(item["item_code"], item["item_name"])
        if not key:
            continue
        bucket = quantities.setdefault(int(item["employee_id"]), {})
        bucket[key] = bucket.get(key, 0.0) + float(item["quantity"] or 0)

    rows: list[dict[str, Any]] = []
    for employee in employees:
        service_type = str(employee["service_type"] or "")
        is_resident = "سكن" in service_type
        if housing_only and not is_resident:
            continue
        work_days = int(employee["work_days"] or 0)
        rest_days = int(employee["rest_days"] or 0)
        cycle_days = max(0, work_days + rest_days)
        effective_cycle_days = max(HOUSING_MIN_CYCLE_DAYS, cycle_days)
        cycles = max(1, period_days // effective_cycle_days)
        target_sheets = HOUSING_TARGET_SHEETS * cycles
        target_pillows = HOUSING_TARGET_PILLOWS * cycles
        target_total = target_sheets + target_pillows
        employee_items = quantities.get(int(employee["id"]), {})
        sheets = employee_items.get("bed_sheet", 0.0)
        pillows = employee_items.get("pillow_case", 0.0)
        blankets = employee_items.get("blanket", 0.0)
        achieved = sheets + pillows
        percentage = min(100.0, achieved / target_total * 100.0) if target_total else 0.0
        if percentage >= 100:
            coverage_status = "مكتمل"
        elif achieved > 0:
            coverage_status = "جزئي"
        else:
            coverage_status = "بدون غسيل"
        missing = []
        if sheets <= 0:
            missing.append("ملاية سرير")
        if pillows <= 0:
            missing.append("لباس مخدة")
        if blankets <= 0:
            missing.append("بطانية")
        rows.append(
            {
                "employee_id": employee["id"],
                "employee_code": employee["employee_code"],
                "employee_name": employee["name"],
                "department": employee["department"] or "",
                "job_title": employee["job_title"] or "",
                "housing_location": employee["housing_location"] or "",
                "service_type": service_type,
                "shift_system": employee["shift_system"] or "",
                "shift_label": (
                    f"{work_days} عمل / {rest_days} راحة" if cycle_days else "غير محدد"
                ),
                "work_days": work_days,
                "rest_days": rest_days,
                "cycle_days": cycle_days,
                "effective_cycle_days": effective_cycle_days,
                "cycles": cycles,
                "status_label": employee["status_label"] or "",
                "is_resident": is_resident,
                "housing_label": "متواجد بالسكن" if is_resident else (service_type or "غير محدد"),
                "sheets": sheets,
                "pillows": pillows,
                "blankets": blankets,
                "target_sheets": target_sheets,
                "target_pillows": target_pillows,
                "target_total": target_total,
                "achieved": achieved,
                "percentage": round(percentage, 1),
                "coverage_status": coverage_status,
                "missing": missing,
            }
        )

    total = len(rows)
    summary = {
        "employees_total": total,
        "housing_total": sum(1 for row in rows if row["is_resident"]),
        "non_housing_total": sum(1 for row in rows if not row["is_resident"]),
        "with_laundry": sum(1 for row in rows if row["achieved"] > 0 or row["blankets"] > 0),
        "no_laundry": sum(
            1 for row in rows if row["achieved"] <= 0 and row["blankets"] <= 0
        ),
        "complete": sum(1 for row in rows if row["coverage_status"] == "مكتمل"),
        "partial": sum(1 for row in rows if row["coverage_status"] == "جزئي"),
        "none": sum(1 for row in rows if row["coverage_status"] == "بدون غسيل"),
        "missing_sheet": sum(1 for row in rows if row["sheets"] <= 0),
        "missing_pillow": sum(1 for row in rows if row["pillows"] <= 0),
        "missing_blanket": sum(1 for row in rows if row["blankets"] <= 0),
        "avg_percentage": round(
            sum(row["percentage"] for row in rows) / total, 1
        ) if total else 0.0,
        "total_sheets": sum(row["sheets"] for row in rows),
        "total_pillows": sum(row["pillows"] for row in rows),
        "total_blankets": sum(row["blankets"] for row in rows),
    }
    return {
        "start": start_date.isoformat(),
        "end": end_date.isoformat(),
        "period_days": period_days,
        "min_cycle_days": HOUSING_MIN_CYCLE_DAYS,
        "target_sheets": HOUSING_TARGET_SHEETS,
        "target_pillows": HOUSING_TARGET_PILLOWS,
        "housing_only": housing_only,
        "rows": rows,
        "summary": summary,
        "note": (
            "يُعدّ الموظف متواجداً بالسكن إذا كان نوع خدمته «سكن» أو «نقل-سكن». "
            "الاستحقاق قطعتا ملاية سرير وقطعتا لباس مخدة لكل دورة دوام كاملة، "
            "ودورة الدوام = أيام العمل + أيام الراحة وبحدٍّ أدنى 30 يوماً، "
            "لذلك تُحسب دورة 7 أيام على أساس 30 يوماً. النسبة تعتمد على الكميات المُسلَّمة فعلياً "
            "داخل الفترة المحددة، والبطانية تُعرض للتوضيح دون احتسابها في النسبة."
        ),
    }


def order_filters() -> tuple[str, list[Any], str, str, str, str]:
    today = date.today()
    start = safe_date(request.args.get("from", ""), today.replace(day=1).isoformat())
    end = safe_date(request.args.get("to", ""), today.isoformat())
    if start > end:
        start, end = end, start
    status = request.args.get("status", "all")
    if status not in {"all", "pending", "approved", "rejected"}:
        status = "all"
    fulfillment = request.args.get("fulfillment", "all")
    if fulfillment not in {"all", "received", "delivered", "partial"}:
        fulfillment = "all"
    conditions = ["o.service_date >= ?", "o.service_date <= ?"]
    params: list[Any] = [start, end]
    if status != "all":
        conditions.append("o.status = ?")
        params.append(status)
    if fulfillment in ("received", "delivered"):
        conditions.append("o.fulfillment_status = ?")
        params.append(fulfillment)
    elif fulfillment == "partial":
        conditions.append(
            "(o.fulfillment_status = 'delivered' AND EXISTS ("
            "SELECT 1 FROM laundry_order_items ri WHERE ri.order_id = o.id "
            "AND COALESCE(ri.received_quantity, 0) < ri.quantity))"
        )
    search = request.args.get("q", "").strip()
    if search:
        like = f"%{search}%"
        conditions.append("(o.reference LIKE ? OR e.name LIKE ? OR e.employee_code LIKE ? OR o.person_name LIKE ? OR e.company LIKE ?)")
        params.extend([like, like, like, like, like])
    return " AND ".join(conditions), params, start, end, status, fulfillment


EXPORT_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv": "text/csv; charset=utf-8",
}


def export_response(content: bytes, fmt: str, filename: str) -> Any:
    """إرجاع ملف تصدير بالمحتوى ونوع MIME المناسب."""
    response = make_response(content)
    response.headers["Content-Type"] = EXPORT_CONTENT_TYPES.get(fmt, "application/octet-stream")
    response.headers["Content-Disposition"] = f"attachment; filename={filename}.{fmt}"
    return response


def requested_format(default: str = "csv") -> str:
    fmt = request.args.get("format", default).strip().lower()
    return fmt if fmt in ("pdf", "xlsx", "csv") else default


def _quantity_text(value: Any) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return "0"
    return str(int(number)) if number == int(number) else f"{number:g}"


def employee_filters() -> tuple[str, list[Any], str, str, str, str]:
    """فلاتر قاعدة الموظفين المشتركة بين الصفحة والتصدير."""
    q = request.args.get("q", "").strip()
    type_filter = request.args.get("type", "all")
    if type_filter not in ("all", "company", "general"):
        type_filter = "all"
    service_filter = request.args.get("service", "all").strip()
    active_filter = request.args.get("active", "all")
    if active_filter not in ("all", "active", "inactive"):
        active_filter = "all"
    conditions: list[str] = ["company_id=?"]
    params: list[Any] = [require_company_id()]
    if q:
        like = f"%{q}%"
        conditions.append("(employee_code LIKE ? OR name LIKE ? OR company LIKE ? OR department LIKE ?)")
        params.extend([like, like, like, like])
    if type_filter in ("company", "general"):
        conditions.append("person_type=?")
        params.append(type_filter)
    if service_filter and service_filter != "all":
        conditions.append("service_type=?")
        params.append(service_filter)
    if active_filter == "active":
        conditions.append("active=1")
    elif active_filter == "inactive":
        conditions.append("active=0")
    return " AND ".join(conditions), params, q, type_filter, service_filter, active_filter


def rate_filters() -> tuple[str, list[Any], str, str]:
    """فلاتر قائمة الخدمات والأسعار."""
    q = request.args.get("q", "").strip()
    active_filter = request.args.get("active", "all")
    if active_filter not in ("all", "active", "inactive"):
        active_filter = "all"
    conditions: list[str] = ["company_id=?"]
    params: list[Any] = [require_company_id()]
    if q:
        like = f"%{q}%"
        conditions.append("(code LIKE ? OR name LIKE ? OR unit LIKE ?)")
        params.extend([like, like, like])
    if active_filter == "active":
        conditions.append("active=1")
    elif active_filter == "inactive":
        conditions.append("active=0")
    return " AND ".join(conditions), params, q, active_filter


def user_filters() -> tuple[str, list[Any], str, str, str]:
    """فلاتر قائمة المستخدمين."""
    q = request.args.get("q", "").strip()
    role_filter = request.args.get("role", "all")
    if role_filter not in ("all", "admin", "contractor", "supervisor"):
        role_filter = "all"
    active_filter = request.args.get("active", "all")
    if active_filter not in ("all", "active", "inactive"):
        active_filter = "all"
    conditions: list[str] = ["company_id=?"]
    params: list[Any] = [require_company_id()]
    if q:
        like = f"%{q}%"
        conditions.append("(username LIKE ? OR full_name LIKE ?)")
        params.extend([like, like])
    if role_filter != "all":
        conditions.append("role=?")
        params.append(role_filter)
    if active_filter == "active":
        conditions.append("active=1")
    elif active_filter == "inactive":
        conditions.append("active=0")
    return " AND ".join(conditions), params, q, role_filter, active_filter


@app.route("/")
def index() -> Any:
    user = current_user()
    if user:
        if row_value(user,"role")=="super_admin" and _is_system_admin(user):
            return redirect(url_for("companies"))
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login() -> Any:
    existing = current_user()
    if existing:
        if row_value(existing,"role")=="super_admin" and _is_system_admin(existing):
            return redirect(url_for("companies"))
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username=? AND active=1", (username,)
        ).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            if not _is_system_admin(user):
                company = get_db().execute(
                    "SELECT active FROM companies WHERE id=?", (user["company_id"],)
                ).fetchone()
                if not company or not company["active"]:
                    flash("الشركة المرتبطة بهذا الحساب غير مفعّلة. راجع المدير العام.", "error")
                    return render_template("login.html")
            session.clear()
            session["user_id"] = user["id"]
            session["_csrf_token"] = secrets.token_urlsafe(32)
            target = request.args.get("next", "")
            if not target.startswith("/") or target.startswith("//"):
                if row_value(user,"role")=="super_admin" and _is_system_admin(user):
                    target = url_for("companies")
                else:
                    target = url_for("dashboard")
            return redirect(target)
        flash("اسم المستخدم أو كلمة المرور غير صحيحة.", "error")
    return render_template("login.html")


@app.route("/logout", methods=["POST"])
@login_required
def logout() -> Any:
    session.clear()
    flash("تم تسجيل الخروج.", "success")
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard() -> Any:
    db = get_db()
    company_id = require_company_id()
    first_day = date.today().replace(day=1).isoformat()
    metrics = {
        "employees": db.execute("SELECT COUNT(*) AS total FROM employees WHERE company_id=? AND active=1 AND person_type='company'", (company_id,)).fetchone()["total"],
        "pending": db.execute("SELECT COUNT(*) AS total FROM laundry_orders WHERE company_id=? AND status='pending'", (company_id,)).fetchone()["total"],
        "month_approved": db.execute("SELECT COUNT(*) AS total FROM laundry_orders WHERE company_id=? AND status='approved' AND service_date>=?", (company_id, first_day)).fetchone()["total"],
        "month_amount": db.execute("SELECT COALESCE(SUM(subtotal),0) AS total FROM laundry_orders WHERE company_id=? AND status='approved' AND service_date>=?", (company_id, first_day)).fetchone()["total"],
        "month_pending_amount": db.execute("SELECT COALESCE(SUM(subtotal),0) AS total FROM laundry_orders WHERE company_id=? AND status='pending' AND service_date>=?", (company_id, first_day)).fetchone()["total"],
    }
    latest = order_query()[:8]
    return render_template("dashboard.html", metrics=metrics, latest=latest)


@app.route("/employees", methods=["GET", "POST"])
@roles_required("admin", "supervisor")
def employees() -> Any:
    db = get_db()
    if request.method == "POST":
        code = request.form.get("employee_code", "").strip()
        name = request.form.get("name", "").strip()
        person_type = request.form.get("person_type", "company")
        if person_type not in ("company", "general"):
            person_type = "company"
        if not code or not name:
            flash("رقم الموظف والاسم مطلوبان.", "error")
        else:
            try:
                db.execute(
                    "INSERT INTO employees(company_id,employee_code,name,company,department,phone,person_type,notes) VALUES(?,?,?,?,?,?,?,?)",
                    (require_company_id(), code, name, request.form.get("company", "").strip(), request.form.get("department", "").strip(), request.form.get("phone", "").strip(), person_type, request.form.get("notes", "").strip()),
                )
                db.commit()
                flash("تمت إضافة السجل بنجاح.", "success")
                return redirect(url_for("employees"))
            except (sqlite3.IntegrityError, psycopg.IntegrityError) as exc:
                db.rollback()
                flash("رقم الموظف مستخدم من قبل. أدخل رقماً مختلفاً.", "error")
    q = request.args.get("q", "").strip()
    type_filter = request.args.get("type", "all")
    service_filter = request.args.get("service", "all")
    company_id = require_company_id()
    where, params, q, type_filter, service_filter, active_filter = employee_filters()
    sql = "SELECT * FROM employees WHERE " + where + " ORDER BY active DESC, LOWER(name)"
    rows = db.execute(sql, params).fetchall()
    service_types = [
        row["service_type"]
        for row in db.execute(
            "SELECT DISTINCT service_type FROM employees WHERE company_id=? AND service_type<>'' ORDER BY service_type",
            (company_id,),
        ).fetchall()
    ]
    return render_template(
        "employees.html",
        employees=rows,
        q=q,
        type_filter=type_filter,
        service_filter=service_filter,
        active_filter=active_filter,
        service_types=service_types,
    )


@app.route("/employees/export")
@roles_required("admin", "supervisor")
def employees_export() -> Any:
    from report_exports import build_table_csv, build_table_pdf, build_table_xlsx

    where, params, q, type_filter, service_filter, active_filter = employee_filters()
    rows = get_db().execute(
        "SELECT * FROM employees WHERE " + where + " ORDER BY active DESC, LOWER(name)", params
    ).fetchall()
    headers = ["رقم الموظف", "الاسم", "النوع", "الشركة", "القسم", "الهاتف", "نوع الخدمة", "السكن", "الوظيفة", "الحالة"]
    table_rows = [
        [
            row["employee_code"],
            row["name"],
            "موظف شركة" if row["person_type"] == "company" else "زائر / ضيف",
            row["company"] or "",
            row["department"] or "",
            row["phone"] or "",
            row["service_type"] or "",
            row["housing_location"] or "",
            row["job_title"] or "",
            "نشط" if row["active"] else "موقوف",
        ]
        for row in rows
    ]
    fmt = requested_format()
    meta = [
        ("الشركة", get_setting("company_name", DEFAULT_COMPANY_NAME)),
        ("عدد السجلات", str(len(table_rows))),
        ("البحث", q or "الكل"),
        ("النوع", {"all": "الكل", "company": "موظفو الشركة", "general": "الزوار والسجل العام"}.get(type_filter, "الكل")),
        ("نوع الخدمة", service_filter or "الكل"),
        ("الحالة", {"all": "الكل", "active": "نشط", "inactive": "موقوف"}.get(active_filter, "الكل")),
        ("تاريخ التصدير", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    title = "قاعدة بيانات الموظفين"
    if fmt == "xlsx":
        content = build_table_xlsx(title, headers, table_rows, "الموظفون", meta, [14, 28, 16, 24, 20, 16, 16, 16, 18, 12])
    elif fmt == "pdf":
        subtitle = "; ".join(f"{key}: {value}" for key, value in meta)
        content = build_table_pdf(title, headers, table_rows, subtitle, [14, 30, 16, 26, 20, 16, 16, 16, 18, 12])
    else:
        content = build_table_csv(headers, table_rows)
    return export_response(content, fmt, f"employees-{date.today().isoformat()}")


@app.route("/employees/import", methods=["POST"])
@roles_required("admin", "supervisor")
def employees_import() -> Any:
    upload = request.files.get("csv_file")
    if not upload or not upload.filename:
        flash("اختر ملف CSV أولاً.", "error")
        return redirect(url_for("employees"))
    if Path(secure_filename(upload.filename)).suffix.lower() != ".csv":
        flash("يسمح باستيراد ملفات CSV فقط.", "error")
        return redirect(url_for("employees"))
    try:
        raw = upload.stream.read().decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(raw))
        aliases = {
            "employee_code": ("employee_code", "code", "رقم الموظف", "الرقم الوظيفي"),
            "name": ("name", "الاسم", "اسم الموظف"),
            "company": ("company", "الشركة", "جهة العمل"),
            "department": ("department", "القسم", "الإدارة"),
            "phone": ("phone", "الهاتف", "الجوال"),
        }
        header_map: dict[str, str] = {}
        for raw_header in (reader.fieldnames or []):
            trimmed = (raw_header or "").strip()
            for key, choices in aliases.items():
                if trimmed.lower() in [choice.lower() for choice in choices]:
                    header_map[key] = raw_header
        if "employee_code" not in header_map or "name" not in header_map:
            raise ValueError("يجب أن يحتوي الملف على عمودين على الأقل: employee_code و name (أو رقـم الموظف والاسم).")
        db = get_db()
        company_id = require_company_id()
        added = updated = skipped = 0
        for record in reader:
            code = (record.get(header_map["employee_code"]) or "").strip()
            name = (record.get(header_map["name"]) or "").strip()
            if not code or not name:
                skipped += 1
                continue
            def field_value(key: str) -> str:
                return (record.get(header_map.get(key, "")) or "").strip()
            existing = db.execute("SELECT id FROM employees WHERE company_id=? AND employee_code=?", (company_id, code)).fetchone()
            values = (name, field_value("company"), field_value("department"), field_value("phone"))
            if existing:
                db.execute("UPDATE employees SET name=?,company=?,department=?,phone=?,person_type='company',active=1 WHERE id=?", (*values, existing["id"]))
                updated += 1
            else:
                db.execute("INSERT INTO employees(company_id,employee_code,name,company,department,phone,person_type) VALUES(?,?,?,?,?,?,'company')", (company_id, code, *values))
                added += 1
        db.commit()
        flash(f"اكتمل الاستيراد: {added} سجل جديد، {updated} سجل محدّث، {skipped} سجل متجاوز.", "success")
    except (UnicodeDecodeError, csv.Error, ValueError, sqlite3.Error, psycopg.Error) as exc:
        if "db" in g:
            g.db.rollback()
        flash(f"تعذر استيراد الملف: {exc}", "error")
    return redirect(url_for("employees"))


@app.route("/employees/<int:employee_id>/edit", methods=["GET", "POST"])
@roles_required("admin", "supervisor")
def employee_edit(employee_id: int) -> Any:
    db = get_db()
    row = db.execute("SELECT * FROM employees WHERE id=? AND company_id=?", (employee_id, require_company_id())).fetchone()
    if not row:
        abort(404)
    if request.method == "POST":
        code = request.form.get("employee_code", "").strip()
        name = request.form.get("name", "").strip()
        person_type = request.form.get("person_type", "company")
        if person_type not in ("company", "general"):
            person_type = "company"
        if not code or not name:
            flash("رقم الموظف والاسم مطلوبان.", "error")
        else:
            try:
                db.execute("UPDATE employees SET employee_code=?,name=?,company=?,department=?,phone=?,person_type=?,notes=? WHERE id=? AND company_id=?", (code, name, request.form.get("company", "").strip(), request.form.get("department", "").strip(), request.form.get("phone", "").strip(), person_type, request.form.get("notes", "").strip(), employee_id, require_company_id()))
                db.commit()
                flash("تم تحديث بيانات السجل.", "success")
                return redirect(url_for("employees"))
            except (sqlite3.IntegrityError, psycopg.IntegrityError) as exc:
                db.rollback()
                flash("رقم الموظف مستخدم من سجل آخر.", "error")
        row = db.execute("SELECT * FROM employees WHERE id=? AND company_id=?", (employee_id, require_company_id())).fetchone()
    return render_template("employee_edit.html", employee=row)


@app.route("/employees/<int:employee_id>/toggle", methods=["POST"])
@roles_required("admin", "supervisor")
def employee_toggle(employee_id: int) -> Any:
    db = get_db()
    row = db.execute("SELECT * FROM employees WHERE id=? AND company_id=?", (employee_id, require_company_id())).fetchone()
    if not row:
        abort(404)
    db.execute("UPDATE employees SET active=? WHERE id=? AND company_id=?", (0 if row["active"] else 1, employee_id, require_company_id()))
    db.commit()
    flash("تم تحديث حالة السجل.", "success")
    return redirect(url_for("employees"))


@app.route("/rates", methods=["GET", "POST"])
@roles_required("admin")
def rates() -> Any:
    db = get_db()
    if request.method == "POST":
        code = request.form.get("code", "").strip().upper().replace(" ", "_")
        name = request.form.get("name", "").strip()
        unit = request.form.get("unit", "قطعة").strip() or "قطعة"
        try:
            rate = float(request.form.get("rate", "0"))
            if rate < 0 or not code or not name:
                raise ValueError
            db.execute("INSERT INTO service_items(company_id,code,name,unit,rate) VALUES(?,?,?,?,?)", (require_company_id(), code, name, unit, rate))
            db.commit()
            flash("تمت إضافة الخدمة والسعر.", "success")
            return redirect(url_for("rates"))
        except (ValueError, sqlite3.IntegrityError, psycopg.IntegrityError):
            db.rollback()
            flash("تعذرت الإضافة. تأكد من الاسم والرمز وأن السعر رقم غير سالب والرمز غير مكرر.", "error")
    where, params, q, active_filter = rate_filters()
    rows = db.execute(
        "SELECT * FROM service_items WHERE " + where + " ORDER BY active DESC, name",
        params,
    ).fetchall()
    return render_template("rates.html", services=rows, q=q, active_filter=active_filter)


@app.route("/rates/export")
@roles_required("admin")
def rates_export() -> Any:
    from report_exports import build_table_csv, build_table_pdf, build_table_xlsx

    where, params, q, active_filter = rate_filters()
    rows = get_db().execute(
        "SELECT * FROM service_items WHERE " + where + " ORDER BY active DESC, name", params
    ).fetchall()
    headers = ["رمز الخدمة", "اسم الخدمة", "وحدة الحساب", "السعر / الوحدة", "الحالة"]
    table_rows = [
        [row["code"], row["name"], row["unit"], float(row["rate"] or 0), "نشط" if row["active"] else "موقوف"]
        for row in rows
    ]
    fmt = requested_format()
    meta = [
        ("الشركة", get_setting("company_name", DEFAULT_COMPANY_NAME)),
        ("العملة", get_setting("currency", "ريال يمني")),
        ("عدد الخدمات", str(len(table_rows))),
        ("البحث", q or "الكل"),
        ("الحالة", {"all": "الكل", "active": "نشط", "inactive": "موقوف"}.get(active_filter, "الكل")),
        ("تاريخ التصدير", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    title = "الخدمات والأسعار"
    if fmt == "xlsx":
        content = build_table_xlsx(title, headers, table_rows, "الأسعار", meta, [16, 34, 16, 18, 12])
    elif fmt == "pdf":
        subtitle = "; ".join(f"{key}: {value}" for key, value in meta)
        content = build_table_pdf(title, headers, table_rows, subtitle, [18, 60, 20, 24, 16])
    else:
        content = build_table_csv(headers, table_rows)
    return export_response(content, fmt, f"rates-{date.today().isoformat()}")


@app.route("/rates/<int:item_id>/edit", methods=["POST"])
@roles_required("admin")
def rate_edit(item_id: int) -> Any:
    db = get_db()
    row = db.execute("SELECT id FROM service_items WHERE id=? AND company_id=?", (item_id, require_company_id())).fetchone()
    if not row:
        abort(404)
    name = request.form.get("name", "").strip()
    unit = request.form.get("unit", "قطعة").strip() or "قطعة"
    try:
        rate = float(request.form.get("rate", ""))
        if not name or rate < 0:
            raise ValueError
        db.execute("UPDATE service_items SET name=?,unit=?,rate=? WHERE id=? AND company_id=?", (name, unit, rate, item_id, require_company_id()))
        db.commit()
        flash("تم حفظ السعر. الطلبات السابقة تحتفظ بالسعر المسجل وقت إنشائها.", "success")
    except ValueError:
        flash("أدخل اسماً وسعراً صحيحاً غير سالب.", "error")
    return redirect(url_for("rates"))


@app.route("/rates/<int:item_id>/toggle", methods=["POST"])
@roles_required("admin")
def rate_toggle(item_id: int) -> Any:
    db = get_db()
    row = db.execute("SELECT active FROM service_items WHERE id=? AND company_id=?", (item_id, require_company_id())).fetchone()
    if not row:
        abort(404)
    db.execute("UPDATE service_items SET active=? WHERE id=? AND company_id=?", (0 if row["active"] else 1, item_id, require_company_id()))
    db.commit()
    flash("تم تحديث حالة الخدمة.", "success")
    return redirect(url_for("rates"))


@app.route("/rates/<int:item_id>/delete", methods=["POST"])
@roles_required("admin")
def rate_delete(item_id: int) -> Any:
    db = get_db()
    company_id = require_company_id()
    row = db.execute(
        "SELECT id, name FROM service_items WHERE id=? AND company_id=?", (item_id, company_id)
    ).fetchone()
    if not row:
        abort(404)
    used = db.execute(
        "SELECT COUNT(*) AS total FROM laundry_order_items WHERE service_item_id=?", (item_id,)
    ).fetchone()["total"]
    if used:
        db.execute("UPDATE service_items SET active=0 WHERE id=? AND company_id=?", (item_id, company_id))
        db.commit()
        flash("الخدمة مستخدمة في طلبات سابقة، لذلك تم تعطيلها بدل حذفها للحفاظ على سجل الطلبات.", "success")
    else:
        db.execute("DELETE FROM service_items WHERE id=? AND company_id=?", (item_id, company_id))
        db.commit()
        flash("تم حذف الخدمة نهائياً.", "success")
    return redirect(url_for("rates"))


@app.route("/transactions")
@login_required
def transactions() -> Any:
    where, params, start, end, status, fulfillment = order_filters()
    rows = order_query(where, tuple(params))
    return render_template(
        "transactions.html",
        orders=rows,
        date_from=start,
        date_to=end,
        status_filter=status,
        fulfillment_filter=fulfillment,
        q=request.args.get("q", ""),
    )


@app.route("/transactions/export")
@login_required
def transactions_export() -> Any:
    from report_exports import build_table_csv, build_table_pdf, build_table_xlsx

    where, params, start, end, status, fulfillment = order_filters()
    orders = order_query(where, tuple(params))
    headers = [
        "رقم الطلب",
        "التاريخ",
        "الموظف",
        "رقم الموظف",
        "الشركة",
        "القسم",
        "نوع الخدمة",
        "الأصناف والكميات",
        "الإجمالي",
        "الحالة",
        "التسليم",
        "مستلم الأصناف",
        "وقت الاستلام",
        "مدخل الطلب",
        "ملاحظات",
    ]
    status_labels = {"pending": "بانتظار التأكيد", "approved": "معتمد", "rejected": "مرفوض"}
    table_rows = []
    for order in orders:
        pieces = order_items_with_received(int(order["id"]))
        summary_text = "، ".join(
            f"{item['item_name']} ({_quantity_text(item['quantity'])} {item['unit']})" for item in pieces
        )
        table_rows.append(
            [
                order["reference"],
                order["service_date"],
                order["person_name"] or order["employee_name"],
                order["employee_code"],
                order["company"] or "",
                order["department"] or "",
                order["service_type"] or "",
                summary_text,
                float(order["subtotal"] or 0),
                status_labels.get(order["status"], order["status"]),
                "تم التسليم" if order["fulfillment_status"] == "delivered" else "لم يُسلَّم",
                order["receiver_name"] or "",
                order["received_at"] or "",
                order["creator_name"],
                order["notes"] or "",
            ]
        )
    fmt = requested_format()
    meta = [
        ("الشركة", get_setting("company_name", DEFAULT_COMPANY_NAME)),
        ("من تاريخ", start),
        ("إلى تاريخ", end),
        ("حالة الطلب", {"all": "الكل", **status_labels}.get(status, status)),
        (
            "حالة التسليم",
            {"all": "الكل", "received": "لم يُسلَّم", "delivered": "تم التسليم", "partial": "مستلم جزئياً"}.get(
                fulfillment, fulfillment
            ),
        ),
        ("عدد الطلبات", str(len(table_rows))),
        ("تاريخ التصدير", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    title = "سجل طلبات المغسلة"
    if fmt == "xlsx":
        content = build_table_xlsx(
            title, headers, table_rows, "الطلبات", meta, [15, 12, 26, 12, 22, 16, 14, 44, 14, 16, 12, 22, 20, 18, 24]
        )
    elif fmt == "pdf":
        subtitle = "; ".join(f"{key}: {value}" for key, value in meta)
        content = build_table_pdf(
            title, headers, table_rows, subtitle, [22, 18, 40, 18, 32, 24, 20, 60, 20, 24, 18, 32, 30, 26, 34]
        )
    else:
        content = build_table_csv(headers, table_rows)
    return export_response(content, fmt, f"transactions-{start}-{end}")


@app.route("/transactions/new", methods=["GET", "POST"])
@roles_required("admin", "contractor")
def transaction_new() -> Any:
    db = get_db()
    company_id = require_company_id()
    service_rows = db.execute("SELECT * FROM service_items WHERE company_id=? AND active=1 ORDER BY name", (company_id,)).fetchall()
    employees = db.execute(
        "SELECT * FROM employees WHERE company_id=? AND active=1 ORDER BY name", (company_id,)
    ).fetchall()
    if request.method == "POST":
        employee_id = request.form.get("employee_id", type=int)
        service_date = safe_date(request.form.get("service_date", ""), "")
        if not service_date:
            service_date = ""
        person_name = request.form.get("person_name", "").strip()
        notes = request.form.get("notes", "").strip()
        selected_ids = request.form.getlist("service_item_id")
        quantities = request.form.getlist("quantity")
        employee = db.execute("SELECT * FROM employees WHERE id=? AND company_id=? AND active=1", (employee_id, company_id)).fetchone() if employee_id else None
        if not employee:
            flash("اختر موظفاً فعالاً من قاعدة البيانات.", "error")
        elif not service_date:
            flash("أدخل تاريخ الخدمة بشكل صحيح.", "error")
        elif employee["person_type"] == "general" and not person_name:
            flash("للسجل العام، اكتب اسم الزائر أو الضيف الفعلي.", "error")
        else:
            line_data: list[tuple[Any, float]] = []
            errors: list[str] = []
            for item_id_str, qty_str in zip(selected_ids, quantities):
                if not item_id_str:
                    continue
                try:
                    qty = float(qty_str)
                    item_id = int(item_id_str)
                except (ValueError, TypeError):
                    errors.append("أحد الأصناف أو الكميات غير صحيح.")
                    break
                item = db.execute("SELECT * FROM service_items WHERE id=? AND company_id=? AND active=1", (item_id, company_id)).fetchone()
                if not item or qty <= 0:
                    errors.append("تحقق من الصنف والكمية؛ الكمية يجب أن تكون أكبر من صفر.")
                    break
                line_data.append((item, qty))
            if not line_data and not errors:
                errors.append("أضف صنفاً واحداً على الأقل للطلب.")
            if errors:
                flash(errors[0], "error")
            else:
                subtotal = sum(float(item["rate"]) * qty for item, qty in line_data)
                cursor = db.execute(
                    "INSERT INTO laundry_orders(company_id,employee_id,person_name,service_date,notes,status,subtotal,created_by) VALUES(?,?,?,?,?, 'pending',?,?) RETURNING id",
                    (company_id, employee_id, person_name, service_date, notes, subtotal, current_user()["id"]),
                )
                order_id = cursor.fetchone()["id"]
                reference = f"LND-{datetime.now():%y%m}-{order_id:06d}"
                db.execute("UPDATE laundry_orders SET reference=? WHERE id=?", (reference, order_id))
                for item, qty in line_data:
                    rate = float(item["rate"])
                    db.execute(
                        "INSERT INTO laundry_order_items(order_id,service_item_id,item_name,unit,quantity,unit_price,line_total) VALUES(?,?,?,?,?,?,?)",
                        (order_id, item["id"], item["name"], item["unit"], qty, rate, rate * qty),
                    )
                db.commit()
                flash(f"تم تسجيل الطلب {reference} وإرساله إلى مشرف السكن للمراجعة.", "success")
                for warning in employee_shift_warnings(employee, service_date):
                    flash(warning, "warning")
                return redirect(url_for("transaction_detail", order_id=order_id))
    return render_template("transaction_form.html", employees=employees, services=service_rows)


@app.route("/transactions/<int:order_id>")
@login_required
def transaction_detail(order_id: int) -> Any:
    rows = order_query("o.id=?", (order_id,))
    if not rows:
        abort(404)
    order = rows[0]
    warnings = employee_shift_warnings(order, order["service_date"])
    cycle = employee_cycle(order, safe_date(order["service_date"], ""))
    receiver_options = [
        row["name"]
        for row in get_db().execute(
            "SELECT name FROM employees WHERE company_id=? AND active=1 ORDER BY name",
            (require_company_id(),),
        ).fetchall()
    ]
    items = order_items_with_received(order_id)
    return render_template(
        "transaction_detail.html",
        order=order,
        items=items,
        receipts=order_receipts(order_id),
        remaining_total=sum(item["remaining"] for item in items),
        shift_warnings=warnings,
        shift_cycle=cycle,
        receiver_options=receiver_options,
    )


def delivery_form_details(db: Any, order: Any) -> tuple[str, str, list[tuple[int, float]], str]:
    """قراءة خيارات مستلم الأصناف والقطع المستلمة من نموذج تسليم المغسلة.

    يُرجع (نوع المستلم، اسم المستلم، [(معرف الصنف، الكمية المستلمة)]) أو خطأ نصياً عند عدم التطابق.
    """
    receiver_kind = request.form.get("receiver_kind", "same_employee").strip()
    if receiver_kind not in ("same_employee", "other"):
        return ("", "", [], "اختر خيار مستلم الأصناف الصحيح.")
    receiver_name = request.form.get("receiver_name", "").strip()
    if receiver_kind == "other" and not receiver_name:
        return ("", "", [], "اكتب اسم مستلم الأصناف الآخر بعد استكمال الغسل.")
    if receiver_kind == "same_employee":
        receiver_name = row_value(order, "person_name") or row_value(order, "display_name") or ""
    items = db.execute(
        "SELECT i.id, i.item_name, i.quantity, COALESCE(i.received_quantity, 0) AS received_quantity "
        "FROM laundry_order_items i WHERE i.order_id=? ORDER BY i.id",
        (order["id"],),
    ).fetchall()
    received_lines: list[tuple[int, float]] = []
    for item in items:
        checked = request.form.get(f"piece_received_{item['id']}") == "1"
        if not checked:
            continue
        qty_raw = request.form.get(f"received_qty_{item['id']}", "").strip()
        try:
            qty = float(qty_raw)
        except (TypeError, ValueError):
            return ("", "", [], f"الكمية المستلمة للصنف {item['item_name']} غير صحيحة.")
        if qty <= 0:
            return ("", "", [], f"أدخل كمية مستلمة أكبر من صفر للصنف {item['item_name']}، أو أزل علامة الاستلام.")
        remaining = float(item["quantity"]) - float(item["received_quantity"] or 0)
        if qty > remaining + 1e-9:
            return ("", "", [], f"الكمية المستلمة للصنف {item['item_name']} أكبر من المتبقي للاستلام ({remaining:g}).")
        received_lines.append((item["id"], qty))
    if not received_lines:
        return ("", "", [], "حدّد القطع التي تم استلامها من المغسلة مع الكميات.")
    return (receiver_kind, receiver_name, received_lines, "")


@app.route("/transactions/<int:order_id>/deliver", methods=["POST"])
@roles_required("admin", "contractor")
def transaction_deliver(order_id: int) -> Any:
    db = get_db()
    company_id = require_company_id()
    order = db.execute(
        """SELECT o.*, e.name AS display_name FROM laundry_orders o
           JOIN employees e ON e.id=o.employee_id WHERE o.id=? AND o.company_id=?""",
        (order_id, company_id),
    ).fetchone()
    if not order:
        abort(404)
    remaining_row = db.execute(
        "SELECT COALESCE(SUM(i.quantity - COALESCE(i.received_quantity, 0)), 0) AS remaining "
        "FROM laundry_order_items i WHERE i.order_id=?",
        (order_id,),
    ).fetchone()
    remaining_total = float(remaining_row["remaining"] or 0)
    if order["status"] == "rejected":
        flash("لا يمكن تسجيل استلام لطلب مرفوض.", "error")
    elif remaining_total <= 0:
        flash("تم استلام جميع القطع في هذا الطلب مسبقاً.", "warning")
    else:
        receiver_kind, receiver_name, received_lines, error = delivery_form_details(db, order)
        if error:
            flash(error, "error")
            return redirect(url_for("transaction_detail", order_id=order_id))
        receipt_row = db.execute(
            "INSERT INTO laundry_receipts(company_id,order_id,receiver_kind,receiver_name,received_by,received_at) "
            "VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id",
            (company_id, order_id, receiver_kind, receiver_name, current_user()["id"]),
        ).fetchone()
        receipt_id = receipt_row["id"]
        for item_id, qty in received_lines:
            db.execute(
                "INSERT INTO laundry_receipt_items(receipt_id,order_item_id,quantity) VALUES(?,?,?)",
                (receipt_id, item_id, qty),
            )
            db.execute(
                "UPDATE laundry_order_items SET received_quantity=COALESCE(received_quantity, 0)+? "
                "WHERE id=? AND order_id=?",
                (qty, item_id, order_id),
            )
        db.execute(
            """UPDATE laundry_orders SET fulfillment_status='delivered',
               delivered_at=COALESCE(delivered_at, CURRENT_TIMESTAMP),
               delivered_by=COALESCE(delivered_by, ?),
               receiver_kind=?, receiver_name=?, received_at=CURRENT_TIMESTAMP
               WHERE id=? AND company_id=?""",
            (current_user()["id"], receiver_kind, receiver_name, order_id, company_id),
        )
        db.commit()
        if remaining_total - sum(qty for _, qty in received_lines) > 0:
            flash("تم تسجيل الاستلام، وما زالت هناك قطع متبقية يمكن استلامها لاحقاً من نفس اللوحة.", "success")
        elif order["status"] == "pending":
            flash("تم استلام جميع القطع النظيفة من المغسلة، وأصبح الطلب جاهزاً لمراجعة مشرف السكن.", "success")
        else:
            flash("تم استلام جميع القطع النظيفة من المغسلة.", "success")
    return redirect(url_for("transaction_detail", order_id=order_id))


@app.route("/transactions/<int:order_id>/confirm", methods=["POST"])
@roles_required("admin", "supervisor")
def transaction_confirm(order_id: int) -> Any:
    db = get_db()
    order = db.execute("SELECT * FROM laundry_orders WHERE id=? AND company_id=?", (order_id, require_company_id())).fetchone()
    if not order:
        abort(404)
    if order["status"] != "pending":
        flash("هذا الطلب تمت مراجعته مسبقاً ولا يمكن تأكيده مرة أخرى.", "error")
        return redirect(url_for("transaction_detail", order_id=order_id))
    decision = request.form.get("decision", "")
    if decision not in ("approved", "rejected"):
        flash("اختر قرار المراجعة الصحيح.", "error")
        return redirect(url_for("transaction_detail", order_id=order_id))
    if decision == "approved" and order["fulfillment_status"] != "delivered":
        flash("لا يمكن اعتماد المستحقات قبل تسجيل تسليم الملابس أو المفروشات للموظف.", "error")
        return redirect(url_for("transaction_detail", order_id=order_id))
    reason = request.form.get("rejection_reason", "").strip()
    if decision == "rejected" and not reason:
        flash("اكتب سبب الرفض لتوضيح المطلوب تعديله.", "error")
        return redirect(url_for("transaction_detail", order_id=order_id))
    db.execute("UPDATE laundry_orders SET status=?,confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP,rejection_reason=? WHERE id=? AND company_id=?", (decision, current_user()["id"], reason, order_id, require_company_id()))
    db.commit()
    flash("تم اعتماد الطلب." if decision == "approved" else "تم رفض الطلب وتسجيل السبب.", "success")
    return redirect(url_for("transaction_detail", order_id=order_id))


@app.route("/transactions/<int:order_id>/delete", methods=["POST"])
@roles_required("admin", "contractor")
def transaction_delete(order_id: int) -> Any:
    db = get_db()
    user = current_user()
    order = db.execute(
        "SELECT status, created_by, company_id FROM laundry_orders WHERE id=?", (order_id,)
    ).fetchone()
    if not order or int(order["company_id"]) != require_company_id():
        abort(404)
    if user["role"] == "contractor" and (
        order["status"] != "pending" or int(order["created_by"]) != int(user["id"])
    ):
        flash("يمكنك حذف طلباتك التي لم تُعتمد فقط.", "error")
        return redirect(url_for("transactions"))
    db.execute("DELETE FROM laundry_orders WHERE id=? AND company_id=?", (order_id, require_company_id()))
    db.commit()
    flash("تم حذف الطلب نهائياً.", "success")
    return redirect(url_for("transactions"))


@app.route("/reports")
@login_required
def reports() -> Any:
    where, params, start, end, status, fulfillment = order_filters()
    rows = order_query(where, tuple(params))
    for row in rows:
        row_items = order_items(row["id"])
        # sqlite Row is immutable; keep the corresponding lines in a separate mapping in template.
    lines = {row["id"]: order_items(row["id"]) for row in rows}
    approved_total = sum(float(r["subtotal"] or 0) for r in rows if r["status"] == "approved")
    pending_total = sum(float(r["subtotal"] or 0) for r in rows if r["status"] == "pending")
    rejected_total = sum(float(r["subtotal"] or 0) for r in rows if r["status"] == "rejected")
    order_ids = [row["id"] for row in rows]
    summary = employee_item_summary(order_ids)
    service_type_totals = employee_item_summary(order_ids, group_by="service_type")
    return render_template("reports.html", orders=rows, lines=lines, date_from=start, date_to=end, status_filter=status, fulfillment_filter=fulfillment, q=request.args.get("q", ""), approved_total=approved_total, pending_total=pending_total, rejected_total=rejected_total, summary=summary, service_type_totals=service_type_totals)


@app.route("/reports/export")
@app.route("/reports/export.csv")
@login_required
def report_export() -> Any:
    from report_exports import build_pdf, build_xlsx

    where, params, from_date, to_date, status_filter, fulfillment_filter = order_filters()
    orders = [dict(row) for row in order_query(where, tuple(params))]
    items_by_order = {
        int(order["id"]): [dict(item) for item in order_items(int(order["id"]))]
        for order in orders
    }
    order_ids = [int(order["id"]) for order in orders]
    payload = {
        "company_name": get_setting("company_name", DEFAULT_COMPANY_NAME),
        "currency": get_setting("currency", "ريال يمني"),
        "start": from_date,
        "end": to_date,
        "status": status_filter,
        "fulfillment": fulfillment_filter,
        "orders": orders,
        "items_by_order": items_by_order,
        "summary": employee_item_summary(order_ids),
        "service_summary": employee_item_summary(order_ids, group_by="service_type"),
        "totals": {
            "approved": sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "approved"),
            "pending": sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "pending"),
            "rejected": sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "rejected"),
        },
    }
    fmt = request.args.get("format", "csv").strip().lower()
    if request.path.endswith(".csv"):
        fmt = "csv"
    if fmt in ("xlsx", "pdf"):
        data = build_xlsx(payload) if fmt == "xlsx" else build_pdf(payload)
        response = make_response(data)
        response.headers["Content-Type"] = (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if fmt == "xlsx"
            else "application/pdf"
        )
        response.headers["Content-Disposition"] = (
            f"attachment; filename=laundry-report-{from_date or 'all'}-{to_date or 'all'}.{fmt}"
        )
        return response

    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["رقم الطلب", "التاريخ", "رقم الموظف", "الاسم", "الشركة", "القسم", "الصنف", "الكمية", "المستلم", "المتبقي", "الوحدة", "سعر الوحدة", "الإجمالي", "الحالة", "التسليم", "مستلم الأصناف", "وقت الاستلام", "مدخل الطلب", "المعتمد", "ملاحظات"])
    for order in orders:
        for item in items_by_order[int(order["id"])]:
            received = item.get("received_quantity")
            remaining = (
                max(float(item.get("quantity") or 0) - float(received or 0), 0.0)
                if received is not None
                else item.get("quantity")
            )
            writer.writerow([
                order["reference"], order["service_date"], order["employee_code"],
                order["person_name"] or order["employee_name"], order["company"], order["department"],
                item["item_name"], item["quantity"], received if received is not None else "", remaining,
                item["unit"], item["unit_price"], item["line_total"],
                {"pending": "بانتظار التأكيد", "approved": "معتمد", "rejected": "مرفوض"}[order["status"]],
                {"received": "لم يُسلَّم", "delivered": "تم التسليم"}.get(order["fulfillment_status"], ""),
                order.get("receiver_name") or "", order.get("received_at") or "",
                order["creator_name"], order["confirmer_name"] or "", order["notes"],
            ])
    writer.writerow([])
    writer.writerow(["ملخص كميات الغسيل لكل موظف"])
    writer.writerow(["رقم الموظف", "الاسم", "نوع الخدمة", "الصنف", "الكمية", "الوحدة"])
    units = {
        item["item_name"]: item["unit"]
        for items in items_by_order.values()
        for item in items
    }
    for entry in payload["summary"]["rows"]:
        for name in payload["summary"]["columns"]:
            quantity = entry["quantities"].get(name)
            if quantity:
                writer.writerow([entry["employee_code"], entry["employee_name"], entry["service_type"], name, quantity, units.get(name, "")])
    writer.writerow([])
    writer.writerow(["الفترة", from_date, "إلى", to_date, "العملة", payload["currency"]])
    writer.writerow(["إجمالي المعتمد", payload["totals"]["approved"]])
    writer.writerow(["إجمالي المعلّق", payload["totals"]["pending"]])
    writer.writerow(["إجمالي المرفوض", payload["totals"]["rejected"]])
    response = make_response("\ufeff" + output.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f"attachment; filename=laundry-report-{from_date or 'all'}-{to_date or 'all'}.csv"
    return response


@app.route("/reports/housing")
@roles_required("admin", "supervisor")
def housing_report() -> Any:
    today = date.today()
    start = safe_date(request.args.get("from", ""), today.replace(day=1).isoformat())
    end = safe_date(request.args.get("to", ""), today.isoformat())
    housing_only = request.args.get("housing") == "1"
    data = housing_report_data(require_company_id(), start, end, housing_only)
    data.update(
        {
            "company_name": get_setting("company_name", DEFAULT_COMPANY_NAME),
            "currency": get_setting("currency", "ريال يمني"),
            "today": today.isoformat(),
        }
    )
    return render_template("housing_report.html", report=data)


@app.route("/reports/housing/export")
@roles_required("admin", "supervisor")
def housing_report_export() -> Any:
    from report_exports import build_housing_pdf, build_housing_xlsx

    today = date.today()
    start = safe_date(request.args.get("from", ""), today.replace(day=1).isoformat())
    end = safe_date(request.args.get("to", ""), today.isoformat())
    housing_only = request.args.get("housing") == "1"
    data = housing_report_data(require_company_id(), start, end, housing_only)
    data.update(
        {
            "company_name": get_setting("company_name", DEFAULT_COMPANY_NAME),
            "currency": get_setting("currency", "ريال يمني"),
            "today": today.isoformat(),
        }
    )
    fmt = request.args.get("format", "csv").strip().lower()
    stamp = f"{data['start']}-{data['end']}"
    if fmt in ("xlsx", "pdf"):
        data_bytes = build_housing_xlsx(data) if fmt == "xlsx" else build_housing_pdf(data)
        response = make_response(data_bytes)
        response.headers["Content-Type"] = (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            if fmt == "xlsx"
            else "application/pdf"
        )
        response.headers["Content-Disposition"] = (
            f"attachment; filename=housing-report-{stamp}.{fmt}"
        )
        return response

    output = io.StringIO(newline="")
    writer = csv.writer(output)
    summary = data["summary"]
    writer.writerow([data["company_name"], "تقرير غسيل سكن الموظفين", f"{data['start']} إلى {data['end']}"])
    writer.writerow([
        "عدد الموظفين", summary["employees_total"], "المتواجدون بالسكن", summary["housing_total"],
        "بدون غسيل", summary["no_laundry"], "مكتمل", summary["complete"], "جزئي", summary["partial"],
        "متوسط التغطية %", summary["avg_percentage"],
    ])
    writer.writerow([])
    writer.writerow([
        "رقم الموظف", "الاسم", "القسم", "الوظيفة", "السكن", "نوع الخدمة", "نظام الدوام",
        "أيام الدورة", "عدد الدورات", "ملاية مسلّمة", "ملاية مستهدفة", "مخدة مسلّمة",
        "مخدة مستهدفة", "بطانيات", "التغطية %", "الحالة", "النواقص", "حالة التواجد",
    ])
    for row in data["rows"]:
        writer.writerow([
            row["employee_code"], row["employee_name"], row["department"], row["job_title"],
            row["housing_location"], row["service_type"], row["shift_label"],
            row["effective_cycle_days"], row["cycles"], row["sheets"], row["target_sheets"],
            row["pillows"], row["target_pillows"], row["blankets"], row["percentage"],
            row["coverage_status"], "، ".join(row["missing"]), row["housing_label"],
        ])
    response = make_response("\ufeff" + output.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f"attachment; filename=housing-report-{stamp}.csv"
    return response


@app.route("/admin/orders")
@login_required
def admin_orders() -> Any:
    user = current_user()
    if not _is_system_admin(user):
        abort(403)
    db = get_db()
    today = date.today()
    start = safe_date(request.args.get("from", ""), today.replace(day=1).isoformat())
    end = safe_date(request.args.get("to", ""), today.isoformat())
    if start > end:
        start, end = end, start
    status_filter = request.args.get("status", "all")
    if status_filter not in {"all", "pending", "approved", "rejected"}:
        status_filter = "all"
    fulfillment_filter = request.args.get("fulfillment", "all")
    if fulfillment_filter not in {"all", "received", "delivered", "partial"}:
        fulfillment_filter = "all"
    company_filter = request.args.get("company", "").strip()
    search = request.args.get("q", "").strip()
    conditions = ["o.service_date >= ?", "o.service_date <= ?"]
    params: list[Any] = [start, end]
    if status_filter != "all":
        conditions.append("o.status = ?")
        params.append(status_filter)
    if fulfillment_filter in ("received", "delivered"):
        conditions.append("o.fulfillment_status = ?")
        params.append(fulfillment_filter)
    elif fulfillment_filter == "partial":
        conditions.append(
            "(o.fulfillment_status = 'delivered' AND EXISTS ("
            "SELECT 1 FROM laundry_order_items ri WHERE ri.order_id = o.id "
            "AND COALESCE(ri.received_quantity, 0) < ri.quantity))"
        )
    if company_filter.isdigit():
        conditions.append("o.company_id = ?")
        params.append(int(company_filter))
    if search:
        like = f"%{search}%"
        conditions.append(
            "(o.reference LIKE ? OR e.name LIKE ? OR e.employee_code LIKE ? OR o.person_name LIKE ? OR c.name LIKE ?)"
        )
        params.extend([like, like, like, like, like])
    sql = (
        "SELECT o.*, e.employee_code, e.name AS employee_name, e.department, "
        "c.name AS company_name, u.full_name AS creator_name "
        "FROM laundry_orders o "
        "JOIN employees e ON e.id=o.employee_id "
        "JOIN companies c ON c.id=o.company_id "
        "LEFT JOIN users u ON u.id=o.created_by "
        "WHERE " + " AND ".join(conditions) + " ORDER BY o.service_date DESC, o.id DESC LIMIT 1000"
    )
    rows = db.execute(sql, tuple(params)).fetchall()
    companies = db.execute("SELECT id, code, name FROM companies ORDER BY name").fetchall()
    return render_template(
        "admin_orders.html",
        orders=rows,
        companies=companies,
        date_from=start,
        date_to=end,
        status_filter=status_filter,
        fulfillment_filter=fulfillment_filter,
        company_filter=company_filter,
        q=search,
    )


@app.route("/admin/orders/export")
@login_required
def admin_orders_export() -> Any:
    from report_exports import build_table_csv, build_table_pdf, build_table_xlsx

    user = current_user()
    if not _is_system_admin(user):
        abort(403)
    db = get_db()
    today = date.today()
    start = safe_date(request.args.get("from", ""), today.replace(day=1).isoformat())
    end = safe_date(request.args.get("to", ""), today.isoformat())
    if start > end:
        start, end = end, start
    status_filter = request.args.get("status", "all")
    if status_filter not in {"all", "pending", "approved", "rejected"}:
        status_filter = "all"
    fulfillment_filter = request.args.get("fulfillment", "all")
    if fulfillment_filter not in {"all", "received", "delivered", "partial"}:
        fulfillment_filter = "all"
    company_filter = request.args.get("company", "").strip()
    search = request.args.get("q", "").strip()
    conditions = ["o.service_date >= ?", "o.service_date <= ?"]
    params: list[Any] = [start, end]
    if status_filter != "all":
        conditions.append("o.status = ?")
        params.append(status_filter)
    if fulfillment_filter in ("received", "delivered"):
        conditions.append("o.fulfillment_status = ?")
        params.append(fulfillment_filter)
    elif fulfillment_filter == "partial":
        conditions.append(
            "(o.fulfillment_status = 'delivered' AND EXISTS ("
            "SELECT 1 FROM laundry_order_items ri WHERE ri.order_id = o.id "
            "AND COALESCE(ri.received_quantity, 0) < ri.quantity))"
        )
    if company_filter.isdigit():
        conditions.append("o.company_id = ?")
        params.append(int(company_filter))
    if search:
        like = f"%{search}%"
        conditions.append(
            "(o.reference LIKE ? OR e.name LIKE ? OR e.employee_code LIKE ? OR o.person_name LIKE ? OR c.name LIKE ?)"
        )
        params.extend([like, like, like, like, like])
    sql = (
        "SELECT o.*, e.employee_code, e.name AS employee_name, e.department, "
        "c.name AS company_name, u.full_name AS creator_name "
        "FROM laundry_orders o "
        "JOIN employees e ON e.id=o.employee_id "
        "JOIN companies c ON c.id=o.company_id "
        "LEFT JOIN users u ON u.id=o.created_by "
        "WHERE " + " AND ".join(conditions) + " ORDER BY o.service_date DESC, o.id DESC LIMIT 5000"
    )
    rows = db.execute(sql, tuple(params)).fetchall()
    headers = [
        "#",
        "رقم الطلب",
        "الشركة",
        "الموظف",
        "رقم الموظف",
        "التاريخ",
        "الإجمالي",
        "الحالة",
        "التسليم",
        "مستلم الأصناف",
        "وقت الاستلام",
    ]
    status_labels = {"pending": "بانتظار التأكيد", "approved": "معتمد", "rejected": "مرفوض"}
    table_rows = [
        [
            index,
            row["reference"],
            row["company_name"],
            row["person_name"] or row["employee_name"],
            row["employee_code"],
            row["service_date"],
            float(row["subtotal"] or 0),
            status_labels.get(row["status"], row["status"]),
            "تم التسليم" if row["fulfillment_status"] == "delivered" else "لم يُسلَّم",
            row["receiver_name"] or "",
            row["received_at"] or "",
        ]
        for index, row in enumerate(rows, start=1)
    ]
    fmt = requested_format()
    meta = [
        ("الفترة", f"{start} — {end}"),
        ("حالة الطلب", {"all": "الكل", **status_labels}.get(status_filter, status_filter)),
        (
            "حالة التسليم",
            {"all": "الكل", "received": "لم يُسلَّم", "delivered": "تم التسليم", "partial": "مستلم جزئياً"}.get(
                fulfillment_filter, fulfillment_filter
            ),
        ),
        ("الشركة", next((c["name"] for c in db.execute("SELECT id, name FROM companies").fetchall() if str(c["id"]) == company_filter), "كل الشركات")),
        ("عدد الطلبات", str(len(table_rows))),
        ("تاريخ التصدير", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    title = "طلبات جميع الشركات"
    if fmt == "xlsx":
        content = build_table_xlsx(title, headers, table_rows, "الطلبات", meta, [6, 16, 22, 26, 12, 12, 14, 16, 12, 22, 20])
    elif fmt == "pdf":
        subtitle = "; ".join(f"{key}: {value}" for key, value in meta)
        content = build_table_pdf(title, headers, table_rows, subtitle, [8, 24, 34, 44, 18, 20, 22, 26, 20, 34, 30])
    else:
        content = build_table_csv(headers, table_rows)
    return export_response(content, fmt, f"admin-orders-{start}-{end}")


@app.route("/admin/orders/<int:order_id>/delete", methods=["POST"])
@login_required
def admin_order_delete(order_id: int) -> Any:
    user = current_user()
    if not _is_system_admin(user):
        abort(403)
    db = get_db()
    row = db.execute("SELECT id FROM laundry_orders WHERE id=?", (order_id,)).fetchone()
    if not row:
        abort(404)
    db.execute("DELETE FROM laundry_orders WHERE id=?", (order_id,))
    db.commit()
    flash("تم حذف الطلب نهائياً.", "success")
    return redirect(url_for("admin_orders"))


@app.route("/companies", methods=["GET", "POST"])
@login_required
def companies() -> Any:
    user = current_user()
    if not _is_system_admin(user):
        abort(403)
    db = get_db()
    if request.method == "POST":
        code = request.form.get("code", "").strip().upper()
        name = request.form.get("name", "").strip()
        admin_username = request.form.get("admin_username", "").strip()
        admin_password = request.form.get("admin_password", "")
        admin_name = request.form.get("admin_name", "").strip() or f"مدير {name}"
        if not code or not name:
            flash("رمز الشركة واسمها مطلوبان.", "error")
        elif admin_username and len(admin_password) < 8:
            flash("كلمة مرور مدير الشركة يجب ألا تقل عن 8 أحرف.", "error")
        else:
            try:
                company_id = create_company(db, code, name)
                if admin_username:
                    db.execute(
                        "INSERT INTO users(username,password_hash,full_name,role,company_id) "
                        "VALUES(?,?,?,'admin',?)",
                        (admin_username, generate_password_hash(admin_password), admin_name, company_id),
                    )
                db.commit()
                flash(f"تم إنشاء الشركة «{name}»." + (" وأضيف مديرها." if admin_username else ""), "success")
                return redirect(url_for("companies"))
            except (ValueError, sqlite3.IntegrityError, psycopg.IntegrityError) as exc:
                db.rollback()
                flash("تعذر إنشاء الشركة. تأكد من عدم تكرار رمز الشركة أو اسم المستخدم.", "error")
    rows = db.execute(
        """
        SELECT c.*,
               (SELECT COUNT(*) FROM employees e WHERE e.company_id=c.id AND e.active=1) AS employees,
               (SELECT COUNT(*) FROM users u WHERE u.company_id=c.id) AS users,
               (SELECT COUNT(*) FROM laundry_orders o WHERE o.company_id=c.id) AS orders
        FROM companies c ORDER BY c.id
        """
    ).fetchall()
    return render_template("companies.html", companies=rows)



@app.route("/companies/<int:company_id>/toggle", methods=["POST"])
@login_required
def company_toggle(company_id: int) -> Any:
    user = current_user()
    if not _is_system_admin(user):
        abort(403)
    db = get_db()
    row = db.execute("SELECT active FROM companies WHERE id=?", (company_id,)).fetchone()
    if not row:
        abort(404)
    db.execute("UPDATE companies SET active=? WHERE id=?", (0 if row["active"] else 1, company_id))
    db.commit()
    flash("تم تحديث حالة الشركة.", "success")
    return redirect(url_for("companies"))


@app.route("/settings", methods=["GET", "POST"])
@roles_required("admin")
def settings() -> Any:
    if request.method == "POST":
        currency = request.form.get("currency", "").strip()
        company_name = request.form.get("company_name", "").strip()
        if not currency or not company_name:
            flash("اسم النظام والعملة مطلوبان.", "error")
        else:
            set_setting("currency", currency)
            set_setting("company_name", company_name)
            get_db().execute(
                "UPDATE companies SET name=? WHERE id=?", (company_name, require_company_id())
            )
            get_db().commit()
            flash("تم حفظ الإعدادات.", "success")
            return redirect(url_for("settings"))
    company = get_db().execute("SELECT name FROM companies WHERE id=?", (require_company_id(),)).fetchone()
    return render_template(
        "settings.html",
        company_name_value=company["name"] if company else DEFAULT_COMPANY_NAME,
        currency_value=get_setting("currency", "ريال يمني"),
    )


@app.route("/users", methods=["GET", "POST"])
@roles_required("admin")
def users() -> Any:
    db = get_db()
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        full_name = request.form.get("full_name", "").strip()
        password = request.form.get("password", "")
        role = request.form.get("role", "contractor")
        if role not in ("admin", "contractor", "supervisor"):
            role = "contractor"
        if len(username) < 3 or not full_name or len(password) < 8:
            flash("اسم المستخدم 3 أحرف على الأقل، والاسم مطلوب، وكلمة المرور 8 أحرف على الأقل.", "error")
        else:
            try:
                db.execute("INSERT INTO users(username,password_hash,full_name,role,company_id) VALUES(?,?,?,?,?)", (username, generate_password_hash(password), full_name, role, require_company_id()))
                db.commit()
                flash("تم إنشاء حساب المستخدم.", "success")
                return redirect(url_for("users"))
            except (sqlite3.IntegrityError, psycopg.IntegrityError) as exc:
                db.rollback()
                flash("اسم المستخدم موجود مسبقاً.", "error")
    where, params, q, role_filter, active_filter = user_filters()
    rows = db.execute(
        "SELECT id,username,full_name,role,active,created_at FROM users WHERE " + where + " ORDER BY id",
        params,
    ).fetchall()
    return render_template(
        "users.html",
        users=rows,
        q=q,
        role_filter=role_filter,
        active_filter=active_filter,
    )


@app.route("/users/export")
@roles_required("admin")
def users_export() -> Any:
    from report_exports import build_table_csv, build_table_pdf, build_table_xlsx

    where, params, q, role_filter, active_filter = user_filters()
    rows = get_db().execute(
        "SELECT id,username,full_name,role,active,created_at FROM users WHERE " + where + " ORDER BY id",
        params,
    ).fetchall()
    role_labels = {"admin": "مدير النظام", "contractor": "متعهد المغسلة", "supervisor": "مشرف السكن", "super_admin": "مدير عام"}
    headers = ["#", "الاسم الكامل", "اسم الدخول", "الدور", "الحالة", "تاريخ الإنشاء"]
    table_rows = [
        [
            index,
            row["full_name"],
            row["username"],
            role_labels.get(row["role"], row["role"]),
            "نشط" if row["active"] else "معطل",
            row["created_at"] or "",
        ]
        for index, row in enumerate(rows, start=1)
    ]
    fmt = requested_format()
    meta = [
        ("الشركة", get_setting("company_name", DEFAULT_COMPANY_NAME)),
        ("عدد الحسابات", str(len(table_rows))),
        ("البحث", q or "الكل"),
        ("الدور", {"all": "الكل", **role_labels}.get(role_filter, role_filter)),
        ("الحالة", {"all": "الكل", "active": "نشط", "inactive": "معطل"}.get(active_filter, "الكل")),
        ("تاريخ التصدير", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    title = "المستخدمون والصلاحيات"
    if fmt == "xlsx":
        content = build_table_xlsx(title, headers, table_rows, "المستخدمون", meta, [6, 28, 20, 18, 12, 20])
    elif fmt == "pdf":
        subtitle = "; ".join(f"{key}: {value}" for key, value in meta)
        content = build_table_pdf(title, headers, table_rows, subtitle, [8, 50, 34, 30, 18, 34])
    else:
        content = build_table_csv(headers, table_rows)
    return export_response(content, fmt, f"users-{date.today().isoformat()}")


@app.route("/users/<int:user_id>/reset", methods=["POST"])
@roles_required("admin")
def user_reset(user_id: int) -> Any:
    password = request.form.get("password", "")
    user = get_db().execute("SELECT id FROM users WHERE id=? AND company_id=?", (user_id, require_company_id())).fetchone()
    if not user:
        abort(404)
    if len(password) < 8:
        flash("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.", "error")
    else:
        get_db().execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(password), user_id))
        get_db().commit()
        flash("تم تغيير كلمة مرور الحساب.", "success")
    return redirect(url_for("users"))


@app.route("/users/<int:user_id>/toggle", methods=["POST"])
@roles_required("admin")
def user_toggle(user_id: int) -> Any:
    if current_user()["id"] == user_id:
        flash("لا يمكن تعطيل الحساب المستخدم حالياً.", "error")
        return redirect(url_for("users"))
    db = get_db()
    row = db.execute("SELECT active FROM users WHERE id=? AND company_id=?", (user_id, require_company_id())).fetchone()
    if not row:
        abort(404)
    db.execute("UPDATE users SET active=? WHERE id=?", (0 if row["active"] else 1, user_id))
    db.commit()
    flash("تم تحديث حالة الحساب.", "success")
    return redirect(url_for("users"))


@app.route("/account", methods=["GET", "POST"])
@login_required
def account() -> Any:
    if request.method == "POST":
        old_password = request.form.get("old_password", "")
        new_password = request.form.get("new_password", "")
        confirm = request.form.get("confirm_password", "")
        row = get_db().execute("SELECT password_hash FROM users WHERE id=?", (current_user()["id"],)).fetchone()
        if not row or not check_password_hash(row["password_hash"], old_password):
            flash("كلمة المرور الحالية غير صحيحة.", "error")
        elif len(new_password) < 8:
            flash("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.", "error")
        elif new_password != confirm:
            flash("تأكيد كلمة المرور غير مطابق.", "error")
        else:
            get_db().execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new_password), current_user()["id"]))
            get_db().commit()
            flash("تم تغيير كلمة المرور بنجاح.", "success")
            return redirect(url_for("account"))
    return render_template("account.html")


@app.route("/mobile")
@app.route("/mobile/")
def mobile_app() -> Any:
    """تطبيق الجوال (offline-first) — يعمل كصفحة مستقلة تُحزم داخل Capacitor."""
    response = make_response(send_from_directory(MOBILE_WWW_DIR, "index.html"))
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/mobile/<path:filename>")
def mobile_asset(filename: str) -> Any:
    """ملفات تطبيق الجوال (js/css/icons) عند تشغيله من المتصفح على الشبكة."""
    response = make_response(send_from_directory(MOBILE_WWW_DIR, filename))
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/sw.js")
def service_worker() -> Any:
    response = make_response(app.send_static_file("sw.js"))
    response.headers["Content-Type"] = "application/javascript; charset=utf-8"
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache"
    return response


@app.route("/health")
def health() -> Any:
    return {"status": "ok", "app": "Laundry Management", "database": "supabase-postgres" if DATABASE_URL else "sqlite-local"}


@app.errorhandler(400)
def bad_request(error: Any) -> Any:
    return render_template("error.html", code=400, heading="طلب غير صالح", message=getattr(error, "description", "تعذر تنفيذ الطلب.")), 400


@app.errorhandler(403)
def forbidden(_error: Any) -> Any:
    return render_template("error.html", code=403, heading="ليس لديك صلاحية", message="هذا القسم غير متاح للدور المسجل حالياً."), 403


@app.errorhandler(404)
def not_found(_error: Any) -> Any:
    return render_template("error.html", code=404, heading="الصفحة غير موجودة", message="ربما تم نقل الصفحة أو حذفها."), 404


@app.errorhandler(413)
def too_large(_error: Any) -> Any:
    return render_template("error.html", code=413, heading="الملف كبير جداً", message="الحد الأقصى لحجم الملف 4 ميجابايت."), 413


try:
    from mobile_api import register as register_mobile_api

    register_mobile_api(app)
except ImportError:  # pragma: no cover - واجهة الجوال اختيارية
    pass


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5505"))
    app.run(host=host, port=port, debug=False)





