"""استيراد كشف الموظفين من ملف Excel إلى قاعدة بيانات نظام المغسلة.

السكربت يقرأ كشف الموظفين (سجل دوام الموظفين مع نوع الخدمة ودورة الدوام)،
ويستورد موظفي الشركة المطلوبة فقط، ويحسب «مرساة الدورة» لكل موظف بحيث يعيد
النظام حساب يوم الدورة وحالة الدوام (دوام/راحة) لأي تاريخ.

الاستخدام:
    python import_employees.py                       # استيراد الملف الموجود في المجلد
    python import_employees.py --dry-run              # فحص دون كتابة في قاعدة البيانات
    python import_employees.py --company "الشركة اليمنية لتكرير السكر"
    python import_employees.py --reference-date 2026-08-12
"""
from __future__ import annotations

import argparse
import glob
import io
import os
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from xlsx_reader import parse_excel_date, parse_excel_time, read_workbook  # noqa: E402

DEFAULT_COMPANY = "الشركة اليمنية لتكرير السكر"
DEFAULT_REFERENCE_DATE = "2026-08-12"

#: خريطة الأعمدة العربية إلى حقول قاعدة البيانات.
COLUMN_MAP = {
    "الكود": "employee_code",
    "الاسم الرسمي": "name",
    "اسم الادارة الفرعية": "department",
    "المسمى الوظيفي": "job_title",
    "جدول العمل": "shift_system",
    "شرح نوع الدوام": "shift_description",
    "عدد ايام العمل": "work_days",
    "عدد ايام الراحة": "rest_days",
    "تاريخ اول يوم عمل": "cycle_start",
    "الحالة الدورية للموظف": "status_label",
    "وقت المغادرة": "departure_time",
    "نوع الجنس": "gender",
    "الشركة": "company",
    "موقع السكن": "housing_location",
    "نوع الخدمة": "service_type",
    "تصنيف النقل": "transport_class",
    "يوم الدورة اليوم": "cycle_day",
    "الحالة الاساسية اليوم": "base_status",
    "يوم الدورة غدا": "cycle_day_tomorrow",
}

#: الحالات التشغيلية التي لا تعكس دوام/راحة.
OPERATIONAL_STATUSES = ("مغادر", "ترتيب مواصلات")


def normalize(text: str) -> str:
    """توحيد نص العناوين العربية لمقارنتها بأمان."""
    value = (text or "").strip()
    value = "".join(char for char in value if not ("\u064b" <= char <= "\u0652"))
    value = value.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    value = value.replace("ى", "ي").replace("ة", "ه")
    value = value.replace("\u200f", "").replace("\u200e", "")
    return " ".join(value.split())


#: خريطة موحّدة (بدون تشكيل ولا همزات) من العناوين العربية إلى حقول قاعدة البيانات.
COLUMN_LOOKUP = {normalize(key): value for key, value in COLUMN_MAP.items()}


def find_source_file(explicit: str | None) -> Path:
    """تحديد ملف Excel المصدر: مسار محدد أو أول ملف xlsx في مجلد المشروع."""
    if explicit:
        path = Path(explicit)
        if not path.exists():
            raise SystemExit(f"الملف غير موجود: {path}")
        return path
    candidates = sorted(glob.glob(str(BASE_DIR / "*.xlsx")))
    if not candidates:
        raise SystemExit("لم يتم العثور على أي ملف xlsx في مجلد المشروع.")
    if len(candidates) > 1:
        print(f"تم العثور على {len(candidates)} ملفات، سيُستخدم: {Path(candidates[0]).name}")
    return Path(candidates[0])


def read_records(path: Path, sheet_index: int) -> tuple[str, list[dict[str, str]]]:
    """قراءة الورقة وإرجاع صفوفها كقواميس بأسماء الحقول."""
    sheets = read_workbook(str(path))
    if sheet_index >= len(sheets):
        raise SystemExit(f"الملف يحتوي على {len(sheets)} ورقة فقط.")
    name, rows = sheets[sheet_index]
    if not rows:
        return name, []
    header = rows[0]
    mapping = {index: COLUMN_LOOKUP.get(normalize(title), "") for index, title in enumerate(header)}
    records: list[dict[str, str]] = []
    for row in rows[1:]:
        record: dict[str, str] = {}
        for index, field in mapping.items():
            if not field:
                continue
            value = row[index] if index < len(row) else ""
            record[field] = (value or "").strip()
        records.append(record)
    return name, records


