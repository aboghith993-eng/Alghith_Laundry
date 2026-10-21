"""JSON API للتطبيق الجوال (offline-first).

يوفر هذا الملف نقاط نهاية REST لتطبيق الجوال الأصلي (Capacitor):
- تسجيل الدخول والإبقاء على الجلسة عبر رموز موقّعة (itsdangerous).
- تنزيل نسخة كاملة (snapshot) من الموظفين والأصناف والإعدادات للعمل دون اتصال.
- مزامنة الطلبات المُنشأة محلياً (idempotent عبر client_uuid).
- تسجيل التسليم واعتماد/رفض الطلبات من الجوال.

جميع النقاط تعيد JSON، وتتجاوز حماية CSRF الخاصة بالنماذج، وتسمح بـ CORS
لأصل تطبيق Capacitor (https://localhost و capacitor://localhost).
"""

from __future__ import annotations

import hmac
import os
import secrets
import sqlite3
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from typing import Any, Callable

import psycopg
from flask import Blueprint, current_app, g, jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash

bp = Blueprint("mobile_api", __name__)

ACCESS_TOKEN_HOURS = int(os.environ.get("MOBILE_ACCESS_TOKEN_HOURS", "72"))
REFRESH_TOKEN_DAYS = int(os.environ.get("MOBILE_REFRESH_TOKEN_DAYS", "60"))

ALLOWED_ORIGINS = {
    "https://localhost",
    "capacitor://localhost",
    "http://localhost",
    "https://localhost:443",
}


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt="laundry-mobile-v1")


def _make_tokens(user: Any) -> dict[str, str]:
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


def _user_public(user: Any) -> dict[str, Any]:
    return {
        "id": int(user["id"]),
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
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
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, DELETE, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "86400"
    return response


def _json_error(message: str, status: int = 400) -> Any:
    return jsonify({"ok": False, "error": message}), status


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
        "SELECT id,username,full_name,role,active FROM users WHERE id=?", (data.get("sub"),)
    ).fetchone()
    if not user or not user["active"]:
        return None
    return user


def api_login_required(view: Callable[..., Any]) -> Callable[..., Any]:
    @wraps(view)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        user = _token_user()
        if user is None:
            return _json_error("انتهت الجلسة أو الرمز غير صالح. سجّل الدخول مجدداً.", 401)
        g.api_user = user
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


@bp.route("/api/mobile/ping")
def ping() -> Any:
    return jsonify({"ok": True, "app": "Laundry Management", "api": "mobile-v1"})


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
    tokens = _make_tokens(user)
    return jsonify({"ok": True, "user": _user_public(user), **tokens})


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
        "SELECT * FROM users WHERE id=? AND active=1", (data.get("sub"),)
    ).fetchone()
    if not user:
        return _json_error("الحساب غير موجود أو معطّل.", 401)
    tokens = _make_tokens(user)
    return jsonify({"ok": True, "user": _user_public(user), **tokens})


@bp.route("/api/auth/me")
@api_login_required
def api_me() -> Any:
    return jsonify({"ok": True, "user": _user_public(g.api_user)})


