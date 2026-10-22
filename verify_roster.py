"""مقارنة كشف الموظفين بين قاعدة البيانات المحلية (SQLite) والإنتاج (Supabase/PostgreSQL).

يتحقق من:
- عدد الموظفين والأكواد الناقصة/الزائدة/المكررة.
- تطابق جميع حقول الكشف (الاسم، الشركة، نوع الخدمة، نظام الدوام، الدورة، ...).
- تطابق حساب دورة الدوام (employee_cycle) على مدى أفق زمني.

الاستخدام:
    python verify_roster.py --target-url "<DATABASE_URL الخاص بـ Supabase>"
    python verify_roster.py --target-sqlite copy.db            # للمقارنة مع نسخة محلية
    python verify_roster.py --target-url "..." --days 60 --limit 40
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SOURCE = BASE_DIR / "instance" / "laundry.db"

FIELDS = (
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

FIELD_LABELS = {
    "employee_code": "رقم الموظف",
    "name": "الاسم",
    "company": "الشركة",
    "department": "الإدارة",
    "phone": "الجوال",
    "person_type": "نوع السجل",
    "active": "نشط",
    "notes": "ملاحظات",
    "service_type": "نوع الخدمة",
    "shift_system": "نظام الدوام",
    "shift_description": "شرح الدوام",
    "work_days": "أيام العمل",
    "rest_days": "أيام الراحة",
    "cycle_start": "بداية الدورة",
    "cycle_anchor": "مرساة الدورة",
    "cycle_day": "يوم الدورة",
    "status_label": "حالة الكشف",
    "departure_time": "وقت الخروج",
    "housing_location": "موقع السكن",
    "job_title": "المسمى الوظيفي",
    "gender": "الجنس",
    "transport_class": "فئة النقل",
}

ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")


def normalize_code(value: object) -> str:
    text = str(value or "").translate(ARABIC_DIGITS)
    return text.strip().upper().replace(" ", "").replace("-", "")


def norm_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def load_sqlite(path: Path) -> list[dict[str, object]]:
    if not path.exists():
        raise SystemExit(f"لم يُعثر على قاعدة البيانات المحلية: {path}")
    connection = sqlite3.connect(str(path))
    connection.row_factory = sqlite3.Row
    rows = connection.execute(f"SELECT {', '.join(FIELDS)} FROM employees").fetchall()
    connection.close()
    return [dict(row) for row in rows]


def load_postgres(dsn: str) -> list[dict[str, object]]:
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("حزمة psycopg غير مثبّتة. نفّذ: pip install psycopg[binary]") from exc
    with psycopg.connect(dsn, row_factory=dict_row, sslmode="require") as connection:
        cursor = connection.execute(f"SELECT {', '.join(FIELDS)} FROM employees")
        return [dict(row) for row in cursor.fetchall()]


def index_by_code(rows: list[dict[str, object]]) -> tuple[dict[str, dict[str, object]], list[str]]:
    indexed: dict[str, dict[str, object]] = {}
    duplicates: list[str] = []
    for row in rows:
        key = normalize_code(row.get("employee_code"))
        if key in indexed:
            duplicates.append(key)
        indexed[key] = row
    return indexed, duplicates


def cycle_signature(row: dict[str, object], days: int) -> dict[str, tuple[int, str]]:
    from app import employee_cycle

    start = date.today()
    signature: dict[str, tuple[int, str]] = {}
    for offset in range(days + 1):
        target = start + timedelta(days=offset)
        result = employee_cycle(row, target)
        signature[target.isoformat()] = (int(result["day"]), str(result["label"]))
    return signature


def distribution(rows: list[dict[str, object]], field: str) -> Counter[str]:
    return Counter((norm_value(row.get(field)) or "—") for row in rows)


def print_distribution(title: str, source: list[dict[str, object]], target: list[dict[str, object]], field: str) -> None:
    left = distribution(source, field)
    right = distribution(target, field)
    keys = sorted(set(left) | set(right), key=lambda key: (-left[key], key))
    print(f"\n  {title}")
    print(f"    {'القيمة':<28} {'المحلي':>7} {'الإنتاج':>7}")
    for key in keys:
        marker = "  " if left[key] == right[key] else " ≠"
        print(f"    {key[:28]:<28} {left[key]:>7} {right[key]:>7}{marker}")


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # pragma: no cover
        pass

    parser = argparse.ArgumentParser(description="مقارنة كشف الموظفين بين المحلي والإنتاج")
    parser.add_argument("--source-db", default=str(DEFAULT_SOURCE), help="مسار قاعدة SQLite المحلية")
    parser.add_argument("--target-url", default=os.environ.get("DATABASE_URL", "").strip(), help="DATABASE_URL للإنتاج (PostgreSQL)")
    parser.add_argument("--target-sqlite", default="", help="مقارنة مع قاعدة SQLite أخرى (بديل عن --target-url)")
    parser.add_argument("--days", type=int, default=45, help="عدد الأيام لفحص تطابق الدورة (افتراضي 45)")
    parser.add_argument("--limit", type=int, default=20, help="أقصى عدد فروق تفصيلية تُعرض لكل قسم")
    args = parser.parse_args()

    source_rows = load_sqlite(Path(args.source_db))
    if args.target_sqlite:
        target_rows = load_sqlite(Path(args.target_sqlite))
        target_label = args.target_sqlite
    elif args.target_url:
        target_rows = load_postgres(args.target_url)
        target_label = "PostgreSQL/الإنتاج"
    else:
        raise SystemExit("مرّر --target-url (DATABASE_URL) أو --target-sqlite.")

    print("=" * 68)
    print("مقارنة كشف الموظفين: المحلي مقابل الإنتاج")
    print("=" * 68)
    print(f"  المحلي : {args.source_db} ({len(source_rows)} موظف)")
    print(f"  الإنتاج: {target_label} ({len(target_rows)} موظف)")

    source_index, source_dupes = index_by_code(source_rows)
    target_index, target_dupes = index_by_code(target_rows)
    source_active = sum(1 for row in source_rows if norm_value(row.get("active")) == "1")
    target_active = sum(1 for row in target_rows if norm_value(row.get("active")) == "1")
    print(f"  النشطون: المحلي {source_active} / الإنتاج {target_active}")

    problems = 0

    missing = sorted(set(source_index) - set(target_index))
    extra = sorted(set(target_index) - set(source_index))
    print("\n[1] الأكواد")
    if not missing and not extra and not source_dupes and not target_dupes:
        print("    متطابقة تماماً.")
    else:
        problems += 1
        print(f"    ناقصة في الإنتاج: {len(missing)}")
        for code in missing[: args.limit]:
            print(f"      - {code} :: {source_index[code].get('name')}")
        if len(missing) > args.limit:
            print(f"      ... و{len(missing) - args.limit} أخرى")
        print(f"    زائدة في الإنتاج: {len(extra)}")
        for code in extra[: args.limit]:
            print(f"      + {code} :: {target_index[code].get('name')}")
        if len(extra) > args.limit:
            print(f"      ... و{len(extra) - args.limit} أخرى")
        if source_dupes:
            print(f"    أكواد مكررة محلياً ({len(source_dupes)}): {', '.join(source_dupes[: args.limit])}")
        if target_dupes:
            print(f"    أكواد مكررة في الإنتاج ({len(target_dupes)}): {', '.join(target_dupes[: args.limit])}")

    print("\n[2] فروق الحقول")
    field_diff_counts: Counter[str] = Counter()
    detailed: list[str] = []
    for code in sorted(set(source_index) & set(target_index)):
        source_row = source_index[code]
        target_row = target_index[code]
        diffs = [
            field
            for field in FIELDS
            if norm_value(source_row.get(field)) != norm_value(target_row.get(field))
        ]
        if not diffs:
            continue
        field_diff_counts.update(diffs)
        if len(detailed) < args.limit:
            rendered = ", ".join(
                f"{FIELD_LABELS.get(field, field)}: «{norm_value(source_row.get(field))}» ≠ «{norm_value(target_row.get(field))}»"
                for field in diffs
            )
            detailed.append(f"      {code} ({source_row.get('name')}): {rendered}")
    if not field_diff_counts:
        print("    لا فروق.")
    else:
        problems += 1
        for line in detailed:
            print(line)
        remaining = sum(field_diff_counts.values()) - sum(
            len([field for field in FIELDS if norm_value(source_index[code].get(field)) != norm_value(target_index[code].get(field))])
            for code in sorted(set(source_index) & set(target_index))[: args.limit]
        )
        if remaining > 0:
            print(f"      ... وفروق أخرى في {remaining} حقل")
        print("    ملخص الحقول المختلفة:")
        for field, count in field_diff_counts.most_common():
            print(f"      {FIELD_LABELS.get(field, field):<18} {count}")

    print(f"\n[3] تطابق دورة الدوام (اليوم وما بعده حتى {args.days} يوماً)")
    cycle_issues: list[str] = []
    for code in sorted(set(source_index) & set(target_index)):
        source_cycle = cycle_signature(source_index[code], args.days)
        target_cycle = cycle_signature(target_index[code], args.days)
        mismatched = [day for day in source_cycle if source_cycle[day] != target_cycle[day]]
        if not mismatched:
            continue
        first = mismatched[0]
        cycle_issues.append(
            f"      {code} ({source_index[code].get('name')}): {len(mismatched)} يوماً مختلفاً، "
            f"أولها {first}: المحلي {source_cycle[first][0]}/{source_cycle[first][1] or '—'} ≠ "
            f"الإنتاج {target_cycle[first][0]}/{target_cycle[first][1] or '—'}"
        )
    if not cycle_issues:
        print("    متطابقة على كامل الأفق.")
    else:
        problems += 1
        for line in cycle_issues[: args.limit]:
            print(line)
        if len(cycle_issues) > args.limit:
            print(f"      ... و{len(cycle_issues) - args.limit} موظفاً آخر")

    print("\n[4] التوزيعات")
    print_distribution("نوع الخدمة", source_rows, target_rows, "service_type")
    print_distribution("نظام الدوام", source_rows, target_rows, "shift_system")

    print("\n" + "=" * 68)
    if problems:
        print("النتيجة: توجد فروق بين المحلي والإنتاج (راجع الأقسام أعلاه).")
        print("لإصلاح الكشف: نفّذ استيراد الكشف على قاعدة الإنتاج بنفس الملف:")
        print("  $env:DATABASE_URL=\"<Supabase URL>\"; python import_employees.py")
        print("=" * 68)
        return 1
    print("النتيجة: الكشف متطابق تماماً (الأكواد والحقول ودورات الدوام).")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