def to_int(value: str) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def build_employee(record: dict[str, str], reference: date) -> dict[str, object] | None:
    """تحويل صف الكشف إلى سجل جاهز للحفظ، مع حساب مرساة الدورة."""
    code = record.get("employee_code", "").strip()
    name = record.get("name", "").strip()
    if not code or not name:
        return None
    work_days = to_int(record.get("work_days", ""))
    rest_days = to_int(record.get("rest_days", ""))
    cycle_day = to_int(record.get("cycle_day", ""))
    cycle_length = work_days + rest_days
    anchor = ""
    if cycle_length > 0 and cycle_day > 0:
        anchor = (reference - timedelta(days=cycle_day - 1)).isoformat()
    return {
        "employee_code": code,
        "name": name,
        "company": record.get("company", ""),
        "department": record.get("department", ""),
        "person_type": "company",
        "service_type": record.get("service_type", ""),
        "shift_system": record.get("shift_system", ""),
        "shift_description": record.get("shift_description", ""),
        "work_days": work_days,
        "rest_days": rest_days,
        "cycle_start": parse_excel_date(record.get("cycle_start", "")),
        "cycle_anchor": anchor,
        "cycle_day": cycle_day,
        "status_label": record.get("status_label", ""),
        "departure_time": parse_excel_time(record.get("departure_time", "")),
        "housing_location": record.get("housing_location", ""),
        "job_title": record.get("job_title", ""),
        "gender": record.get("gender", ""),
        "transport_class": record.get("transport_class", ""),
    }


def verify(records: list[dict[str, str]], reference: date) -> dict[str, object]:
    """فحص اتساق النموذج مع كشف الموظفين."""
    status_ok = status_bad = status_skipped = 0
    next_ok = next_bad = 0
    phase: dict[tuple[str, int, int], Counter] = defaultdict(Counter)
    for record in records:
        work_days = to_int(record.get("work_days", ""))
        rest_days = to_int(record.get("rest_days", ""))
        cycle_length = work_days + rest_days
        cycle_day = to_int(record.get("cycle_day", ""))
        if cycle_length <= 0 or cycle_day <= 0:
            continue
        base_status = record.get("base_status", "")
        if base_status in OPERATIONAL_STATUSES:
            status_skipped += 1
        else:
            expected = "مداوم" if cycle_day <= work_days else "إجازة"
            if base_status == expected:
                status_ok += 1
            else:
                status_bad += 1
        expected_next = (cycle_day % cycle_length) + 1
        if to_int(record.get("cycle_day_tomorrow", "")) == expected_next:
            next_ok += 1
        else:
            next_bad += 1
        start = parse_excel_date(record.get("cycle_start", ""))
        if start:
            anchor = reference - timedelta(days=cycle_day - 1)
            key = (record.get("shift_system", ""), work_days, rest_days)
            phase[key][(date.fromisoformat(start) - anchor).days % cycle_length] += 1
    consistent_groups = sum(1 for counter in phase.values() if len(counter) == 1)
    return {
        "status_ok": status_ok,
        "status_bad": status_bad,
        "status_skipped": status_skipped,
        "next_ok": next_ok,
        "next_bad": next_bad,
        "groups": len(phase),
        "consistent_groups": consistent_groups,
        "phase": phase,
    }


