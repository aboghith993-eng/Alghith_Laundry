"""واجهة JSON لتطبيق الجوال (Flutter) — نفس بيانات تطبيق الويب بلا اختلاف.

المبدأ: تطبيق الجوال يعرض نفس الشاشات ونفس البيانات ونفس قواعد العمل في
تطبيق الويب (`app.py`). لذلك تعتمد كل نقاط النهاية هنا على الدوال نفسها
(`order_query`, `order_items`, `employee_cycle`, `employee_shift_warnings`)،
ولا توجد نسخة ثانية من قواعد البيانات أو الحسابات.

- تسجيل الدخول برموز موقّعة (itsdangerous) مع رمز تحديث.
- لقطة كاملة للبيانات (Snapshot) للعمل دون اتصال.
- مزامنة الطلبات المُنشأة محلياً (idempotent عبر client_uuid).
- اعتماد/رفض الطلبات وتسجيل التسليم من الجوال.

جميع النقاط تعيد JSON، وتتجاوز حماية CSRF الخاصة بالنماذج، وتسمح بـ CORS
لأصل تطبيق الجوال (Android/WebView أو https://localhost).
"""

from __future__ import annotations

import os
import secrets
import sqlite3
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from typing import Any, Callable

import psycopg
from flask import Blueprint, current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

bp = Blueprint("mobile_api", __name__)

ACCESS_TOKEN_HOURS = int(os.environ.get("MOBILE_ACCESS_TOKEN_HOURS", "72"))
REFRESH_TOKEN_DAYS = int(os.environ.get("MOBILE_REFRESH_TOKEN_DAYS", "60"))

ALLOWED_ORIGINS = {
    "https://localhost",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost:443",
}

ROLES = ("super_admin", "admin", "contractor", "supervisor")

ROLE_LABELS = {
    "super_admin": "المدير العام",
    "admin": "مدير النظام",
    "contractor": "متعهد المغسلة",
    "supervisor": "مشرف السكن",
}


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="laundry-mobile-v1")


def _make_tokens(user: Any) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    access = _serializer().dumps(
        {
            "sub": int(user["id"]),
            "username": user["username"],
            "role": user["role"],
            "kind": "access",
        }
    )
    refresh = _serializer().dumps(
        {"sub": int(user["id"]), "username": user["username"], "kind": "refresh"}
    )
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": ACCESS_TOKEN_HOURS * 3600,
        "issued_at": now.isoformat(timespec="seconds"),
    }


def _row_value(row: Any, key: str, default: Any = None) -> Any:
    try:
        value = row[key]
    except (KeyError, IndexError, TypeError):
        return default
    return default if value is None else value


def _user_public(user: Any) -> dict[str, Any]:
    company_id = _row_value(user, "company_id")
    system_admin = _row_value(user, "system_admin", 0)
    try:
        system_admin = bool(int(system_admin))
    except Exception:
        system_admin = False
    return {
        "id": int(user["id"]),
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "role_label": ROLE_LABELS.get(user["role"], user["role"]),
        "company_id": int(company_id) if company_id else None,
        "system_admin": system_admin,
    }


def _company_public(row: Any) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "code": row["code"],
        "name": row["name"],
        "active": bool(row["active"]),
    }


def _company_counts(company_id: int) -> dict[str, int]:
    from app import get_db

    db = get_db()
    def total(sql: str) -> int:
        row = db.execute(sql, (company_id,)).fetchone()
        return int(row["total"] or 0) if row else 0

    return {
        "employees": total("SELECT COUNT(*) AS total FROM employees WHERE company_id=? AND active=1"),
        "users": total("SELECT COUNT(*) AS total FROM users WHERE company_id=?"),
        "orders": total("SELECT COUNT(*) AS total FROM laundry_orders WHERE company_id=?"),
    }


@bp.after_app_request
def _cors(response: Any) -> Any:
    if request.path.startswith("/api/"):
        origin = request.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            response.headers["Access-Control-Allow-Origin"] = origin
        elif origin:
            response.headers["Access-Control-Allow-Origin"] = origin
        else:
            response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "86400"
    return response


def _json_error(message: str, status: int = 400) -> Any:
    return jsonify({"ok": False, "error": message}), status

def _api_is_system_admin(user: Any) -> bool:
    if not user:
        return False
    try:
        if _row_value(user, "system_admin"):
            return True
    except Exception:
        pass
    return _row_value(user, "role") == "super_admin"





def _token_user() -> Any | None:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    try:
        data = _serializer().loads(token, max_age=ACCESS_TOKEN_HOURS * 3600)
    except (BadSignature, SignatureExpired):
        return None
    if data.get("kind") != "access":
        return None
    from app import get_db  # imported lazily to avoid circular import

    user = get_db().execute(
        "SELECT id,username,full_name,role,active,company_id,system_admin FROM users WHERE id=?", (data.get("sub"),)
    ).fetchone()
    if not user or not user["active"]:
        return None
    return user


def _scope_api_company(user: Any) -> Any:
    """يضبط نطاق الشركة لحساب المستخدم ويعيد صفّ الشركة (None للمدير العام)."""
    from app import get_db, set_company_scope

    if user["role"] == "super_admin":
        set_company_scope(None)
        return None
    company = get_db().execute(
        "SELECT id,name,code,active FROM companies WHERE id=?", (user["company_id"],)
    ).fetchone()
    set_company_scope(user["company_id"])
    return company


