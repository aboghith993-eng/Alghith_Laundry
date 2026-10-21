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
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','contractor','supervisor')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT NOT NULL UNIQUE,
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
    transport_class TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS service_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'قطعة',
    rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS laundry_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    client_uuid TEXT
);
CREATE TABLE IF NOT EXISTS laundry_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    service_item_id INTEGER REFERENCES service_items(id),
    item_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    line_total REAL NOT NULL CHECK (line_total >= 0)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON laundry_orders(service_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON laundry_orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON laundry_order_items(order_id);
"""

POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','contractor','supervisor')),
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    employee_code TEXT NOT NULL UNIQUE,
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
    transport_class TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS service_items (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'قطعة',
    rate DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (rate >= 0),
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS laundry_orders (
    id BIGSERIAL PRIMARY KEY,
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
    client_uuid TEXT
);
CREATE TABLE IF NOT EXISTS laundry_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    service_item_id BIGINT REFERENCES service_items(id),
    item_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_price DOUBLE PRECISION NOT NULL CHECK (unit_price >= 0),
    line_total DOUBLE PRECISION NOT NULL CHECK (line_total >= 0)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON laundry_orders(service_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON laundry_orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON laundry_order_items(order_id);
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


def init_db() -> None:
    """Create app tables, initial service prices and the general visitor profile."""
    if DATABASE_URL:
        conn: Any = PostgresConnection(DATABASE_URL)
        try:
            # Prevent concurrent Gunicorn workers/restarts from racing through first-time setup.
            conn.execute("SELECT pg_advisory_xact_lock(8675309)")
            for statement in POSTGRES_SCHEMA.split(";"):
                if statement.strip():
                    conn.execute(statement)
            existing_columns = {row["column_name"] for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='laundry_orders'"
            ).fetchall()}
            migrations = {
                "fulfillment_status": "ALTER TABLE laundry_orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','delivered'))",
                "delivered_at": "ALTER TABLE laundry_orders ADD COLUMN delivered_at TIMESTAMPTZ",
                "delivered_by": "ALTER TABLE laundry_orders ADD COLUMN delivered_by BIGINT REFERENCES users(id)",
                "client_uuid": "ALTER TABLE laundry_orders ADD COLUMN client_uuid TEXT",
            }
            for column, statement in migrations.items():
                if column not in existing_columns:
                    conn.execute(statement)
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_uuid ON laundry_orders(client_uuid) WHERE client_uuid IS NOT NULL")
            employee_columns = {row["column_name"] for row in conn.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='employees'"
            ).fetchall()}
            for column, definition in EMPLOYEE_SHIFT_COLUMNS:
                if column not in employee_columns:
                    conn.execute(f"ALTER TABLE employees ADD COLUMN {column} {definition}")
            defaults = [("currency", "ريال يمني"), ("company_name", "مغسلة الشركة")]
            conn.executemany("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING", defaults)
            conn.executemany(
                "INSERT INTO service_items(code,name,unit,rate) VALUES(?,?,?,?) ON CONFLICT(code) DO NOTHING",
                SEED_SERVICES,
            )
            conn.execute(
                "INSERT INTO employees(employee_code,name,company,department,person_type,notes) "
                "VALUES('GEN-001','موظف عام','زوار وضيوف من خارج الشركة','عام','general',"
                "'سجل عام؛ اكتب اسم الزائر الفعلي عند إنشاء طلب المغسلة') ON CONFLICT(employee_code) DO NOTHING"
            )
            existing_admin = conn.execute("SELECT id FROM users WHERE role='admin' LIMIT 1").fetchone()
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
                if existing_username and existing_username["role"] != "admin":
                    raise RuntimeError(
                        f"اسم المستخدم الأولي {username} مستخدم لحساب غير إداري. "
                        "اختر INITIAL_ADMIN_USERNAME مختلفاً في Render."
                    )
                conn.execute(
                    "INSERT INTO users(username,password_hash,full_name,role) VALUES(?,?,?,'admin') ON CONFLICT(username) DO NOTHING",
                    (username, generate_password_hash(initial_password), full_name),
                )
            conn.commit()
        finally:
            conn.close()
    else:
        conn = sqlite3.connect(DB_PATH, timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(SQLITE_SCHEMA)
        existing_columns = {row["name"] for row in conn.execute("PRAGMA table_info(laundry_orders)").fetchall()}
        if "fulfillment_status" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','delivered'))")
        if "delivered_at" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN delivered_at TEXT")
        if "delivered_by" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN delivered_by INTEGER REFERENCES users(id)")
        if "client_uuid" not in existing_columns:
            conn.execute("ALTER TABLE laundry_orders ADD COLUMN client_uuid TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_uuid ON laundry_orders(client_uuid) WHERE client_uuid IS NOT NULL")
        employee_columns = {row["name"] for row in conn.execute("PRAGMA table_info(employees)").fetchall()}
        for column, definition in EMPLOYEE_SHIFT_COLUMNS:
            if column not in employee_columns:
                conn.execute(f"ALTER TABLE employees ADD COLUMN {column} {definition}")
        defaults = [("currency", "ريال يمني"), ("company_name", "مغسلة الشركة")]
        conn.executemany("INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", defaults)
        conn.executemany(
            "INSERT OR IGNORE INTO service_items(code,name,unit,rate) VALUES(?,?,?,?)",
            SEED_SERVICES,
        )
        conn.execute(
            "INSERT OR IGNORE INTO employees(employee_code,name,company,department,person_type,notes) "
            "VALUES('GEN-001','موظف عام','زوار وضيوف من خارج الشركة','عام','general',"
            "'سجل عام؛ اكتب اسم الزائر الفعلي عند إنشاء طلب المغسلة')"
        )
        demo_users = [
            ("admin", "Admin@12345", "مدير النظام", "admin"),
            ("contractor", "Laundry@12345", "متعهد المغسلة", "contractor"),
            ("supervisor", "Housing@12345", "مشرف السكن", "supervisor"),
        ]
        for username, password, full_name, role in demo_users:
            conn.execute(
                "INSERT OR IGNORE INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)",
                (username, generate_password_hash(password), full_name, role),
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
    row = get_db().execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    get_db().execute(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value.strip()),
    )
    get_db().commit()


def current_user() -> Any | None:
    user_id = session.get("user_id")
    if not user_id:
        return None
    user = get_db().execute(
        "SELECT id,username,full_name,role,active FROM users WHERE id=?", (user_id,)
    ).fetchone()
    if not user or not user["active"]:
        session.clear()
        return None
    return user


def login_required(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        if current_user() is None:
            return redirect(url_for("login", next=request.path))
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


@app.context_processor
def inject_globals() -> dict[str, Any]:
    labels = {"admin": "مدير النظام", "contractor": "متعهد المغسلة", "supervisor": "مشرف السكن"}
    return {
        "current_user": current_user(),
        "role_labels": labels,
        "csrf_token": csrf_value,
        "currency": get_setting("currency", "ريال يمني"),
        "company_name": get_setting("company_name", "مغسلة الشركة"),
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
    """
    if where:
        sql += " WHERE " + where
    sql += " ORDER BY o.service_date DESC, o.id DESC"
    return get_db().execute(sql, params).fetchall()


def order_items(order_id: int) -> list[Any]:
    return get_db().execute(
        "SELECT * FROM laundry_order_items WHERE order_id=? ORDER BY id", (order_id,)
    ).fetchall()


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
               i.item_name, SUM(i.quantity) AS qty
        FROM laundry_order_items i
        JOIN laundry_orders o ON o.id=i.order_id
        JOIN employees e ON e.id=o.employee_id
        WHERE o.id IN ({placeholders})
        GROUP BY e.id, e.employee_code, e.name, e.service_type, i.item_name
        ORDER BY LOWER(e.name), i.item_name
        """,
        tuple(order_ids),
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


def order_filters() -> tuple[str, list[Any], str, str, str]:
    today = date.today()
    start = safe_date(request.args.get("from", ""), today.replace(day=1).isoformat())
    end = safe_date(request.args.get("to", ""), today.isoformat())
    status = request.args.get("status", "all")
    if status not in {"all", "pending", "approved", "rejected"}:
        status = "all"
    conditions = ["o.service_date >= ?", "o.service_date <= ?"]
    params: list[Any] = [start, end]
    if status != "all":
        conditions.append("o.status = ?")
        params.append(status)
    search = request.args.get("q", "").strip()
    if search:
        like = f"%{search}%"
        conditions.append("(o.reference LIKE ? OR e.name LIKE ? OR e.employee_code LIKE ? OR o.person_name LIKE ? OR e.company LIKE ?)")
        params.extend([like, like, like, like, like])
    return " AND ".join(conditions), params, start, end, status


@app.route("/")
def index() -> Any:
    if current_user():
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login() -> Any:
    if current_user():
        return redirect(url_for("dashboard"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username=? AND active=1", (username,)
        ).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            session["_csrf_token"] = secrets.token_urlsafe(32)
            target = request.args.get("next", "")
            if not target.startswith("/") or target.startswith("//"):
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
    first_day = date.today().replace(day=1).isoformat()
    metrics = {
        "employees": db.execute("SELECT COUNT(*) AS total FROM employees WHERE active=1 AND person_type='company'").fetchone()["total"],
        "pending": db.execute("SELECT COUNT(*) AS total FROM laundry_orders WHERE status='pending'").fetchone()["total"],
        "month_approved": db.execute("SELECT COUNT(*) AS total FROM laundry_orders WHERE status='approved' AND service_date>=?", (first_day,)).fetchone()["total"],
        "month_amount": db.execute("SELECT COALESCE(SUM(subtotal),0) AS total FROM laundry_orders WHERE status='approved' AND service_date>=?", (first_day,)).fetchone()["total"],
        "month_pending_amount": db.execute("SELECT COALESCE(SUM(subtotal),0) AS total FROM laundry_orders WHERE status='pending' AND service_date>=?", (first_day,)).fetchone()["total"],
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
                    "INSERT INTO employees(employee_code,name,company,department,phone,person_type,notes) VALUES(?,?,?,?,?,?,?)",
                    (code, name, request.form.get("company", "").strip(), request.form.get("department", "").strip(), request.form.get("phone", "").strip(), person_type, request.form.get("notes", "").strip()),
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
    sql = "SELECT * FROM employees"
    conditions: list[str] = []
    params: list[Any] = []
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
    if conditions:
        sql += " WHERE " + " AND ".join(conditions)
    sql += " ORDER BY active DESC, LOWER(name)"
    rows = db.execute(sql, params).fetchall()
    service_types = [
        row["service_type"]
        for row in db.execute(
            "SELECT DISTINCT service_type FROM employees WHERE service_type<>'' ORDER BY service_type"
        ).fetchall()
    ]
    return render_template(
        "employees.html",
        employees=rows,
        q=q,
        type_filter=type_filter,
        service_filter=service_filter,
        service_types=service_types,
    )


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
        added = updated = skipped = 0
        for record in reader:
            code = (record.get(header_map["employee_code"]) or "").strip()
            name = (record.get(header_map["name"]) or "").strip()
            if not code or not name:
                skipped += 1
                continue
            def field_value(key: str) -> str:
                return (record.get(header_map.get(key, "")) or "").strip()
            existing = db.execute("SELECT id FROM employees WHERE employee_code=?", (code,)).fetchone()
            values = (name, field_value("company"), field_value("department"), field_value("phone"))
            if existing:
                db.execute("UPDATE employees SET name=?,company=?,department=?,phone=?,person_type='company',active=1 WHERE id=?", (*values, existing["id"]))
                updated += 1
            else:
                db.execute("INSERT INTO employees(employee_code,name,company,department,phone,person_type) VALUES(?,?,?,?,?,'company')", (code, *values))
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
    row = db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone()
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
                db.execute("UPDATE employees SET employee_code=?,name=?,company=?,department=?,phone=?,person_type=?,notes=? WHERE id=?", (code, name, request.form.get("company", "").strip(), request.form.get("department", "").strip(), request.form.get("phone", "").strip(), person_type, request.form.get("notes", "").strip(), employee_id))
                db.commit()
                flash("تم تحديث بيانات السجل.", "success")
                return redirect(url_for("employees"))
            except (sqlite3.IntegrityError, psycopg.IntegrityError) as exc:
                db.rollback()
                flash("رقم الموظف مستخدم من سجل آخر.", "error")
        row = db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone()
    return render_template("employee_edit.html", employee=row)


@app.route("/employees/<int:employee_id>/toggle", methods=["POST"])
@roles_required("admin", "supervisor")
def employee_toggle(employee_id: int) -> Any:
    db = get_db()
    row = db.execute("SELECT * FROM employees WHERE id=?", (employee_id,)).fetchone()
    if not row:
        abort(404)
    db.execute("UPDATE employees SET active=? WHERE id=?", (0 if row["active"] else 1, employee_id))
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
            db.execute("INSERT INTO service_items(code,name,unit,rate) VALUES(?,?,?,?)", (code, name, unit, rate))
            db.commit()
            flash("تمت إضافة الخدمة والسعر.", "success")
            return redirect(url_for("rates"))
        except (ValueError, sqlite3.IntegrityError, psycopg.IntegrityError):
            db.rollback()
            flash("تعذرت الإضافة. تأكد من الاسم والرمز وأن السعر رقم غير سالب والرمز غير مكرر.", "error")
    rows = db.execute("SELECT * FROM service_items ORDER BY active DESC,name").fetchall()
    return render_template("rates.html", services=rows)


@app.route("/rates/<int:item_id>/edit", methods=["POST"])
@roles_required("admin")
def rate_edit(item_id: int) -> Any:
    db = get_db()
    row = db.execute("SELECT id FROM service_items WHERE id=?", (item_id,)).fetchone()
    if not row:
        abort(404)
    name = request.form.get("name", "").strip()
    unit = request.form.get("unit", "قطعة").strip() or "قطعة"
    try:
        rate = float(request.form.get("rate", ""))
        if not name or rate < 0:
            raise ValueError
        db.execute("UPDATE service_items SET name=?,unit=?,rate=? WHERE id=?", (name, unit, rate, item_id))
        db.commit()
        flash("تم حفظ السعر. الطلبات السابقة تحتفظ بالسعر المسجل وقت إنشائها.", "success")
    except ValueError:
        flash("أدخل اسماً وسعراً صحيحاً غير سالب.", "error")
    return redirect(url_for("rates"))


@app.route("/rates/<int:item_id>/toggle", methods=["POST"])
@roles_required("admin")
def rate_toggle(item_id: int) -> Any:
    db = get_db()
    row = db.execute("SELECT active FROM service_items WHERE id=?", (item_id,)).fetchone()
    if not row:
        abort(404)
    db.execute("UPDATE service_items SET active=? WHERE id=?", (0 if row["active"] else 1, item_id))
    db.commit()
    flash("تم تحديث حالة الخدمة.", "success")
    return redirect(url_for("rates"))


@app.route("/transactions")
@login_required
def transactions() -> Any:
    where, params, start, end, status = order_filters()
    rows = order_query(where, tuple(params))
    return render_template("transactions.html", orders=rows, date_from=start, date_to=end, status_filter=status, q=request.args.get("q", ""))


@app.route("/transactions/new", methods=["GET", "POST"])
@roles_required("admin", "contractor")
def transaction_new() -> Any:
    db = get_db()
    employee_rows = db.execute("SELECT * FROM employees WHERE active=1 ORDER BY person_type DESC,name").fetchall()
    service_rows = db.execute("SELECT * FROM service_items WHERE active=1 ORDER BY name").fetchall()
    if request.method == "POST":
        employee_id = request.form.get("employee_id", type=int)
        service_date = safe_date(request.form.get("service_date", ""), "")
        if not service_date:
            service_date = ""
        person_name = request.form.get("person_name", "").strip()
        notes = request.form.get("notes", "").strip()
        selected_ids = request.form.getlist("service_item_id")
        quantities = request.form.getlist("quantity")
        employee = db.execute("SELECT * FROM employees WHERE id=? AND active=1", (employee_id,)).fetchone() if employee_id else None
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
                item = db.execute("SELECT * FROM service_items WHERE id=? AND active=1", (item_id,)).fetchone()
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
                    "INSERT INTO laundry_orders(employee_id,person_name,service_date,notes,status,subtotal,created_by) VALUES(?,?,?,?, 'pending',?,?) RETURNING id",
                    (employee_id, person_name, service_date, notes, subtotal, current_user()["id"]),
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
    return render_template("transaction_form.html", employees=employee_rows, services=service_rows)


@app.route("/transactions/<int:order_id>")
@login_required
def transaction_detail(order_id: int) -> Any:
    rows = order_query("o.id=?", (order_id,))
    if not rows:
        abort(404)
    order = rows[0]
    warnings = employee_shift_warnings(order, order["service_date"])
    cycle = employee_cycle(order, safe_date(order["service_date"], ""))
    return render_template(
        "transaction_detail.html",
        order=order,
        items=order_items(order_id),
        shift_warnings=warnings,
        shift_cycle=cycle,
    )


@app.route("/transactions/<int:order_id>/deliver", methods=["POST"])
@roles_required("admin", "contractor")
def transaction_deliver(order_id: int) -> Any:
    db = get_db()
    order = db.execute("SELECT * FROM laundry_orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        abort(404)
    if order["status"] != "pending":
        flash("لا يمكن تعديل التسليم بعد اعتماد الطلب أو رفضه.", "error")
    elif order["fulfillment_status"] == "delivered":
        flash("تم تسجيل تسليم هذا الطلب مسبقاً.", "warning")
    else:
        db.execute(
            "UPDATE laundry_orders SET fulfillment_status='delivered',delivered_at=CURRENT_TIMESTAMP,delivered_by=? WHERE id=?",
            (current_user()["id"], order_id),
        )
        db.commit()
        flash("تم تسجيل تسليم القطع النظيفة، وأصبح الطلب جاهزاً لمراجعة مشرف السكن.", "success")
    return redirect(url_for("transaction_detail", order_id=order_id))


@app.route("/transactions/<int:order_id>/confirm", methods=["POST"])
@roles_required("admin", "supervisor")
def transaction_confirm(order_id: int) -> Any:
    db = get_db()
    order = db.execute("SELECT * FROM laundry_orders WHERE id=?", (order_id,)).fetchone()
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
    db.execute("UPDATE laundry_orders SET status=?,confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP,rejection_reason=? WHERE id=?", (decision, current_user()["id"], reason, order_id))
    db.commit()
    flash("تم اعتماد الطلب." if decision == "approved" else "تم رفض الطلب وتسجيل السبب.", "success")
    return redirect(url_for("transaction_detail", order_id=order_id))


@app.route("/transactions/<int:order_id>/delete", methods=["POST"])
@roles_required("admin")
def transaction_delete(order_id: int) -> Any:
    db = get_db()
    order = db.execute("SELECT status FROM laundry_orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        abort(404)
    if order["status"] != "pending":
        flash("لا يمكن حذف طلب تمت مراجعته؛ احتفظ بالسجل لأغراض التدقيق.", "error")
    else:
        db.execute("DELETE FROM laundry_orders WHERE id=?", (order_id,))
        db.commit()
        flash("تم حذف الطلب غير المعتمد.", "success")
    return redirect(url_for("transactions"))


@app.route("/reports")
@login_required
def reports() -> Any:
    where, params, start, end, status = order_filters()
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
    return render_template("reports.html", orders=rows, lines=lines, date_from=start, date_to=end, status_filter=status, q=request.args.get("q", ""), approved_total=approved_total, pending_total=pending_total, rejected_total=rejected_total, summary=summary, service_type_totals=service_type_totals)


@app.route("/reports/export.csv")
@login_required
def report_export() -> Any:
    where, params, start, end, status = order_filters()
    rows = order_query(where, tuple(params))
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["رقم الطلب", "التاريخ", "رقم الموظف", "الاسم", "الشركة", "القسم", "الصنف", "الكمية", "الوحدة", "سعر الوحدة", "الإجمالي", "الحالة", "مدخل الطلب", "المعتمد", "ملاحظات"])
    sums = {"approved": 0.0, "pending": 0.0, "rejected": 0.0}
    for order in rows:
        items = order_items(order["id"])
        for item in items:
            writer.writerow([
                order["reference"], order["service_date"], order["employee_code"],
                order["person_name"] or order["employee_name"], order["company"], order["department"],
                item["item_name"], item["quantity"], item["unit"], item["unit_price"], item["line_total"],
                {"pending": "بانتظار التأكيد", "approved": "معتمد", "rejected": "مرفوض"}[order["status"]],
                order["creator_name"], order["confirmer_name"] or "", order["notes"],
            ])
        sums[order["status"]] += float(order["subtotal"] or 0)
    writer.writerow([])
    writer.writerow(["ملخص كميات الغسيل لكل موظف"])
    writer.writerow(["رقم الموظف", "الاسم", "نوع الخدمة", "الصنف", "الكمية", "الوحدة"])
    summary = employee_item_summary([order["id"] for order in rows])
    units = {item["item_name"]: item["unit"] for order in rows for item in order_items(order["id"])}
    for entry in summary["rows"]:
        for name in summary["columns"]:
            quantity = entry["quantities"].get(name)
            if quantity:
                writer.writerow([entry["employee_code"], entry["employee_name"], entry["service_type"], name, quantity, units.get(name, "")])
    writer.writerow([])
    writer.writerow(["الفترة", start, "إلى", end, "العملة", get_setting("currency", "ريال يمني")])
    writer.writerow(["إجمالي المعتمد", sums["approved"]])
    writer.writerow(["إجمالي المعلّق", sums["pending"]])
    writer.writerow(["إجمالي المرفوض", sums["rejected"]])
    response = make_response("\ufeff" + output.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f"attachment; filename=laundry-report-{start}-to-{end}.csv"
    return response


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
            flash("تم حفظ الإعدادات.", "success")
            return redirect(url_for("settings"))
    return render_template("settings.html", currency_value=get_setting("currency", "ريال يمني"), company_name_value=get_setting("company_name", "مغسلة الشركة"))


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
                db.execute("INSERT INTO users(username,password_hash,full_name,role) VALUES(?,?,?,?)", (username, generate_password_hash(password), full_name, role))
                db.commit()
                flash("تم إنشاء حساب المستخدم.", "success")
                return redirect(url_for("users"))
            except (sqlite3.IntegrityError, psycopg.IntegrityError) as exc:
                db.rollback()
                flash("اسم المستخدم موجود مسبقاً.", "error")
    rows = db.execute("SELECT id,username,full_name,role,active,created_at FROM users ORDER BY id").fetchall()
    return render_template("users.html", users=rows)


@app.route("/users/<int:user_id>/reset", methods=["POST"])
@roles_required("admin")
def user_reset(user_id: int) -> Any:
    password = request.form.get("password", "")
    user = get_db().execute("SELECT id FROM users WHERE id=?", (user_id,)).fetchone()
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
    row = db.execute("SELECT active FROM users WHERE id=?", (user_id,)).fetchone()
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