EMPLOYEE_COLUMNS = (
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
INT_COLUMNS = {"active", "work_days", "rest_days", "cycle_day"}


def _row_tuple(values: dict[str, object]) -> tuple[object, ...]:
    result: list[object] = []
    for column in EMPLOYEE_COLUMNS:
        value = values.get(column)
        if column in INT_COLUMNS:
            result.append(int(value or 0))
        else:
            result.append("" if value is None else str(value))
    return tuple(result)


def upsert_employees(db: object, translate: object, rows: list[tuple[object, ...]]) -> tuple[int, int]:
    """إدخال/تحديث دفعة موظفين بجملة واحدة (executemany)."""
    if not rows:
        return 0, 0
    placeholders = ",".join("?" for _ in EMPLOYEE_COLUMNS)
    updates = ",".join(f"{column}=excluded.{column}" for column in EMPLOYEE_COLUMNS if column != "employee_code")
    single = f"INSERT INTO employees({','.join(EMPLOYEE_COLUMNS)}) VALUES({placeholders}) ON CONFLICT(employee_code) DO UPDATE SET {updates}"
    multi_values = "(" + placeholders + ")"
    codes = [str(row[0]) for row in rows]
    existing: set[str] = set()
    for index in range(0, len(codes), 200):
        chunk = codes[index : index + 200]
        marks = ",".join("?" for _ in chunk)
        found = db.execute(
            translate(f"SELECT employee_code FROM employees WHERE employee_code IN ({marks})"),
            tuple(chunk),
        ).fetchall()
        existing.update(str(row["employee_code"]) for row in found)
    for index in range(0, len(rows), 100):
        batch = rows[index : index + 100]
        if len(batch) == 1:
            db.execute(translate(single), batch[0])
        else:
            values_sql = ",".join(multi_values for _ in batch)
            params = tuple(value for row in batch for value in row)
            db.execute(
                translate(
                    f"INSERT INTO employees({','.join(EMPLOYEE_COLUMNS)}) VALUES {values_sql} "
                    f"ON CONFLICT(employee_code) DO UPDATE SET {updates}"
                ),
                params,
            )
        db.commit()
    inserted = sum(1 for code in codes if code not in existing)
    return inserted, len(codes) - inserted


def save_employees(employees: list[dict[str, object]]) -> tuple[int, int, int]:
    """حفظ الموظفين في قاعدة البيانات (تحديث للموجود وإضافة للجديد)."""
    db, translate = open_connection()
    rows: list[tuple[object, ...]] = []
    for employee in employees:
        values = dict(employee)
        values["person_type"] = "company"
        values["active"] = 1
        rows.append(_row_tuple(values))
    inserted, updated = upsert_employees(db, translate, rows)
    db.close()
    return inserted, updated, 0


def open_connection() -> tuple[object, object]:
    """اتصال بقاعدة البيانات: PostgreSQL عند وجود DATABASE_URL وإلا SQLite المحلية."""
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        import psycopg  # noqa: PLC0415
        from psycopg.rows import dict_row  # noqa: PLC0415

        conn = psycopg.connect(url, row_factory=dict_row, sslmode="require", prepare_threshold=None)
        return conn, lambda sql: sql.replace("?", "%s")
    import sqlite3  # noqa: PLC0415

    path = Path(os.environ.get("DATABASE_PATH", str(BASE_DIR / "instance" / "laundry.db")))
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn, lambda sql: sql


def copy_from_sqlite(path: Path) -> dict[str, int]:
    """نسخ كل سجلات الموظفين من قاعدة محلية إلى قاعدة الهدف (نفس الحقول تماماً)."""
    if not path.exists():
        raise SystemExit(f"لم يُعثر على قاعدة SQLite: {path}")
    import sqlite3  # noqa: PLC0415

    source = sqlite3.connect(str(path))
    source.row_factory = sqlite3.Row
    rows = source.execute(
        f"SELECT {','.join(EMPLOYEE_COLUMNS)} FROM employees"
    ).fetchall()
    source.close()

    db, translate = open_connection()
    payload = [_row_tuple(dict(row)) for row in rows]
    inserted, updated = upsert_employees(db, translate, payload)
    db.close()
    return {"inserted": inserted, "updated": updated, "total": len(payload)}




def build_report(
    path: Path,
    sheet_name: str,
    total_rows: int,
    company: str,
    kept: int,
    skipped_company: int,
    employees: list[dict[str, object]],
    checks: dict[str, object],
    written: bool,
    inserted: int,
    updated: int,
) -> str:
    lines: list[str] = []
    lines.append("=" * 68)
    lines.append("تقرير استيراد كشف الموظفين")
    lines.append("=" * 68)
    lines.append(f"الملف            : {path.name}")
    lines.append(f"الورقة           : {sheet_name}")
    lines.append(f"صفوف الملف      : {total_rows}")
    lines.append(f"الشركة المطلوبة : {company}")
    lines.append(f"مستوفَون         : {kept} (مستبعدون: {skipped_company})")
    lines.append(f"حالة قاعدة البيانات: {'تم الحفظ' if written else 'فحص فقط (dry-run)'}")
    if written:
        lines.append(f"  مضاف حديثاً    : {inserted}")
        lines.append(f"  محدث           : {updated}")
    lines.append("")
    lines.append("توزيع نوع الخدمة:")
    for value, count in Counter(str(item["service_type"]) or "—" for item in employees).most_common():
        lines.append(f"  {value}: {count}")
    lines.append("")
    lines.append("توزيع أنظمة الدوام:")
    for value, count in Counter(str(item["shift_system"]) or "—" for item in employees).most_common():
        lines.append(f"  {value}: {count}")
    lines.append("")
    lines.append("فحص اتساق النموذج:")
    lines.append(
        f"  حالة الدوام (دوام/راحة) مطابقة : {checks['status_ok']} "
        f"(غير مطابقة: {checks['status_bad']}، حالات تشغيلية متجاهلة: {checks['status_skipped']})"
    )
    lines.append(
        f"  يوم الدورة غداً مطابق            : {checks['next_ok']} (غير مطابق: {checks['next_bad']})"
    )
    lines.append(
        f"  أنظمة ثابتة الطور                : {checks['consistent_groups']} من {checks['groups']}"
    )
    lines.append("")
    lines.append("تفاصيل أنظمة الدوام (الدورة = أيام العمل + أيام الراحة):")
    lines.append(f"  {'النظام':<44} {'عمل':>4} {'راحة':>5} {'الدورة':>6} {'اليوم':>5}  العدد")
    seen: set[tuple[str, int, int]] = set()
    for employee in employees:
        key = (str(employee["shift_system"]), int(employee["work_days"]), int(employee["rest_days"]))
        if key in seen:
            continue
        seen.add(key)
        length = int(employee["work_days"]) + int(employee["rest_days"])
        count = sum(
            1
            for item in employees
            if (str(item["shift_system"]), int(item["work_days"]), int(item["rest_days"])) == key
        )
        lines.append(
            f"  {key[0][:43]:<44} {key[1]:>4} {key[2]:>5} {length:>6} {int(employee['cycle_day']):>5}  {count}"
        )
    lines.append("=" * 68)
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="استيراد كشف الموظفين إلى قاعدة بيانات المغسلة")
    parser.add_argument("--file", default=None, help="مسار ملف Excel (الافتراضي: أول ملف xlsx في المجلد)")
    parser.add_argument("--sheet", type=int, default=0, help="رقم الورقة (يبدأ من 0)")
    parser.add_argument("--company", default=DEFAULT_COMPANY, help="الشركة المراد استيرادها")
    parser.add_argument("--reference-date", default=DEFAULT_REFERENCE_DATE, help="تاريخ مرجع الكشف YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="فحص دون تعديل قاعدة البيانات")
    parser.add_argument(
        "--copy-from-sqlite",
        default="",
        help="نسخ كشف الموظفين كاملاً من قاعدة SQLite محلية إلى قاعدة الهدف (DATABASE_URL)",
    )
    args = parser.parse_args()

    if args.copy_from_sqlite:
        result = copy_from_sqlite(Path(args.copy_from_sqlite))
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except AttributeError:
            pass
        target = os.environ.get("DATABASE_URL", "").strip()
        print("=" * 68)
        print("نسخ كشف الموظفين إلى قاعدة الهدف")
        print("=" * 68)
        print(f"  المصدر : {args.copy_from_sqlite}")
        print(f"  الهدف  : {'PostgreSQL من DATABASE_URL' if target else 'SQLite المحلية'}")
        print(f"  الإجمالي: {result['total']} موظف")
        print(f"  مضاف   : {result['inserted']}")
        print(f"  محدّث  : {result['updated']}")
        print("=" * 68)
        return 0

    reference = date.fromisoformat(args.reference_date)
    source = find_source_file(args.file)
    sheet_name, records = read_records(source, args.sheet)

    wanted = normalize(args.company)
    selected = [record for record in records if normalize(record.get("company", "")) == wanted]
    skipped_company = len(records) - len(selected)

    employees = [employee for employee in (build_employee(record, reference) for record in selected) if employee]
    checks = verify(selected, reference)

    inserted = updated = 0
    if not args.dry_run:
        inserted, updated, _ = save_employees(employees)

    report = build_report(
        source,
        sheet_name,
        len(records),
        args.company,
        len(selected),
        skipped_company,
        employees,
        checks,
        not args.dry_run,
        inserted,
        updated,
    )
    report_path = BASE_DIR / "import_report.txt"
    report_path.write_text(report, encoding="utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    print(report)
    print(f"\nتم حفظ التقرير في: {report_path}")
    return 0 if checks["status_bad"] == 0 and checks["next_bad"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