def api_login_required(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        user = _token_user()
        if user is None:
            return _json_error("انتهت الجلسة أو الرمز غير صالح. سجّل الدخول مجدداً.", 401)
        company = _scope_api_company(user)
        if user["role"] != "super_admin" and (not company or not company["active"]):
            return _json_error("الشركة المرتبطة بهذا الحساب غير مفعّلة. راجع المدير العام.", 403)
        g.api_user = user
        g.api_company = company
        return view(*args, **kwargs)

    return wrapped


def api_company_required(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    @api_login_required
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        if g.api_user["role"] == "super_admin":
            return _json_error("حساب المدير العام لا يدير بيانات التشغيل؛ اختر حساب شركة.", 403)
        return view(*args, **kwargs)

    return wrapped


def api_roles_required(*roles: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view)
        @api_login_required
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            user = g.get("api_user")
            if user is None or user["role"] not in roles:
                return _json_error("ليس لديك صلاحية لهذا الإجراء.", 403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


# ---------------------------------------------------------------------------
# المصادقة
# ---------------------------------------------------------------------------


@bp.route("/api/mobile/ping")
def ping() -> Any:
    return jsonify({"ok": True, "app": "Laundry Management", "api": "mobile-v2"})


@bp.route("/api/auth/login", methods=["POST"])
def api_login() -> Any:
    from app import get_db

    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    if not username or not password:
        return _json_error("اسم المستخدم وكلمة المرور مطلوبان.", 400)
    user = get_db().execute(
        "SELECT * FROM users WHERE username=? AND active=1", (username,)
    ).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return _json_error("اسم المستخدم أو كلمة المرور غير صحيحة.", 401)
    company = None
    if user["role"] != "super_admin":
        company = get_db().execute(
            "SELECT id,code,name,active FROM companies WHERE id=?", (user["company_id"],)
        ).fetchone()
        if not company or not company["active"]:
            return _json_error("الشركة المرتبطة بهذا الحساب غير مفعّلة. راجع المدير العام.", 403)
    tokens = _make_tokens(user)
    return jsonify(
        {
            "ok": True,
            "user": _user_public(user),
            "company": _company_public(company) if company else None,
            **tokens,
        }
    )


@bp.route("/api/auth/refresh", methods=["POST"])
def api_refresh() -> Any:
    from app import get_db

    payload = request.get_json(silent=True) or {}
    refresh = str(payload.get("refresh_token", ""))
    if not refresh:
        return _json_error("رمز التحديث مطلوب.", 400)
    try:
        data = _serializer().loads(refresh, max_age=REFRESH_TOKEN_DAYS * 86400)
    except (BadSignature, SignatureExpired):
        return _json_error("انتهت صلاحية رمز التحديث. سجّل الدخول مجدداً.", 401)
    if data.get("kind") != "refresh":
        return _json_error("رمز تحديث غير صالح.", 401)
    user = get_db().execute(
        "SELECT id,username,full_name,role,active,company_id,system_admin FROM users WHERE id=? AND active=1", (data.get("sub"),)
    ).fetchone()
    if not user:
        return _json_error("الحساب غير موجود أو معطّل.", 401)
    company = None
    if user["role"] != "super_admin":
        company = get_db().execute(
            "SELECT id,code,name,active FROM companies WHERE id=?", (user["company_id"],)
        ).fetchone()
        if not company or not company["active"]:
            return _json_error("الشركة المرتبطة بهذا الحساب غير مفعّلة.", 403)
    tokens = _make_tokens(user)
    return jsonify(
        {
            "ok": True,
            "user": _user_public(user),
            "company": _company_public(company) if company else None,
            **tokens,
        }
    )


@bp.route("/api/auth/me")
@api_login_required
def api_me() -> Any:
    return jsonify({"ok": True, "user": _user_public(g.api_user), "company": _company_public(g.api_company) if g.get("api_company") else None})


@bp.route("/api/account/password", methods=["POST"])
@api_login_required
def api_change_password() -> Any:
    from app import get_db

    payload = request.get_json(silent=True) or {}
    old_password = str(payload.get("old_password", ""))
    new_password = str(payload.get("new_password", ""))
    confirm = str(payload.get("confirm_password", ""))
    row = get_db().execute(
        "SELECT password_hash FROM users WHERE id=?", (g.api_user["id"],)
    ).fetchone()
    if not row or not check_password_hash(row["password_hash"], old_password):
        return _json_error("كلمة المرور الحالية غير صحيحة.", 400)
    if len(new_password) < 8:
        return _json_error("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.", 400)
    if new_password != confirm:
        return _json_error("تأكيد كلمة المرور غير مطابق.", 400)
    get_db().execute(
        "UPDATE users SET password_hash=? WHERE id=?",
        (generate_password_hash(new_password), g.api_user["id"]),
    )
    get_db().commit()
    return jsonify({"ok": True, "message": "تم تغيير كلمة المرور بنجاح."})


# ---------------------------------------------------------------------------
# أدوات مشتركة
# ---------------------------------------------------------------------------


def _bool(value: Any) -> bool:
    return bool(value)


def _rows_to_dicts(rows: Any) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        for key, value in list(item.items()):
            if isinstance(value, datetime):
                item[key] = value.isoformat(timespec="seconds")
            elif isinstance(value, date):
                item[key] = value.isoformat()
        result.append(item)
    return result


def _order_payload(row: Any) -> dict[str, Any]:
    from app import order_items

    data = dict(row)
    data["items"] = _rows_to_dicts(order_items(row["id"]))
    for key, value in list(data.items()):
        if isinstance(value, datetime):
            data[key] = value.isoformat(timespec="seconds")
        elif isinstance(value, date):
            data[key] = value.isoformat()
    return data


def _settings_map() -> dict[str, str]:
    from app import get_db

    try:
        return {
            row["key"]: row["value"]
            for row in get_db().execute("SELECT key, value FROM settings").fetchall()
        }
    except Exception:
        return {}


def _filter_orders(
    from_date: str = "",
    to_date: str = "",
    status: str = "",
    search: str = "",
    fulfillment: str = "",
) -> list[dict[str, Any]]:
    """نفس منطق `/transactions` في تطبيق الويب."""
    from app import order_query

    if from_date and to_date and from_date > to_date:
        from_date, to_date = to_date, from_date
    conditions: list[str] = []
    params: list[Any] = []
    if from_date:
        conditions.append("o.service_date >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("o.service_date <= ?")
        params.append(to_date)
    if status in {"pending", "approved", "rejected"}:
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
    if search:
        like = f"%{search}%"
        conditions.append(
            "(o.reference LIKE ? OR e.name LIKE ? OR e.employee_code LIKE ? OR o.person_name LIKE ? OR e.company LIKE ?)"
        )
        params.extend([like, like, like, like, like])
    where = " AND ".join(conditions)
    return [_order_payload(row) for row in order_query(where, tuple(params))]


# ---------------------------------------------------------------------------
# اللقطة الكاملة (Offline-first)
# ---------------------------------------------------------------------------


@bp.route("/api/mobile/snapshot")
@bp.route("/api/sync/full_snapshot")
@bp.route("/api/sync/snapshot_full")
@api_company_required
def api_mobile_snapshot_full() -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    employees = _rows_to_dicts(
        db.execute(
            """
            SELECT id, employee_code, name, company, department, phone, person_type, active, notes,
                   service_type, shift_system, shift_description, work_days, rest_days,
                   cycle_start, cycle_anchor, cycle_day, status_label, departure_time,
                   housing_location, job_title, gender, transport_class
            FROM employees WHERE company_id=? ORDER BY employee_code
            """,
            (company_id,),
        ).fetchall()
    )
    for employee in employees:
        employee["active"] = _bool(employee.get("active"))

    items = _rows_to_dicts(
        db.execute(
            "SELECT id, code, name, unit, rate, active FROM service_items "
            "WHERE company_id=? ORDER BY name",
            (company_id,),
        ).fetchall()
    )
    for item in items:
        item["active"] = _bool(item.get("active"))

    users = _rows_to_dicts(
        db.execute(
            "SELECT id, username, full_name, role, active, company_id FROM users "
            "WHERE company_id=? ORDER BY id",
            (company_id,),
        ).fetchall()
    )
    for user in users:
        user["active"] = _bool(user.get("active"))
        user["role_label"] = ROLE_LABELS.get(user["role"], user["role"])

    settings = _settings_map()
    orders = _filter_orders()

    return jsonify(
        {
            "ok": True,
            "version": 4,
            "built_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "counts": {
                "employees": len(employees),
                "service_items": len(items),
                "users": len(users),
                "orders": len(orders),
            },
            "employees": employees,
            "service_items": items,
            "users": users,
            "orders": orders,
            "settings": settings,
            "company": _company_public(g.api_company) if g.get("api_company") else None,
            "meta": {"source": "mobile-offline-full-v4"},
        }
    )


# ---------------------------------------------------------------------------
# لوحة المتابعة
# ---------------------------------------------------------------------------


@bp.route("/api/dashboard")
@api_company_required
def api_dashboard() -> Any:
    from app import get_db, order_query

    db = get_db()
    company_id = int(g.api_user["company_id"])
    today = date.today()
    first_day = today.replace(day=1).isoformat()
    metrics = {
        "employees": db.execute(
            "SELECT COUNT(*) AS total FROM employees WHERE company_id=? AND active=1 AND person_type='company'",
            (company_id,),
        ).fetchone()["total"],
        "pending": db.execute(
            "SELECT COUNT(*) AS total FROM laundry_orders WHERE company_id=? AND status='pending'",
            (company_id,),
        ).fetchone()["total"],
        "month_approved": db.execute(
            "SELECT COUNT(*) AS total FROM laundry_orders WHERE company_id=? AND status='approved' AND service_date>=?",
            (company_id, first_day),
        ).fetchone()["total"],
        "month_amount": db.execute(
            "SELECT COALESCE(SUM(subtotal),0) AS total FROM laundry_orders WHERE company_id=? AND status='approved' AND service_date>=?",
            (company_id, first_day),
        ).fetchone()["total"],
        "month_pending_amount": db.execute(
            "SELECT COALESCE(SUM(subtotal),0) AS total FROM laundry_orders WHERE company_id=? AND status='pending' AND service_date>=?",
            (company_id, first_day),
        ).fetchone()["total"],
    }
    latest = [_order_payload(row) for row in order_query()[:8]]
    settings = _settings_map()
    return jsonify(
        {
            "ok": True,
            "metrics": metrics,
            "latest": latest,
            "settings": settings,
            "month": first_day[:7],
            "today": today.isoformat(),
        }
    )


# ---------------------------------------------------------------------------
# الطلبات
# ---------------------------------------------------------------------------


@bp.route("/api/orders")
@api_company_required
def api_orders() -> Any:
    from_date = request.args.get("from", "").strip()
    to_date = request.args.get("to", "").strip()
    status = request.args.get("status", "").strip()
    search = request.args.get("q", "").strip()
    orders = _filter_orders(from_date, to_date, status, search)
    limit = request.args.get("limit", "").strip()
    if limit:
        try:
            orders = orders[: max(1, min(int(limit), 3000))]
        except ValueError:
            pass
    return jsonify({"ok": True, "orders": orders, "count": len(orders)})


@bp.route("/api/orders/<int:order_id>")
@api_company_required
def api_order_detail(order_id: int) -> Any:
    from app import order_query

    rows = order_query("o.id=?", (order_id,))
    if not rows:
        return _json_error("الطلب غير موجود.", 404)
    return jsonify({"ok": True, "order": _order_payload(rows[0])})


def _create_order_payload(raw: dict[str, Any]) -> dict[str, Any]:
    """إنشاء طلب واحد بنفس منطق `/transactions/new` في تطبيق الويب."""
    from app import employee_shift_warnings, get_db, safe_date

    db = get_db()
    company_id = int(g.api_user["company_id"])
    client_uuid = str(raw.get("client_uuid", "")).strip()
    if client_uuid:
        existing = db.execute(
            "SELECT id, reference FROM laundry_orders WHERE company_id=? AND client_uuid=?",
            (company_id, client_uuid),
        ).fetchone()
        if existing:
            return {
                "client_uuid": client_uuid,
                "status": "duplicate",
                "order_id": existing["id"],
                "reference": existing["reference"],
            }

    employee_id = raw.get("employee_id")
    try:
        employee_id = int(employee_id)
    except (TypeError, ValueError):
        return {"client_uuid": client_uuid, "status": "error", "error": "اختر موظفاً فعالاً من قاعدة البيانات."}

    employee = db.execute(
        "SELECT * FROM employees WHERE id=? AND company_id=? AND active=1",
        (employee_id, company_id),
    ).fetchone()
    if not employee:
        return {"client_uuid": client_uuid, "status": "error", "error": "اختر موظفاً فعالاً من قاعدة البيانات."}

    service_date = safe_date(str(raw.get("service_date", "")), "")
    if not service_date:
        return {"client_uuid": client_uuid, "status": "error", "error": "أدخل تاريخ الخدمة بشكل صحيح."}

    person_name = str(raw.get("person_name", "")).strip()
    if employee["person_type"] == "general" and not person_name:
        return {"client_uuid": client_uuid, "status": "error", "error": "للسجل العام، اكتب اسم الزائر أو الضيف الفعلي."}

    notes = str(raw.get("notes", "")).strip()
    lines = raw.get("items") or []
    line_data: list[tuple[Any, float]] = []
    for line in lines:
        try:
            qty = float(line.get("quantity"))
            item_id = int(line.get("service_item_id"))
        except (ValueError, TypeError):
            return {"client_uuid": client_uuid, "status": "error", "error": "أحد الأصناف أو الكميات غير صحيح."}
        item = db.execute(
            "SELECT * FROM service_items WHERE id=? AND company_id=? AND active=1",
            (item_id, company_id),
        ).fetchone()
        if not item or qty <= 0:
            return {
                "client_uuid": client_uuid,
                "status": "error",
                "error": "تحقق من الصنف والكمية؛ الكمية يجب أن تكون أكبر من صفر.",
            }
        line_data.append((item, qty))
    if not line_data:
        return {"client_uuid": client_uuid, "status": "error", "error": "أضف صنفاً واحداً على الأقل للطلب."}

    subtotal = sum(float(item["rate"]) * qty for item, qty in line_data)
    user = g.get("api_user")
    created_at = str(raw.get("created_at", "")).strip()
    try:
        cursor = db.execute(
            "INSERT INTO laundry_orders(company_id,employee_id,person_name,service_date,notes,status,subtotal,created_by,client_uuid,created_at) "
            "VALUES(?,?,?,?,?, 'pending',?,?,?,COALESCE(?, CURRENT_TIMESTAMP)) RETURNING id",
            (
                company_id,
                employee_id,
                person_name,
                service_date,
                notes,
                subtotal,
                user["id"] if user else None,
                client_uuid or None,
                created_at or None,
            ),
        )
        order_id = cursor.fetchone()["id"]
        reference = f"LND-{datetime.now():%y%m}-{order_id:06d}"
        db.execute("UPDATE laundry_orders SET reference=? WHERE id=?", (reference, order_id))
        for item, qty in line_data:
            rate = float(item["rate"])
            db.execute(
                "INSERT INTO laundry_order_items(order_id,service_item_id,item_name,unit,quantity,unit_price,line_total) "
                "VALUES(?,?,?,?,?,?,?)",
                (order_id, item["id"], item["name"], item["unit"], qty, rate, rate * qty),
            )
        db.commit()
    except (sqlite3.Error, psycopg.Error) as exc:
        db.rollback()
        return {"client_uuid": client_uuid, "status": "error", "error": f"تعذر الحفظ: {exc}"}

    return {
        "client_uuid": client_uuid,
        "status": "created",
        "order_id": order_id,
        "reference": reference,
        "subtotal": subtotal,
        "warnings": employee_shift_warnings(employee, service_date),
    }


@bp.route("/api/orders", methods=["POST"])
@api_roles_required("admin", "contractor")
def api_create_order() -> Any:
    payload = request.get_json(silent=True) or {}
    result = _create_order_payload(payload)
    if result.get("status") == "error":
        return _json_error(str(result.get("error", "تعذر إنشاء الطلب.")), 400)
    return jsonify({"ok": True, **result})


@bp.route("/api/sync/orders", methods=["POST"])
@api_roles_required("admin", "contractor")
def api_sync_orders() -> Any:
    payload = request.get_json(silent=True) or {}
    orders = payload.get("orders") or []
    if not isinstance(orders, list):
        return _json_error("صيغة الطلبات غير صحيحة.", 400)
    results: list[dict[str, Any]] = []
    accepted = 0
    duplicates = 0
    failed = 0
    for raw in orders:
        if not isinstance(raw, dict):
            failed += 1
            continue
        result = _create_order_payload(raw)
        results.append(result)
        if result.get("status") == "created":
            accepted += 1
        elif result.get("status") == "duplicate":
            duplicates += 1
        else:
            failed += 1
    return jsonify(
        {
            "ok": True,
            "accepted": accepted,
            "duplicates": duplicates,
            "failed": failed,
            "results": results,
        }
    )


@bp.route("/api/orders/<int:order_id>/deliver", methods=["POST"])
@api_roles_required("admin", "contractor")
def api_deliver(order_id: int) -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    order = db.execute(
        """SELECT o.*, e.name AS display_name FROM laundry_orders o
           JOIN employees e ON e.id=o.employee_id WHERE o.id=? AND o.company_id=?""",
        (order_id, company_id),
    ).fetchone()
    if not order:
        return _json_error("الطلب غير موجود.", 404)
    if order["status"] == "rejected":
        return _json_error("لا يمكن تسجيل استلام لطلب مرفوض.", 400)
    items = db.execute(
        "SELECT id, item_name, quantity, COALESCE(received_quantity, 0) AS received_quantity "
        "FROM laundry_order_items WHERE order_id=? ORDER BY id",
        (order_id,),
    ).fetchall()
    remaining_total = sum(
        max(float(item["quantity"] or 0) - float(item["received_quantity"] or 0), 0.0) for item in items
    )
    if remaining_total <= 0:
        return _json_error("تم استلام جميع القطع في هذا الطلب مسبقاً.", 409)
    payload = request.get_json(silent=True) or {}

    # مستلم الأصناف من المغسلة: نفس الموظف المسجل في الطلب أو اسم آخر يُسجَّل.
    receiver_kind = str(payload.get("receiver_kind", "same_employee")).strip() or "same_employee"
    if receiver_kind not in ("same_employee", "other"):
        return _json_error("اختر خيار مستلم الأصناف الصحيح.", 400)
    if receiver_kind == "other":
        receiver_name = str(payload.get("receiver_name", "")).strip()
        if not receiver_name:
            return _json_error("اكتب اسم مستلم الأصناف الآخر بعد استكمال الغسل.", 400)
    else:
        receiver_name = (order["person_name"] or order["display_name"] or "").strip()

    # القطع المستلمة في هذه الدفعة مع العدد: افتراضياً كل الكميات المتبقية.
    remaining_map = {
        int(item["id"]): max(float(item["quantity"] or 0) - float(item["received_quantity"] or 0), 0.0)
        for item in items
        if float(item["quantity"] or 0) - float(item["received_quantity"] or 0) > 0
    }
    received_map: dict[int, float] = dict(remaining_map)
    if payload.get("pieces"):
        received_map = {}
        for piece in payload.get("pieces") or []:
            try:
                piece_id = int(piece.get("id"))
                piece_qty = float(piece.get("quantity"))
            except (TypeError, ValueError):
                return _json_error("معرف الصنف أو الكمية المستلمة غير صحيحة.", 400)
            if piece_id not in remaining_map:
                return _json_error(f"قطعة غير تابعة لهذا الطلب أو تم استلامها مسبقاً (المعرف {piece_id}).", 400)
            if piece_qty <= 0:
                continue
            if piece_qty > remaining_map[piece_id] + 1e-9:
                item_name = next((item["item_name"] for item in items if int(item["id"]) == piece_id), str(piece_id))
                return _json_error(
                    f"الكمية المستلمة للصنف {item_name} أكبر من المتبقي ({remaining_map[piece_id]:g}).", 400
                )
            received_map[piece_id] = piece_qty
    if not received_map:
        return _json_error("حدّد القطع التي تم استلامها من المغسلة مع الكميات.", 400)

    user = g.api_user
    receipt_row = db.execute(
        "INSERT INTO laundry_receipts(company_id,order_id,receiver_kind,receiver_name,received_by,received_at) "
        "VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) RETURNING id",
        (company_id, order_id, receiver_kind, receiver_name, user["id"]),
    ).fetchone()
    receipt_id = receipt_row["id"]
    for item_id, qty in received_map.items():
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
        (user["id"], receiver_kind, receiver_name, order_id, company_id),
    )
    db.commit()
    remaining_after = remaining_total - sum(received_map.values())
    message = (
        "تم تسجيل الاستلام، وما زالت هناك قطع متبقية يمكن استلامها لاحقاً."
        if remaining_after > 0
        else "تم استلام جميع القطع النظيفة من المغسلة."
    )
    return jsonify({"ok": True, "message": message, "remaining": max(remaining_after, 0)})


@bp.route("/api/orders/<int:order_id>/confirm", methods=["POST"])
@api_roles_required("admin", "supervisor")
def api_confirm(order_id: int) -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    order = db.execute(
        "SELECT * FROM laundry_orders WHERE id=? AND company_id=?", (order_id, company_id)
    ).fetchone()
    if not order:
        return _json_error("الطلب غير موجود.", 404)
    if order["status"] != "pending":
        return _json_error("هذا الطلب تمت مراجعته مسبقاً.", 400)
    payload = request.get_json(silent=True) or {}
    decision = str(payload.get("decision", "")).strip()
    if decision not in ("approved", "rejected"):
        return _json_error("اختر قرار المراجعة الصحيح.", 400)
    if decision == "approved" and order["fulfillment_status"] != "delivered":
        return _json_error("لا يمكن اعتماد المستحقات قبل تسجيل تسليم الملابس أو المفروشات للموظف.", 400)
    reason = str(payload.get("rejection_reason", "")).strip()
    if decision == "rejected" and not reason:
        return _json_error("اكتب سبب الرفض لتوضيح المطلوب تعديله.", 400)
    user = g.api_user
    db.execute(
        "UPDATE laundry_orders SET status=?,confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP,rejection_reason=? WHERE id=? AND company_id=?",
        (decision, user["id"], reason, order_id, int(user["company_id"])),
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم اعتماد الطلب." if decision == "approved" else "تم رفض الطلب."})


@bp.route("/api/orders/<int:order_id>", methods=["DELETE"])
@api_roles_required("admin", "contractor")
def api_delete_order(order_id: int) -> Any:
    from app import get_db

    db = get_db()
    user = g.api_user
    company_id = int(user["company_id"])
    order = db.execute(
        "SELECT status, created_by FROM laundry_orders WHERE id=? AND company_id=?",
        (order_id, company_id),
    ).fetchone()
    if not order:
        return _json_error("الطلب غير موجود.", 404)
    if user["role"] == "contractor" and (
        order["status"] != "pending" or int(order["created_by"] or 0) != int(user["id"])
    ):
        return _json_error("يمكنك حذف طلباتك التي لم تُعتمد فقط.", 403)
    db.execute(
        "DELETE FROM laundry_orders WHERE id=? AND company_id=?", (order_id, company_id)
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم حذف الطلب نهائياً."})


# ---------------------------------------------------------------------------
# قاعدة الموظفين
# ---------------------------------------------------------------------------


def _employee_rows(q: str = "", type_filter: str = "", service_filter: str = "") -> list[dict[str, Any]]:
    from app import get_db

    db = get_db()
    sql = "SELECT * FROM employees WHERE company_id=?"
    conditions: list[str] = []
    params: list[Any] = [int(g.api_user["company_id"])]
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
        sql += " AND " + " AND ".join(conditions)
    sql += " ORDER BY active DESC, LOWER(name)"
    rows = _rows_to_dicts(db.execute(sql, params).fetchall())
    for row in rows:
        row["active"] = _bool(row.get("active"))
    return rows


@bp.route("/api/employees")
@api_company_required
def api_employees() -> Any:
    from app import get_db

    q = request.args.get("q", "").strip()
    type_filter = request.args.get("type", "all").strip()
    service_filter = request.args.get("service", "all").strip()
    employees = _employee_rows(q, type_filter, service_filter)
    service_types = [
        row["service_type"]
        for row in get_db().execute(
            "SELECT DISTINCT service_type FROM employees WHERE company_id=? AND service_type<>'' ORDER BY service_type",
            (int(g.api_user["company_id"]),),
        ).fetchall()
    ]
    return jsonify(
        {
            "ok": True,
            "employees": employees,
            "service_types": service_types,
            "count": len(employees),
        }
    )


@bp.route("/api/employees", methods=["POST"])
@api_roles_required("admin", "supervisor")
def api_employee_create() -> Any:
    from app import get_db

    db = get_db()
    payload = request.get_json(silent=True) or {}
    code = str(payload.get("employee_code", "")).strip()
    name = str(payload.get("name", "")).strip()
    person_type = str(payload.get("person_type", "company")).strip()
    if person_type not in ("company", "general"):
        person_type = "company"
    if not code or not name:
        return _json_error("رقم الموظف والاسم مطلوبان.", 400)
    try:
        db.execute(
            "INSERT INTO employees(company_id,employee_code,name,company,department,phone,person_type,notes) VALUES(?,?,?,?,?,?,?,?)",
            (
                int(g.api_user["company_id"]),
                code,
                name,
                str(payload.get("company", "")).strip(),
                str(payload.get("department", "")).strip(),
                str(payload.get("phone", "")).strip(),
                person_type,
                str(payload.get("notes", "")).strip(),
            ),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg.IntegrityError):
        db.rollback()
        return _json_error("رقم الموظف مستخدم من قبل. أدخل رقماً مختلفاً.", 400)
    return jsonify({"ok": True, "message": "تمت إضافة السجل بنجاح."})


@bp.route("/api/employees/<int:employee_id>", methods=["POST", "PUT"])
@api_roles_required("admin", "supervisor")
def api_employee_update(employee_id: int) -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    row = db.execute(
        "SELECT id FROM employees WHERE id=? AND company_id=?", (employee_id, company_id)
    ).fetchone()
    if not row:
        return _json_error("السجل غير موجود.", 404)
    payload = request.get_json(silent=True) or {}
    code = str(payload.get("employee_code", "")).strip()
    name = str(payload.get("name", "")).strip()
    person_type = str(payload.get("person_type", "company")).strip()
    if person_type not in ("company", "general"):
        person_type = "company"
    if not code or not name:
        return _json_error("رقم الموظف والاسم مطلوبان.", 400)
    try:
        db.execute(
            "UPDATE employees SET employee_code=?,name=?,company=?,department=?,phone=?,person_type=?,notes=? WHERE id=? AND company_id=?",
            (
                code,
                name,
                str(payload.get("company", "")).strip(),
                str(payload.get("department", "")).strip(),
                str(payload.get("phone", "")).strip(),
                person_type,
                str(payload.get("notes", "")).strip(),
                employee_id,
                company_id,
            ),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg.IntegrityError):
        db.rollback()
        return _json_error("رقم الموظف مستخدم من سجل آخر.", 400)
    return jsonify({"ok": True, "message": "تم تحديث بيانات السجل."})


@bp.route("/api/employees/<int:employee_id>/toggle", methods=["POST"])
@api_roles_required("admin", "supervisor")
def api_employee_toggle(employee_id: int) -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    row = db.execute(
        "SELECT active FROM employees WHERE id=? AND company_id=?", (employee_id, company_id)
    ).fetchone()
    if not row:
        return _json_error("السجل غير موجود.", 404)
    db.execute(
        "UPDATE employees SET active=? WHERE id=? AND company_id=?",
        (0 if row["active"] else 1, employee_id, company_id),
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم تحديث حالة السجل."})


# ---------------------------------------------------------------------------
# الخدمات والأسعار
# ---------------------------------------------------------------------------


@bp.route("/api/service-items")
@api_company_required
def api_service_items() -> Any:
    from app import get_db

    rows = _rows_to_dicts(
        get_db().execute(
            "SELECT * FROM service_items WHERE company_id=? ORDER BY active DESC,name",
            (int(g.api_user["company_id"]),),
        ).fetchall()
    )
    for row in rows:
        row["active"] = _bool(row.get("active"))
    return jsonify({"ok": True, "service_items": rows})


@bp.route("/api/service-items", methods=["POST"])
@api_roles_required("admin")
def api_service_item_create() -> Any:
    from app import get_db

    db = get_db()
    payload = request.get_json(silent=True) or {}
    code = str(payload.get("code", "")).strip().upper().replace(" ", "_")
    name = str(payload.get("name", "")).strip()
    unit = str(payload.get("unit", "قطعة")).strip() or "قطعة"
    try:
        rate = float(payload.get("rate", "0"))
    except (TypeError, ValueError):
        rate = -1
    if rate < 0 or not code or not name:
        return _json_error(
            "تعذرت الإضافة. تأكد من الاسم والرمز وأن السعر رقم غير سالب والرمز غير مكرر.", 400
        )
    try:
        db.execute(
            "INSERT INTO service_items(company_id,code,name,unit,rate) VALUES(?,?,?,?,?)",
            (int(g.api_user["company_id"]), code, name, unit, rate),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg.IntegrityError):
        db.rollback()
        return _json_error(
            "تعذرت الإضافة. تأكد من الاسم والرمز وأن السعر رقم غير سالب والرمز غير مكرر.", 400
        )
    return jsonify({"ok": True, "message": "تمت إضافة الخدمة والسعر."})


@bp.route("/api/service-items/<int:item_id>", methods=["POST", "PUT"])
@api_roles_required("admin")
def api_service_item_update(item_id: int) -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    row = db.execute(
        "SELECT id FROM service_items WHERE id=? AND company_id=?", (item_id, company_id)
    ).fetchone()
    if not row:
        return _json_error("الخدمة غير موجودة.", 404)
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", "")).strip()
    unit = str(payload.get("unit", "قطعة")).strip() or "قطعة"
    try:
        rate = float(payload.get("rate", ""))
    except (TypeError, ValueError):
        rate = -1
    if not name or rate < 0:
        return _json_error("أدخل اسماً وسعراً صحيحاً غير سالب.", 400)
    db.execute(
        "UPDATE service_items SET name=?,unit=?,rate=? WHERE id=? AND company_id=?",
        (name, unit, rate, item_id, company_id),
    )
    db.commit()
    return jsonify(
        {
            "ok": True,
            "message": "تم حفظ السعر. الطلبات السابقة تحتفظ بالسعر المسجل وقت إنشائها.",
        }
    )


@bp.route("/api/service-items/<int:item_id>/toggle", methods=["POST"])
@api_roles_required("admin")
def api_service_item_toggle(item_id: int) -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    row = db.execute(
        "SELECT active FROM service_items WHERE id=? AND company_id=?", (item_id, company_id)
    ).fetchone()
    if not row:
        return _json_error("الخدمة غير موجودة.", 404)
    db.execute(
        "UPDATE service_items SET active=? WHERE id=? AND company_id=?",
        (0 if row["active"] else 1, item_id, company_id),
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم تحديث حالة الخدمة."})


@bp.route("/api/service-items/<int:item_id>", methods=["DELETE"])
@api_roles_required("admin")
def api_service_item_delete(item_id: int) -> Any:
    from app import get_db

    db = get_db()
    company_id = int(g.api_user["company_id"])
    row = db.execute(
        "SELECT id FROM service_items WHERE id=? AND company_id=?", (item_id, company_id)
    ).fetchone()
    if not row:
        return _json_error("الخدمة غير موجودة.", 404)
    used = db.execute(
        "SELECT COUNT(*) AS total FROM laundry_order_items WHERE service_item_id=?", (item_id,)
    ).fetchone()["total"]
    if used:
        db.execute(
            "UPDATE service_items SET active=0 WHERE id=? AND company_id=?", (item_id, company_id)
        )
        db.commit()
        return jsonify(
            {
                "ok": True,
                "message": "الخدمة مستخدمة في طلبات سابقة، لذلك تم تعطيلها بدل حذفها للحفاظ على السجل.",
            }
        )
    db.execute("DELETE FROM service_items WHERE id=? AND company_id=?", (item_id, company_id))
    db.commit()
    return jsonify({"ok": True, "message": "تم حذف الخدمة نهائياً."})


# ---------------------------------------------------------------------------
# التقارير والمستحقات
# ---------------------------------------------------------------------------


@bp.route("/api/reports")
@api_company_required
def api_reports() -> Any:
    from app import employee_item_summary

    from_date = request.args.get("from", "").strip()
    to_date = request.args.get("to", "").strip()
    status = request.args.get("status", "all").strip()
    search = request.args.get("q", "").strip()
    orders = _filter_orders(from_date, to_date, status, search)
    approved_total = sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "approved")
    pending_total = sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "pending")
    rejected_total = sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "rejected")
    order_ids = [o["id"] for o in orders]
    summary = employee_item_summary(order_ids)
    service_type_totals = employee_item_summary(order_ids, group_by="service_type")
    return jsonify(
        {
            "ok": True,
            "orders": orders,
            "approved_total": approved_total,
            "pending_total": pending_total,
            "rejected_total": rejected_total,
            "summary": summary,
            "service_type_totals": service_type_totals,
            "settings": _settings_map(),
        }
    )


# ---------------------------------------------------------------------------
# المستخدمون والصلاحيات
# ---------------------------------------------------------------------------


@bp.route("/api/users")
@api_roles_required("admin")
def api_users() -> Any:
    from app import get_db

    rows = _rows_to_dicts(
        get_db().execute(
            "SELECT id,username,full_name,role,active,created_at,company_id FROM users "
            "WHERE company_id=? ORDER BY id",
            (int(g.api_user["company_id"]),),
        ).fetchall()
    )
    for row in rows:
        row["active"] = _bool(row.get("active"))
        row["role_label"] = ROLE_LABELS.get(row["role"], row["role"])
    return jsonify({"ok": True, "users": rows})


@bp.route("/api/users", methods=["POST"])
@api_roles_required("admin")
def api_user_create() -> Any:
    from app import get_db

    db = get_db()
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    full_name = str(payload.get("full_name", "")).strip()
    password = str(payload.get("password", ""))
    role = str(payload.get("role", "contractor")).strip()
    if role not in ROLES:
        role = "contractor"
    if len(username) < 3 or not full_name or len(password) < 8:
        return _json_error(
            "اسم المستخدم 3 أحرف على الأقل، والاسم مطلوب، وكلمة المرور 8 أحرف على الأقل.", 400
        )
    try:
        db.execute(
            "INSERT INTO users(username,password_hash,full_name,role,company_id) VALUES(?,?,?,?,?)",
            (
                username,
                generate_password_hash(password),
                full_name,
                role,
                int(g.api_user["company_id"]),
            ),
        )
        db.commit()
    except (sqlite3.IntegrityError, psycopg.IntegrityError):
        db.rollback()
        return _json_error("اسم المستخدم موجود مسبقاً.", 400)
    return jsonify({"ok": True, "message": "تم إنشاء حساب المستخدم."})


@bp.route("/api/users/<int:user_id>/reset", methods=["POST"])
@api_roles_required("admin")
def api_user_reset(user_id: int) -> Any:
    from app import get_db

    db = get_db()
    password = str((request.get_json(silent=True) or {}).get("password", ""))
    row = db.execute(
        "SELECT id FROM users WHERE id=? AND company_id=?",
        (user_id, int(g.api_user["company_id"])),
    ).fetchone()
    if not row:
        return _json_error("الحساب غير موجود.", 404)
    if len(password) < 8:
        return _json_error("كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف.", 400)
    db.execute(
        "UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(password), user_id)
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم تغيير كلمة مرور الحساب."})


@bp.route("/api/users/<int:user_id>/toggle", methods=["POST"])
@api_roles_required("admin")
def api_user_toggle(user_id: int) -> Any:
    from app import get_db

    db = get_db()
    if g.api_user["id"] == user_id:
        return _json_error("لا يمكن تعطيل الحساب المستخدم حالياً.", 400)
    row = db.execute(
        "SELECT active FROM users WHERE id=? AND company_id=?",
        (user_id, int(g.api_user["company_id"])),
    ).fetchone()
    if not row:
        return _json_error("الحساب غير موجود.", 404)
    db.execute("UPDATE users SET active=? WHERE id=?", (0 if row["active"] else 1, user_id))
    db.commit()
    return jsonify({"ok": True, "message": "تم تحديث حالة الحساب."})


def _other_active_admins(user_id: int) -> int:
    from app import get_db

    row = get_db().execute(
        "SELECT COUNT(*) AS total FROM users WHERE role='admin' AND active=1 AND id<>? AND company_id=?",
        (user_id, int(g.api_user["company_id"])),
    ).fetchone()
    return int(row["total"] or 0) if row else 0


@bp.route("/api/users/<int:user_id>", methods=["PUT", "POST"])
@api_roles_required("admin")
def api_user_update(user_id: int) -> Any:
    from app import get_db

    db = get_db()
    row = db.execute(
        "SELECT id,username,full_name,role FROM users WHERE id=? AND company_id=?",
        (user_id, int(g.api_user["company_id"])),
    ).fetchone()
    if not row:
        return _json_error("الحساب غير موجود.", 404)
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", row["username"])).strip()
    full_name = str(payload.get("full_name", row["full_name"])).strip()
    role = str(payload.get("role", row["role"])).strip()
    password = str(payload.get("password", "") or "")
    if role not in ROLES:
        return _json_error("الدور غير صالح.", 400)
    if len(username) < 3 or not full_name:
        return _json_error("اسم المستخدم 3 أحرف على الأقل، والاسم مطلوب.", 400)
    if password and len(password) < 8:
        return _json_error("كلمة المرور يجب ألا تقل عن 8 أحرف.", 400)
    if g.api_user["id"] == user_id and role != "admin":
        return _json_error("لا يمكن تغيير دور الحساب المستخدم حالياً.", 400)
    if row["role"] == "admin" and role != "admin" and _other_active_admins(user_id) == 0:
        return _json_error("لا يمكن إزالة صلاحية آخر مدير نظام نشط.", 400)
    try:
        db.execute(
            "UPDATE users SET username=?, full_name=?, role=? WHERE id=?",
            (username, full_name, role, user_id),
        )
        if password:
            db.execute(
                "UPDATE users SET password_hash=? WHERE id=?",
                (generate_password_hash(password), user_id),
            )
        db.commit()
    except (sqlite3.IntegrityError, psycopg.IntegrityError):
        db.rollback()
        return _json_error("اسم المستخدم موجود مسبقاً.", 400)
    return jsonify({"ok": True, "message": "تم تحديث بيانات الحساب."})


@bp.route("/api/users/<int:user_id>", methods=["DELETE"])
@api_roles_required("admin")
def api_user_delete(user_id: int) -> Any:
    from app import get_db

    db = get_db()
    if g.api_user["id"] == user_id:
        return _json_error("لا يمكن حذف الحساب المستخدم حالياً.", 400)
    row = db.execute(
        "SELECT id,full_name,role FROM users WHERE id=? AND company_id=?",
        (user_id, int(g.api_user["company_id"])),
    ).fetchone()
    if not row:
        return _json_error("الحساب غير موجود.", 404)
    if row["role"] == "admin" and _other_active_admins(user_id) == 0:
        return _json_error("لا يمكن حذف آخر مدير نظام نشط.", 400)
    linked = db.execute(
        "SELECT COUNT(*) AS total FROM laundry_orders "
        "WHERE created_by=? OR delivered_by=? OR confirmed_by=?",
        (user_id, user_id, user_id),
    ).fetchone()
    if linked and int(linked["total"] or 0) > 0:
        return _json_error(
            "لا يمكن حذف الحساب لارتباطه بطلبات مسجّلة؛ عطّله بدلاً من ذلك.", 400
        )
    db.execute(
        "DELETE FROM users WHERE id=? AND company_id=?",
        (user_id, int(g.api_user["company_id"])),
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم حذف الحساب."})


# ---------------------------------------------------------------------------
# الإعدادات
# ---------------------------------------------------------------------------


@bp.route("/api/settings")
@api_roles_required("admin")
def api_settings() -> Any:
    return jsonify({"ok": True, "settings": _settings_map()})


@bp.route("/api/settings", methods=["POST"])
@api_roles_required("admin")
def api_settings_update() -> Any:
    from app import get_db

    payload = request.get_json(silent=True) or {}
    currency = str(payload.get("currency", "")).strip()
    company_name = str(payload.get("company_name", "")).strip()
    if not currency or not company_name:
        return _json_error("اسم النظام والعملة مطلوبان.", 400)
    company_id = int(g.api_user["company_id"])
    db = get_db()
    for key, value in (("currency", currency), ("company_name", company_name)):
        db.execute(
            "INSERT INTO settings(company_id,key,value) VALUES(?,?,?) "
            "ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value",
            (company_id, key, value),
        )
    db.execute("UPDATE companies SET name=? WHERE id=?", (company_name, company_id))
    db.commit()
    return jsonify({"ok": True, "message": "تم حفظ الإعدادات."})


# ---------------------------------------------------------------------------
# الشركات (المدير العام)
# ---------------------------------------------------------------------------


@bp.route("/api/companies")
@api_roles_required("super_admin")
def api_companies() -> Any:
    user = g.get("api_user")
    if not _api_is_system_admin(user):
        return _json_error("غير مصرح", 403)
    from app import get_db

    rows = get_db().execute(
        "SELECT id, code, name, active, created_at FROM companies ORDER BY id"
    ).fetchall()
    companies = []
    for row in rows:
        data = dict(row)
        data["active"] = _bool(data.get("active"))
        data.update(_company_counts(int(row["id"])))
        companies.append(data)
    return jsonify({"ok": True, "companies": companies, "count": len(companies)})


@bp.route("/api/companies", methods=["POST"])
@api_roles_required("super_admin")
def api_company_create() -> Any:
    from app import create_company, get_db

    payload = request.get_json(silent=True) or {}
    code = str(payload.get("code", "")).strip()
    name = str(payload.get("name", "")).strip()
    admin_username = str(payload.get("admin_username", "")).strip()
    admin_name = str(payload.get("admin_name", "")).strip() or f"مدير {name}"
    admin_password = str(payload.get("admin_password", ""))
    if not code or not name:
        return _json_error("رمز الشركة واسمها مطلوبان.", 400)
    if admin_username and len(admin_password) < 8:
        return _json_error("كلمة مرور مدير الشركة يجب ألا تقل عن 8 أحرف.", 400)
    db = get_db()
    try:
        company_id = create_company(db, code, name)
        if admin_username:
            db.execute(
                "INSERT INTO users(username,password_hash,full_name,role,company_id) "
                "VALUES(?,?,?,'admin',?)",
                (admin_username, generate_password_hash(admin_password), admin_name, company_id),
            )
        db.commit()
    except (ValueError, sqlite3.IntegrityError, psycopg.IntegrityError):
        db.rollback()
        return _json_error("تعذر إنشاء الشركة. تأكد من عدم تكرار رمز الشركة أو اسم المستخدم.", 400)
    return jsonify(
        {
            "ok": True,
            "company_id": company_id,
            "message": "تم إنشاء الشركة" + (" وإضافة مديرها." if admin_username else "."),
        }
    )


@bp.route("/api/companies/<int:company_id>", methods=["PUT", "POST"])
@api_roles_required("super_admin")
def api_company_update(company_id: int) -> Any:
    from app import get_db

    db = get_db()
    row = db.execute("SELECT id, name, active FROM companies WHERE id=?", (company_id,)).fetchone()
    if not row:
        return _json_error("الشركة غير موجودة.", 404)
    payload = request.get_json(silent=True) or {}
    name = str(payload.get("name", row["name"])).strip() or row["name"]
    active = payload.get("active", row["active"])
    active_value = 1 if active in (True, 1, "1", "true", "True") else 0
    db.execute("UPDATE companies SET name=?, active=? WHERE id=?", (name, active_value, company_id))
    if name != row["name"]:
        db.execute(
            "INSERT INTO settings(company_id,key,value) VALUES(?,'company_name',?) "
            "ON CONFLICT(company_id,key) DO UPDATE SET value=excluded.value",
            (company_id, name),
        )
    db.commit()
    return jsonify({"ok": True, "message": "تم تحديث بيانات الشركة."})


@bp.route("/api/companies/<int:company_id>/toggle", methods=["POST"])
@api_roles_required("super_admin")
def api_company_toggle(company_id: int) -> Any:
    user = g.get("api_user")
    if not _api_is_system_admin(user):
        return _json_error("غير مصرح", 403)
    from app import get_db

    db = get_db()
    row = db.execute("SELECT active FROM companies WHERE id=?", (company_id,)).fetchone()
    if not row:
        return _json_error("الشركة غير موجودة.", 404)
    db.execute("UPDATE companies SET active=? WHERE id=?", (0 if row["active"] else 1, company_id))
    db.commit()
    return jsonify({"ok": True, "message": "تم تحديث حالة الشركة."})


@bp.route("/api/users/companies")
@api_roles_required("super_admin")
def api_users_companies() -> Any:
    """قائمة مستخدمي شركة محددة للمدير العام (عرض فقط)."""
    from app import get_db

    company_id = request.args.get("company_id", "").strip()
    if not company_id.isdigit():
        return _json_error("حدّد رقم الشركة.", 400)
    rows = _rows_to_dicts(
        get_db().execute(
            "SELECT id, username, full_name, role, active, company_id FROM users "
            "WHERE company_id=? ORDER BY id",
            (int(company_id),),
        ).fetchall()
    )
    for row in rows:
        row["active"] = _bool(row.get("active"))
        row["role_label"] = ROLE_LABELS.get(row["role"], row["role"])
    return jsonify({"ok": True, "users": rows})


# ---------------------------------------------------------------------------
# تقرير غسيل سكن الموظفين
# ---------------------------------------------------------------------------


def _housing_query_dates() -> tuple[str, str]:
    from datetime import date

    from app import safe_date

    today = date.today()
    start = safe_date(request.args.get("from", ""), today.replace(day=1).isoformat())
    end = safe_date(request.args.get("to", ""), today.isoformat())
    if start > end:
        start, end = end, start
    return start, end


@bp.route("/api/reports/housing")
@api_roles_required("admin", "supervisor")
def api_housing_report() -> Any:
    from app import housing_report_data

    start, end = _housing_query_dates()
    housing_only = request.args.get("housing") in ("1", "true", "True")
    company = g.api_company
    data = housing_report_data(int(company["id"]), start, end, housing_only)
    data["company_name"] = company["name"]
    return jsonify({"ok": True, **data})


@bp.route("/api/reports/housing/export")
@api_roles_required("admin", "supervisor")
def api_housing_report_export() -> Any:
    from flask import Response

    from app import housing_report_data
    from report_exports import build_housing_csv, build_housing_pdf, build_housing_xlsx

    fmt = request.args.get("format", "pdf").strip().lower()
    if fmt not in ("pdf", "xlsx", "csv"):
        return _json_error("صيغة التصدير يجب أن تكون pdf أو xlsx أو csv.", 400)
    start, end = _housing_query_dates()
    housing_only = request.args.get("housing") in ("1", "true", "True")
    company = g.api_company
    data = housing_report_data(int(company["id"]), start, end, housing_only)
    data["company_name"] = company["name"]
    data["today"] = start
    if fmt == "xlsx":
        payload = build_housing_xlsx(data)
        mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif fmt == "csv":
        payload = build_housing_csv(data)
        mimetype = "text/csv; charset=utf-8"
    else:
        payload = build_housing_pdf(data)
        mimetype = "application/pdf"
    filename = f"housing-report-{data['start']}-{data['end']}.{fmt}"
    return Response(
        payload,
        mimetype=mimetype,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


# ---------------------------------------------------------------------------
# تصدير التقارير PDF / Excel
# ---------------------------------------------------------------------------


@bp.route("/api/reports/export")
@api_company_required
def api_report_export() -> Any:
    from datetime import date as _date

    from flask import Response

    from app import get_setting, order_items, safe_date
    from report_exports import build_pdf, build_table_csv, build_xlsx

    fmt = request.args.get("format", "pdf").strip().lower()
    if fmt not in ("pdf", "xlsx", "csv"):
        return _json_error("صيغة التصدير يجب أن تكون pdf أو xlsx أو csv.", 400)
    today = _date.today()
    from_date = safe_date(request.args.get("from", "").strip(), today.replace(day=1).isoformat())
    to_date = safe_date(request.args.get("to", "").strip(), today.isoformat())
    if from_date > to_date:
        from_date, to_date = to_date, from_date
    status = request.args.get("status", "all").strip()
    fulfillment = request.args.get("fulfillment", "all").strip()
    if fulfillment not in ("all", "received", "delivered", "partial"):
        fulfillment = "all"
    search = request.args.get("q", "").strip()
    orders = _filter_orders(from_date, to_date, status, search, fulfillment)
    items_by_order = {int(order["id"]): _rows_to_dicts(order_items(int(order["id"]))) for order in orders}
    from app import employee_item_summary

    order_ids = [int(order["id"]) for order in orders]
    summary = employee_item_summary(order_ids)
    service_summary = employee_item_summary(order_ids, group_by="service_type")
    totals = {
        "approved": sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "approved"),
        "pending": sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "pending"),
        "rejected": sum(float(o.get("subtotal") or 0) for o in orders if o["status"] == "rejected"),
    }
    company = g.api_company
    payload = {
        "company_name": company["name"] if company else "مغسلة الشركة",
        "currency": get_setting("currency", "ريال يمني"),
        "start": from_date or "—",
        "end": to_date or "—",
        "status": status,
        "fulfillment": fulfillment,
        "orders": orders,
        "items_by_order": items_by_order,
        "summary": summary,
        "service_summary": service_summary,
        "totals": totals,
    }
    stamp = f"{from_date or 'all'}-{to_date or 'all'}"
    if fmt == "xlsx":
        data = build_xlsx(payload)
        mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = f"laundry-report-{stamp}.xlsx"
    elif fmt == "csv":
        headers = [
            "رقم الطلب",
            "التاريخ",
            "رقم الموظف",
            "الاسم",
            "الشركة",
            "القسم",
            "الصنف",
            "الكمية",
            "المستلم",
            "المتبقي",
            "الوحدة",
            "سعر الوحدة",
            "الإجمالي",
            "الحالة",
            "التسليم",
            "مستلم الأصناف",
            "وقت الاستلام",
            "مدخل الطلب",
            "ملاحظات",
        ]
        status_labels = {"pending": "بانتظار التأكيد", "approved": "معتمد", "rejected": "مرفوض"}
        csv_rows: list[list[Any]] = []
        for order in orders:
            for item in items_by_order[int(order["id"])]:
                received = item.get("received_quantity")
                quantity = float(item.get("quantity") or 0)
                remaining = max(quantity - float(received or 0), 0.0) if received is not None else quantity
                csv_rows.append(
                    [
                        order.get("reference"),
                        order.get("service_date"),
                        order.get("employee_code"),
                        order.get("person_name") or order.get("employee_name"),
                        order.get("company"),
                        order.get("department"),
                        item.get("item_name"),
                        quantity,
                        received if received is not None else "",
                        remaining,
                        item.get("unit"),
                        item.get("unit_price"),
                        item.get("line_total"),
                        status_labels.get(order.get("status"), order.get("status")),
                        "تم التسليم" if order.get("fulfillment_status") == "delivered" else "لم يُسلَّم",
                        order.get("receiver_name") or "",
                        order.get("received_at") or "",
                        order.get("creator_name") or "",
                        order.get("notes") or "",
                    ]
                )
        data = build_table_csv(headers, csv_rows)
        mimetype = "text/csv; charset=utf-8"
        filename = f"laundry-report-{stamp}.csv"
    else:
        data = build_pdf(payload)
        mimetype = "application/pdf"
        filename = f"laundry-report-{stamp}.pdf"
    response = Response(data, mimetype=mimetype)
    response.headers["Content-Disposition"] = f"attachment; filename={filename}"
    response.headers["Cache-Control"] = "no-store"
    return response


def register(app: Any) -> None:
    app.register_blueprint(bp)