def _norm(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if " " in s and s.count(":") >= 2:
            return s.replace(" ", "T")
        return s
    return value


@bp.route("/api/sync/snapshot")
@api_login_required
def api_snapshot() -> Any:
    from app import get_db

    db = get_db()
    employees = [
        dict(r)
        for r in db.execute(
            """
            SELECT id, employee_code, name, company, department, phone, person_type, active,
                   service_type, shift_system, shift_description, work_days, rest_days,
                   cycle_start, cycle_anchor, cycle_day, status_label, departure_time,
                   housing_location, job_title, gender, transport_class
            FROM employees WHERE active=1 ORDER BY employee_code
            """
        ).fetchall()
    ]
    for emp in employees:
        emp["active"] = bool(emp["active"])
    items = [
        dict(r)
        for r in db.execute(
            "SELECT id, code, name, unit, rate, active FROM service_items WHERE active=1 ORDER BY name"
        ).fetchall()
    ]
    for item in items:
        item["active"] = bool(item["active"])
    settings = {
        row["key"]: row["value"]
        for row in db.execute("SELECT key, value FROM settings").fetchall()
    }
    return jsonify(
        {
            "ok": True,
            "version": 1,
            "built_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "counts": {"employees": len(employees), "service_items": len(items)},
            "employees": employees,
            "service_items": items,
            "settings": settings,
        }
    )


def _find_local_order(db: Any, client_uuid: str) -> Any | None:
    if not client_uuid:
        return None
    return db.execute(
        "SELECT id, reference FROM laundry_orders WHERE client_uuid=?", (client_uuid,)
    ).fetchone()


@bp.route("/api/sync/orders", methods=["POST"])
@api_roles_required("admin", "contractor")
def api_sync_orders() -> Any:
    from app import get_db, employee_shift_warnings, safe_date

    db = get_db()
    payload = request.get_json(silent=True) or {}
    orders = payload.get("orders") or []
    if not isinstance(orders, list):
        return _json_error("صيغة الطلبات غير صحيحة.", 400)
    results: list[dict[str, Any]] = []
    accepted = 0
    duplicates = 0
    failed = 0
    user = g.api_user
    for raw in orders:
        client_uuid = str(raw.get("client_uuid", "")).strip()
        try:
            if client_uuid:
                existing = _find_local_order(db, client_uuid)
                if existing:
                    results.append(
                        {
                            "client_uuid": client_uuid,
                            "status": "duplicate",
                            "order_id": existing["id"],
                            "reference": existing["reference"],
                        }
                    )
                    duplicates += 1
                    continue
            employee_code = str(raw.get("employee_code", "")).strip()
            employee = db.execute(
                "SELECT * FROM employees WHERE employee_code=? AND active=1", (employee_code,)
            ).fetchone()
            if not employee:
                results.append(
                    {"client_uuid": client_uuid, "status": "error", "error": "الموظف غير موجود أو غير فعّال."}
                )
                failed += 1
                continue
            service_date = safe_date(str(raw.get("service_date", "")), "")
            if not service_date:
                results.append({"client_uuid": client_uuid, "status": "error", "error": "تاريخ الخدمة غير صحيح."})
                failed += 1
                continue
            person_name = str(raw.get("person_name", "")).strip()
            lines = raw.get("items") or []
            line_data: list[tuple[Any, float]] = []
            bad = False
            for line in lines:
                item_id = line.get("service_item_id")
                qty = line.get("quantity")
                try:
                    qty = float(qty)
                    item_id = int(item_id)
                except (ValueError, TypeError):
                    results.append({"client_uuid": client_uuid, "status": "error", "error": "صنف أو كمية غير صحيحة."})
                    failed += 1
                    bad = True
                    break
                item = db.execute(
                    "SELECT * FROM service_items WHERE id=? AND active=1", (item_id,)
                ).fetchone()
                if not item or qty <= 0:
                    results.append({"client_uuid": client_uuid, "status": "error", "error": "تحقق من الصنف والكمية."})
                    failed += 1
                    bad = True
                    break
                line_data.append((item, qty))
            if bad:
                continue
            if not line_data:
                results.append({"client_uuid": client_uuid, "status": "error", "error": "أضف صنفاً واحداً على الأقل."})
                failed += 1
                continue
            if employee["person_type"] == "general" and not person_name:
                results.append({"client_uuid": client_uuid, "status": "error", "error": "للسجل العام اكتب اسم الزائر."})
                failed += 1
                continue
            subtotal = sum(float(item["rate"]) * qty for item, qty in line_data)
            notes = str(raw.get("notes", "")).strip()
            created_at = str(raw.get("created_at", "")).strip()
            cursor = db.execute(
                "INSERT INTO laundry_orders(employee_id,person_name,service_date,notes,status,subtotal,created_by,client_uuid,created_at) "
                "VALUES(?,?,?,?, 'pending',?,?,?,COALESCE(?, CURRENT_TIMESTAMP)) RETURNING id",
                (employee["id"], person_name, service_date, notes, subtotal, user["id"], client_uuid or None, created_at or None),
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
            results.append(
                {
                    "client_uuid": client_uuid,
                    "status": "created",
                    "order_id": order_id,
                    "reference": reference,
                    "warnings": employee_shift_warnings(employee, service_date),
                }
            )
            accepted += 1
        except (sqlite3.Error, psycopg.Error) as exc:
            db.rollback()
            results.append({"client_uuid": client_uuid, "status": "error", "error": f"تعذر الحفظ: {exc}"})
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


@bp.route("/api/orders")
@api_login_required
def api_orders() -> Any:
    from app import get_db, order_items, order_query

    conditions: list[str] = []
    params: list[Any] = []
    date_from = request.args.get("from", "").strip()
    date_to = request.args.get("to", "").strip()
    if date_from:
        conditions.append("o.service_date >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("o.service_date <= ?")
        params.append(date_to)
    status = request.args.get("status", "").strip()
    if status in {"pending", "approved", "rejected"}:
        conditions.append("o.status = ?")
        params.append(status)
    search = request.args.get("q", "").strip()
    if search:
        like = f"%{search}%"
        conditions.append(
            "(o.reference LIKE ? OR e.name LIKE ? OR e.employee_code LIKE ? OR o.person_name LIKE ?)"
        )
        params.extend([like, like, like, like])
    where = " AND ".join(conditions)
    rows = order_query(where, tuple(params))
    limit = min(int(request.args.get("limit", "200") or 200), 1000)
    rows = rows[:limit]
    result = []
    for row in rows:
        data = dict(row)
        data["items"] = [dict(i) for i in order_items(row["id"])]
        result.append(data)
    return jsonify({"ok": True, "orders": result})


@bp.route("/api/orders/<int:order_id>/deliver", methods=["POST"])
@api_roles_required("admin", "contractor")
def api_deliver(order_id: int) -> Any:
    from app import get_db

    db = get_db()
    order = db.execute("SELECT * FROM laundry_orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        return _json_error("الطلب غير موجود.", 404)
    if order["status"] != "pending":
        return _json_error("لا يمكن تعديل التسليم بعد اعتماد الطلب أو رفضه.", 400)
    user = g.api_user
    db.execute(
        "UPDATE laundry_orders SET fulfillment_status='delivered',delivered_at=CURRENT_TIMESTAMP,delivered_by=? WHERE id=?",
        (user["id"], order_id),
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم تسجيل تسليم القطع النظيفة."})


@bp.route("/api/orders/<int:order_id>/confirm", methods=["POST"])
@api_roles_required("admin", "supervisor")
def api_confirm(order_id: int) -> Any:
    from app import get_db

    db = get_db()
    order = db.execute("SELECT * FROM laundry_orders WHERE id=?", (order_id,)).fetchone()
    if not order:
        return _json_error("الطلب غير موجود.", 404)
    if order["status"] != "pending":
        return _json_error("هذا الطلب تمت مراجعته مسبقاً.", 400)
    payload = request.get_json(silent=True) or {}
    decision = str(payload.get("decision", "")).strip()
    if decision not in ("approved", "rejected"):
        return _json_error("اختر قرار المراجعة الصحيح.", 400)
    if decision == "approved" and order["fulfillment_status"] != "delivered":
        return _json_error("لا يمكن اعتماد المستحقات قبل تسجيل تسليم الملابس للموظف.", 400)
    reason = str(payload.get("rejection_reason", "")).strip()
    if decision == "rejected" and not reason:
        return _json_error("اكتب سبب الرفض.", 400)
    user = g.api_user
    db.execute(
        "UPDATE laundry_orders SET status=?,confirmed_by=?,confirmed_at=CURRENT_TIMESTAMP,rejection_reason=? WHERE id=?",
        (decision, user["id"], reason, order_id),
    )
    db.commit()
    return jsonify({"ok": True, "message": "تم اعتماد الطلب." if decision == "approved" else "تم رفض الطلب."})


@bp.route("/api/orders/<int:order_id>")
@api_login_required
def api_order_detail(order_id: int) -> Any:
    from app import order_items, order_query

    rows = order_query("o.id=?", (order_id,))
    if not rows:
        return _json_error("الطلب غير موجود.", 404)
    data = dict(rows[0])
    data["items"] = [dict(i) for i in order_items(order_id)]
    return jsonify({"ok": True, "order": data})


def register(app: Any) -> None:
    app.register_blueprint(bp)
