"""تصدير تقارير المغسلة إلى PDF (عربي مُشكَّل) و Excel (xlsx).

يُستخدم من تطبيق الويب (app.py) وواجهة الجوال (mobile_api.py) بنفس المخرجات.
PDF يُبنى بخط IBM Plex Sans Arabic المرفق مع التطبيق، مع تشكيل الحروف العربية
وترتيب ثنائي الاتجاه قبل الرسم لضمان ظهور النص موصولاً ومرتباً.
"""

from __future__ import annotations

import io
from datetime import date, datetime
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
FONT_DIR = BASE_DIR / "laundry_mobile_project" / "assets" / "fonts"
FONT_REGULAR = FONT_DIR / "IBMPlexSansArabic-Regular.ttf"
FONT_BOLD = FONT_DIR / "IBMPlexSansArabic-Bold.ttf"

STATUS_LABELS = {
    "pending": "بانتظار التأكيد",
    "approved": "معتمد",
    "rejected": "مرفوض",
    "all": "الكل",
}

FULFILLMENT_LABELS = {"received": "لم يُسلَّم", "delivered": "تم التسليم"}

FULFILLMENT_FILTER_LABELS = {
    "all": "الكل",
    "received": "لم يُسلَّم",
    "delivered": "تم التسليم",
    "partial": "مستلم جزئياً",
}


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _money(value: Any) -> str:
    try:
        return f"{float(value or 0):,.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _quantity(value: Any) -> str:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return "0"
    return str(int(number)) if number == int(number) else f"{number:g}"


def _quantity_opt(value: Any) -> str:
    """كمية اختيارية: فراغ عند عدم تسجيل استلام بعد."""
    if value is None or value == "":
        return ""
    return _quantity(value)


def _num(value: Any, default: Any = "") -> Any:
    """تحويل قيمة رقمية للاستخدام في Excel مع إبقاء الفراغ كما هو."""
    if value is None or value == "":
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    return int(number) if number == int(number) else number


def _shape(value: Any) -> str:
    text = _text(value)
    if not text:
        return ""
    try:
        import arabic_reshaper
        from bidi.algorithm import get_display

        return get_display(arabic_reshaper.reshape(text))
    except Exception:
        return text


def _collect(payload: dict[str, Any]) -> dict[str, Any]:
    orders = payload.get("orders") or []
    items_by_order = payload.get("items_by_order") or {}
    lines: list[dict[str, Any]] = []
    for order in orders:
        for item in items_by_order.get(int(order["id"]), []):
            quantity = float(item.get("quantity") or 0)
            received_raw = item.get("received_quantity")
            received = float(received_raw) if received_raw not in (None, "") else None
            remaining = max(quantity - (received or 0.0), 0.0) if received is not None else quantity
            lines.append(
                {
                    "reference": order.get("reference") or "",
                    "date": order.get("service_date") or "",
                    "employee_code": order.get("employee_code") or "",
                    "employee_name": order.get("person_name") or order.get("employee_name") or "",
                    "service_type": order.get("service_type") or "",
                    "item_name": item.get("item_name") or "",
                    "quantity": _quantity(item.get("quantity")),
                    "received_quantity": _quantity_opt(received_raw),
                    "remaining": _quantity_opt(remaining),
                    "unit": item.get("unit") or "",
                    "unit_price": _money(item.get("unit_price")),
                    "line_total": _money(item.get("line_total")),
                    "status": STATUS_LABELS.get(order.get("status") or "", order.get("status") or ""),
                    "fulfillment": FULFILLMENT_LABELS.get(
                        order.get("fulfillment_status") or "", order.get("fulfillment_status") or ""
                    ),
                    "receiver": order.get("receiver_name") or "",
                    "received_at": _text(order.get("received_at")),
                    "notes": order.get("notes") or "",
                    "creator": order.get("creator_name") or "",
                    "confirmer": order.get("confirmer_name") or "",
                }
            )
    return {"lines": lines, "orders_count": len(orders)}


def _totals_lines(payload: dict[str, Any]) -> list[tuple[str, str]]:
    totals = payload.get("totals") or {}
    currency = payload.get("currency") or ""
    return [
        ("إجمالي المعتمد", f"{_money(totals.get('approved'))} {currency}"),
        ("إجمالي المعلّق", f"{_money(totals.get('pending'))} {currency}"),
        ("إجمالي المرفوض", f"{_money(totals.get('rejected'))} {currency}"),
    ]


def _meta(payload: dict[str, Any]) -> list[tuple[str, str]]:
    return [
        ("الشركة", payload.get("company_name") or ""),
        ("من تاريخ", payload.get("start") or "—"),
        ("إلى تاريخ", payload.get("end") or "—"),
        ("حالة الطلبات", STATUS_LABELS.get(payload.get("status") or "", payload.get("status") or "")),
        (
            "حالة التسليم",
            FULFILLMENT_FILTER_LABELS.get(
                payload.get("fulfillment") or "all", payload.get("fulfillment") or ""
            ),
        ),
        ("تاريخ التصدير", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]


# ---------------------------------------------------------------------------
# Excel
# ---------------------------------------------------------------------------


def build_xlsx(payload: dict[str, Any]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    collected = _collect(payload)
    orders = payload.get("orders") or []
    summary = payload.get("summary") or {"columns": [], "rows": []}
    service_summary = payload.get("service_summary") or {"columns": [], "rows": []}

    wb = Workbook()
    header_fill = PatternFill("solid", fgColor="123B35")
    header_font = Font(name="Arial", bold=True, color="FFFFFF", size=11)
    title_font = Font(name="Arial", bold=True, size=14, color="123B35")
    thin = Side(style="thin", color="C9D6D3")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    right = Alignment(horizontal="right", vertical="center", wrap_text=True)

    def style_row(ws, row_index: int, columns: int, align: Alignment = right) -> None:
        for column in range(1, columns + 1):
            cell = ws.cell(row=row_index, column=column)
            cell.border = border
            cell.alignment = align

    def write_title(ws, title: str, columns: int) -> int:
        ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=columns)
        cell = ws.cell(row=1, column=1, value=title)
        cell.font = title_font
        cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.sheet_view.rightToLeft = True
        return 3

    orders_sheet = wb.active
    orders_sheet.title = "الطلبات"
    headers = [
        "رقم الطلب",
        "التاريخ",
        "رقم الموظف",
        "الاسم",
        "نوع الخدمة",
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
        "المعتمد",
        "ملاحظات",
    ]
    start_row = write_title(orders_sheet, f"{payload.get('company_name') or ''} — تقرير خدمات المغسلة", len(headers))
    orders_sheet.cell(row=2, column=1, value="; ".join(f"{key}: {value}" for key, value in _meta(payload)))
    orders_sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(headers))
    orders_sheet.cell(row=2, column=1).alignment = right
    for index, header in enumerate(headers, start=1):
        cell = orders_sheet.cell(row=start_row, column=index, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = border
    row_index = start_row
    for line in collected["lines"]:
        row_index += 1
        values = [
            line["reference"],
            line["date"],
            line["employee_code"],
            line["employee_name"],
            line["service_type"],
            line["item_name"],
            _num(line["quantity"], 0),
            _num(line["received_quantity"]),
            _num(line["remaining"]),
            line["unit"],
            float(line["unit_price"].replace(",", "")),
            float(line["line_total"].replace(",", "")),
            line["status"],
            line["fulfillment"],
            line["receiver"],
            line["received_at"],
            line["creator"],
            line["confirmer"],
            line["notes"],
        ]
        for index, value in enumerate(values, start=1):
            orders_sheet.cell(row=row_index, column=index, value=value)
        style_row(orders_sheet, row_index, len(headers))
        for column in (7, 8, 9):
            orders_sheet.cell(row=row_index, column=column).alignment = center
        for column in (11, 12):
            orders_sheet.cell(row=row_index, column=column).number_format = "#,##0.00"
    widths = [15, 12, 12, 24, 12, 20, 9, 9, 9, 8, 12, 12, 14, 12, 20, 18, 16, 16, 24]
    for index, width in enumerate(widths, start=1):
        orders_sheet.column_dimensions[get_column_letter(index)].width = width
    orders_sheet.freeze_panes = orders_sheet.cell(row=start_row + 1, column=1)
    orders_sheet.auto_filter.ref = f"A{start_row}:{get_column_letter(len(headers))}{max(row_index, start_row)}"

    totals_row = row_index + 2
    orders_sheet.cell(row=totals_row, column=1, value="الإجماليات").font = title_font
    for offset, (label, value) in enumerate(_totals_lines(payload), start=1):
        orders_sheet.cell(row=totals_row + offset, column=1, value=label).font = Font(bold=True)
        orders_sheet.cell(row=totals_row + offset, column=2, value=value)

    def summary_sheet(name: str, data: dict[str, Any], label_header: str) -> None:
        ws = wb.create_sheet(name)
        columns = data.get("columns") or []
        rows = data.get("rows") or []
        headers2 = [label_header, "نوع الخدمة"] + columns + ["إجمالي الكمية"]
        title_row = write_title(ws, f"{payload.get('company_name') or ''} — {name}", len(headers2))
        for index, header in enumerate(headers2, start=1):
            cell = ws.cell(row=title_row, column=index, value=header)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = center
            cell.border = border
        current = title_row
        for entry in rows:
            current += 1
            values = [entry.get("employee_name") or entry.get("label") or "", entry.get("service_type") or ""]
            values += [entry["quantities"].get(item, 0) or "" for item in columns]
            values.append(entry.get("total") or 0)
            for index, value in enumerate(values, start=1):
                ws.cell(row=current, column=index, value=value)
            style_row(ws, current, len(headers2))
        ws.column_dimensions["A"].width = 26
        ws.column_dimensions["B"].width = 14
        for index in range(3, len(headers2) + 1):
            ws.column_dimensions[get_column_letter(index)].width = 12
        ws.freeze_panes = ws.cell(row=title_row + 1, column=1)

    summary_sheet("ملخص الموظفين", summary, "الموظف")
    summary_sheet("ملخص أنواع الخدمة", service_summary, "نوع الخدمة")

    orders_meta = wb.create_sheet("بيانات التقرير")
    orders_meta.sheet_view.rightToLeft = True
    orders_meta.column_dimensions["A"].width = 24
    orders_meta.column_dimensions["B"].width = 40
    for index, (label, value) in enumerate(_meta(payload) + _totals_lines(payload), start=1):
        orders_meta.cell(row=index, column=1, value=label).font = Font(bold=True)
        orders_meta.cell(row=index, column=2, value=value).alignment = right
    orders_meta.cell(row=1, column=4, value=f"عدد الطلبات: {len(orders)}")

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def build_pdf(payload: dict[str, Any]) -> bytes:
    from fpdf import FPDF

    collected = _collect(payload)
    summary = payload.get("summary") or {"columns": [], "rows": []}
    service_summary = payload.get("service_summary") or {"columns": [], "rows": []}

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_font("Plex", "", str(FONT_REGULAR))
    if FONT_BOLD.exists():
        pdf.add_font("Plex", "B", str(FONT_BOLD))
    pdf.set_title("laundry-report")
    pdf.add_page()
    page_width = pdf.w - pdf.l_margin - pdf.r_margin

    def write_line(text: str, size: int = 10, bold: bool = False, height: float = 7) -> None:
        pdf.set_font("Plex", "B" if bold else "", size)
        pdf.cell(page_width, height, _shape(text), new_x="LMARGIN", new_y="NEXT", align="R")

    def table(headers: list[str], rows: list[list[str]], widths: list[float]) -> None:
        def draw_row(values: list[str], header: bool = False, fill: bool = False) -> None:
            pdf.set_font("Plex", "B" if header else "", 7.5)
            if fill:
                pdf.set_fill_color(238, 244, 242)
            y = pdf.get_y()
            x = pdf.w - pdf.r_margin
            if y + 6.5 > pdf.h - pdf.b_margin:
                pdf.add_page()
                y = pdf.get_y()
            for value, width in zip(values, widths):
                x -= width
                pdf.set_xy(x, y)
                pdf.cell(width, 6.5, _shape(value), border=1, align="C", fill=fill)
            pdf.set_xy(pdf.l_margin, y + 6.5)

        draw_row(headers, header=True, fill=True)
        for row in rows:
            draw_row(row)

    pdf.set_text_color(18, 59, 53)
    write_line(f"{payload.get('company_name') or ''}", 15, bold=True, height=9)
    pdf.set_text_color(30, 30, 30)
    write_line("تقرير خدمات المغسلة والمستحقات", 11, bold=True)
    write_line("; ".join(f"{key}: {value}" for key, value in _meta(payload)), 8)
    pdf.ln(1)
    for label, value in _totals_lines(payload):
        write_line(f"{label}: {value}", 9, bold=True, height=6)
    pdf.ln(2)

    write_line("تفاصيل الطلبات", 11, bold=True)
    headers = [
        "رقم الطلب",
        "التاريخ",
        "رقم الموظف",
        "الاسم",
        "الصنف",
        "الكمية",
        "المستلم",
        "المتبقي",
        "الوحدة",
        "سعر الوحدة",
        "الإجمالي",
        "الحالة",
        "مستلم الأصناف",
    ]
    widths = [22, 18, 16, 40, 44, 12, 12, 12, 14, 18, 22, 26, 32]
    scale = min(1.0, page_width / sum(widths))
    widths = [width * scale for width in widths]
    rows = [
        [
            line["reference"],
            line["date"],
            line["employee_code"],
            line["employee_name"],
            line["item_name"],
            line["quantity"],
            line["received_quantity"] or "—",
            line["remaining"] or "—",
            line["unit"],
            line["unit_price"],
            line["line_total"],
            line["status"],
            line["receiver"] or "—",
        ]
        for line in collected["lines"]
    ]
    table(headers, rows or [["لا توجد بيانات"] + [""] * (len(headers) - 1)], widths)

    pdf.ln(4)
    write_line("ملخص كميات الغسيل لكل موظف", 11, bold=True)
    columns = (summary.get("columns") or [])[:7]
    summary_headers = ["الموظف", "نوع الخدمة"] + columns + ["الإجمالي"]
    summary_widths = [46, 22] + [(page_width - 46 - 22 - 22) / max(len(columns), 1)] * len(columns) + [22]
    summary_rows = [
        [entry.get("employee_name") or entry.get("label") or "", entry.get("service_type") or ""]
        + [_quantity(entry["quantities"].get(item, 0)) if entry["quantities"].get(item) else "" for item in columns]
        + [_quantity(entry.get("total"))]
        for entry in (summary.get("rows") or [])
    ]
    table(summary_headers, summary_rows or [["لا توجد بيانات", "", *([""] * len(columns)), ""]], summary_widths)

    pdf.ln(4)
    write_line("إجمالي الكميات حسب نوع الخدمة", 11, bold=True)
    service_headers = ["نوع الخدمة"] + columns + ["الإجمالي"]
    service_widths = [30] + [(page_width - 30 - 22) / max(len(columns), 1)] * len(columns) + [22]
    service_rows = [
        [entry.get("label") or entry.get("employee_name") or ""]
        + [_quantity(entry["quantities"].get(item, 0)) if entry["quantities"].get(item) else "" for item in columns]
        + [_quantity(entry.get("total"))]
        for entry in (service_summary.get("rows") or [])
    ]
    table(service_headers, service_rows or [["لا توجد بيانات", *([""] * len(columns)), ""]], service_widths)

    pdf.ln(3)
    pdf.set_font("Plex", "", 8)
    pdf.cell(page_width, 6, _shape("نظام مغسلة الشركة — تقرير آلي"), align="C")
    output = pdf.output()
    return bytes(output)


# ---------------------------------------------------------------------------
# تقرير غسيل سكن الموظفين
# ---------------------------------------------------------------------------


def _housing_meta(payload: dict[str, Any]) -> list[tuple[str, str]]:
    summary = payload.get("summary") or {}
    return [
        ("الشركة", payload.get("company_name") or ""),
        ("من تاريخ", payload.get("start") or "—"),
        ("إلى تاريخ", payload.get("end") or "—"),
        ("عدد أيام الفترة", str(payload.get("period_days") or 0)),
        ("عدد الموظفين", str(summary.get("employees_total") or 0)),
        ("المتواجدون بالسكن", str(summary.get("housing_total") or 0)),
        ("بدون أي غسيل", str(summary.get("no_laundry") or 0)),
        ("متوسط التغطية", f"{summary.get('avg_percentage') or 0}%"),
        ("تاريخ التصدير", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]


HOUSING_HEADERS = [
    "رقم الموظف",
    "الاسم",
    "القسم",
    "الوظيفة",
    "السكن",
    "نوع الخدمة",
    "نظام الدوام",
    "دورة الاستحقاق",
    "الدورات",
    "ملاية (مسلّمة)",
    "ملاية (مستهدفة)",
    "مخدة (مسلّمة)",
    "مخدة (مستهدفة)",
    "بطانيات",
    "التغطية %",
    "الحالة",
    "النواقص",
]


def _housing_rows(payload: dict[str, Any]) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in payload.get("rows") or []:
        rows.append(
            [
                _text(row.get("employee_code")),
                _text(row.get("employee_name")),
                _text(row.get("department")),
                _text(row.get("job_title")),
                _text(row.get("housing_location")),
                _text(row.get("service_type")),
                _text(row.get("shift_label")),
                _text(row.get("effective_cycle_days")),
                _text(row.get("cycles")),
                _quantity(row.get("sheets")),
                _text(row.get("target_sheets")),
                _quantity(row.get("pillows")),
                _text(row.get("target_pillows")),
                _quantity(row.get("blankets")),
                _text(row.get("percentage")),
                _text(row.get("coverage_status")),
                "، ".join(row.get("missing") or []),
            ]
        )
    return rows


def build_housing_xlsx(payload: dict[str, Any]) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    summary = payload.get("summary") or {}
    rows = _housing_rows(payload)

    wb = Workbook()
    header_fill = PatternFill("solid", fgColor="123B35")
    header_font = Font(name="Arial", bold=True, color="FFFFFF", size=11)
    title_font = Font(name="Arial", bold=True, size=14, color="123B35")
    thin = Side(style="thin", color="C9D6D3")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    right = Alignment(horizontal="right", vertical="center", wrap_text=True)

    sheet = wb.active
    sheet.title = "تقرير سكن الموظفين"
    sheet.sheet_view.rightToLeft = True
    columns = len(HOUSING_HEADERS)
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=columns)
    title = sheet.cell(
        row=1,
        column=1,
        value=f"{payload.get('company_name') or ''} — تقرير غسيل سكن الموظفين",
    )
    title.font = title_font
    title.alignment = center
    meta = "; ".join(f"{key}: {value}" for key, value in _housing_meta(payload))
    sheet.merge_cells(start_row=2, start_column=1, end_row=2, end_column=columns)
    sheet.cell(row=2, column=1, value=meta).alignment = right
    sheet.merge_cells(start_row=3, start_column=1, end_row=3, end_column=columns)
    sheet.cell(row=3, column=1, value=payload.get("note") or "").alignment = right

    header_row = 5
    for index, header in enumerate(HOUSING_HEADERS, start=1):
        cell = sheet.cell(row=header_row, column=index, value=header)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center
        cell.border = border

    current = header_row
    for values in rows:
        current += 1
        for index, value in enumerate(values, start=1):
            sheet.cell(row=current, column=index, value=value)
            cell = sheet.cell(row=current, column=index)
            cell.border = border
            cell.alignment = center if index in (1, 8, 9, 10, 11, 12, 13, 14, 15, 16) else right
    widths = [12, 26, 14, 18, 14, 12, 16, 14, 8, 12, 12, 12, 12, 10, 10, 12, 20]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = sheet.cell(row=header_row + 1, column=1)
    sheet.auto_filter.ref = (
        f"A{header_row}:{get_column_letter(columns)}{max(current, header_row)}"
    )

    totals_row = current + 2
    sheet.cell(row=totals_row, column=1, value="الإجماليات").font = title_font
    totals = [
        ("مكتمل", summary.get("complete")),
        ("جزئي", summary.get("partial")),
        ("بدون غسيل", summary.get("none")),
        ("ملاية مسلّمة", summary.get("total_sheets")),
        ("مخدة مسلّمة", summary.get("total_pillows")),
        ("بطانيات مسلّمة", summary.get("total_blankets")),
        ("متوسط التغطية %", summary.get("avg_percentage")),
    ]
    for offset, (label, value) in enumerate(totals, start=1):
        sheet.cell(row=totals_row + offset, column=1, value=label).font = Font(bold=True)
        sheet.cell(row=totals_row + offset, column=2, value=value)

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def build_housing_pdf(payload: dict[str, Any]) -> bytes:
    from fpdf import FPDF

    rows = _housing_rows(payload)
    summary = payload.get("summary") or {}

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_font("Plex", "", str(FONT_REGULAR))
    if FONT_BOLD.exists():
        pdf.add_font("Plex", "B", str(FONT_BOLD))
    pdf.set_title("housing-report")
    pdf.add_page()
    page_width = pdf.w - pdf.l_margin - pdf.r_margin

    def write_line(text: str, size: int = 10, bold: bool = False, height: float = 7) -> None:
        pdf.set_font("Plex", "B" if bold else "", size)
        pdf.cell(page_width, height, _shape(text), new_x="LMARGIN", new_y="NEXT", align="R")

    def table(headers: list[str], data_rows: list[list[str]], widths: list[float]) -> None:
        def draw_row(values: list[str], header: bool = False, fill: bool = False) -> None:
            pdf.set_font("Plex", "B" if header else "", 7)
            if fill:
                pdf.set_fill_color(238, 244, 242)
            y = pdf.get_y()
            x = pdf.w - pdf.r_margin
            if y + 6 > pdf.h - pdf.b_margin:
                pdf.add_page()
                y = pdf.get_y()
            for value, width in zip(values, widths):
                x -= width
                pdf.set_xy(x, y)
                pdf.cell(width, 6, _shape(value), border=1, align="C", fill=fill)
            pdf.set_xy(pdf.l_margin, y + 6)

        draw_row(headers, header=True, fill=True)
        for row in data_rows:
            draw_row(row)

    pdf.set_text_color(18, 59, 53)
    write_line(f"{payload.get('company_name') or ''}", 15, bold=True, height=9)
    pdf.set_text_color(30, 30, 30)
    write_line("تقرير غسيل سكن الموظفين", 11, bold=True)
    write_line("; ".join(f"{key}: {value}" for key, value in _housing_meta(payload)), 8)
    pdf.set_font("Plex", "", 8)
    pdf.multi_cell(page_width, 5, _shape(payload.get("note") or ""), align="R")
    pdf.ln(2)
    write_line(
        "الإجماليات: "
        f"مكتمل {summary.get('complete') or 0} · جزئي {summary.get('partial') or 0} · "
        f"بدون غسيل {summary.get('none') or 0} · "
        f"ملاية {_quantity(summary.get('total_sheets'))} · "
        f"مخدة {_quantity(summary.get('total_pillows'))} · "
        f"بطانية {_quantity(summary.get('total_blankets'))} · "
        f"متوسط التغطية {summary.get('avg_percentage') or 0}%",
        9,
        bold=True,
        height=6,
    )
    pdf.ln(1)

    headers = [
        "الموظف",
        "القسم",
        "السكن",
        "نظام الدوام",
        "الدورات",
        "ملاية مسلّمة/مستهدفة",
        "مخدة مسلّمة/مستهدفة",
        "بطانيات",
        "التغطية",
        "الحالة",
    ]
    widths = [50, 32, 28, 30, 18, 40, 40, 20, 20, 92]
    scale = min(1.0, page_width / sum(widths))
    widths = [width * scale for width in widths]
    data_rows = [
        [
            f"{row[0]} — {row[1]}",
            row[2],
            row[4],
            row[6],
            row[8],
            f"{row[9]} / {row[10]}",
            f"{row[11]} / {row[12]}",
            row[13],
            f"{row[14]}%",
            row[15],
        ]
        for row in rows
    ]
    table(headers, data_rows or [["لا توجد بيانات"] + [""] * 9], widths)

    pdf.ln(3)
    pdf.set_font("Plex", "", 8)
    pdf.cell(page_width, 6, _shape("نظام مغسلة الشركة — تقرير آلي"), align="C")
    return bytes(pdf.output())


# ---------------------------------------------------------------------------
# تصدير عام لأي جدول (يُستخدم في واجهات السجلات والقوائم)
# ---------------------------------------------------------------------------


def _cell_value(value: Any) -> Any:
    """تحويل قيمة خلية للاستخدام في Excel: أرقام تبقى أرقاماً والنصوص كما هي."""
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return _text(value)


def build_housing_csv(payload: dict[str, Any]) -> bytes:
    """تصدير تقرير سكن الموظفين إلى CSV بترميز UTF-8 مع BOM."""
    import csv

    summary = payload.get("summary") or {}
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(HOUSING_HEADERS)
    for row in _housing_rows(payload):
        writer.writerow(row)
    writer.writerow([])
    writer.writerow(["الإجماليات"])
    writer.writerow(["مكتمل", summary.get("complete") or 0])
    writer.writerow(["جزئي", summary.get("partial") or 0])
    writer.writerow(["بدون غسيل", summary.get("none") or 0])
    writer.writerow(["ملاية مسلّمة", summary.get("total_sheets") or 0])
    writer.writerow(["مخدة مسلّمة", summary.get("total_pillows") or 0])
    writer.writerow(["بطانيات مسلّمة", summary.get("total_blankets") or 0])
    writer.writerow(["متوسط التغطية %", summary.get("avg_percentage") or 0])
    return buffer.getvalue().encode("utf-8-sig")


def build_table_xlsx(
    title: str,
    headers: list[str],
    rows: list[list[Any]],
    sheet_name: str = "البيانات",
    meta: list[tuple[str, str]] | None = None,
    widths: list[float] | None = None,
) -> bytes:
    """تصدير جدول عام إلى Excel مع عنوان وبيانات وصفية وتنسيق عربي RTL."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    ws = wb.active
    ws.title = (sheet_name or "البيانات")[:31]
    ws.sheet_view.rightToLeft = True

    header_fill = PatternFill("solid", fgColor="123B35")
    header_font = Font(name="Arial", bold=True, color="FFFFFF", size=11)
    title_font = Font(name="Arial", bold=True, size=14, color="123B35")
    thin = Side(style="thin", color="C9D6D3")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    right = Alignment(horizontal="right", vertical="center", wrap_text=True)

    columns = max(len(headers), 1)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=columns)
    cell = ws.cell(row=1, column=1, value=title)
    cell.font = title_font
    cell.alignment = Alignment(horizontal="center", vertical="center")

    meta_rows = list(meta or [])
    if meta_rows:
        meta_text = "; ".join(f"{key}: {value}" for key, value in meta_rows)
        ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=columns)
        ws.cell(row=2, column=1, value=meta_text).alignment = right

    header_row = 4 if meta_rows else 3
    for index, header in enumerate(headers, start=1):
        head = ws.cell(row=header_row, column=index, value=header)
        head.fill = header_fill
        head.font = header_font
        head.alignment = center
        head.border = border

    current = header_row
    for row in rows:
        current += 1
        for index, value in enumerate(row[: len(headers)], start=1):
            cell = ws.cell(row=current, column=index, value=_cell_value(value))
            cell.border = border
            cell.alignment = center if isinstance(value, (int, float)) else right

    if widths:
        for index, width in enumerate(widths[: len(headers)], start=1):
            ws.column_dimensions[get_column_letter(index)].width = width
    else:
        for index in range(1, len(headers) + 1):
            ws.column_dimensions[get_column_letter(index)].width = 18

    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    ws.auto_filter.ref = f"A{header_row}:{get_column_letter(columns)}{max(current, header_row)}"

    if not rows:
        ws.cell(row=header_row + 1, column=1, value="لا توجد بيانات").alignment = center

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def build_table_pdf(
    title: str,
    headers: list[str],
    rows: list[list[Any]],
    subtitle: str = "",
    widths: list[float] | None = None,
    footer: str = "نظام مغسلة الشركة — تصدير آلي",
) -> bytes:
    """تصدير جدول عام إلى PDF عربي مُشكَّل مع ترقيم صفحات وضبط تلقائي للعرض."""
    from fpdf import FPDF

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_font("Plex", "", str(FONT_REGULAR))
    if FONT_BOLD.exists():
        pdf.add_font("Plex", "B", str(FONT_BOLD))
    pdf.set_title(title[:80] or "table-export")
    pdf.add_page()
    page_width = pdf.w - pdf.l_margin - pdf.r_margin

    def write_line(text: str, size: int = 10, bold: bool = False, height: float = 7) -> None:
        pdf.set_font("Plex", "B" if bold else "", size)
        pdf.cell(page_width, height, _shape(text), new_x="LMARGIN", new_y="NEXT", align="R")

    column_widths = list(widths or [])
    if len(column_widths) != len(headers) or not column_widths:
        column_widths = [max(12, page_width / max(len(headers), 1))] * len(headers)
    scale = min(1.0, page_width / sum(column_widths)) if sum(column_widths) else 1.0
    column_widths = [width * scale for width in column_widths]
    font_size = 8 if len(headers) <= 8 else 7

    def draw_row(values: list[str], header: bool = False, fill: bool = False) -> None:
        pdf.set_font("Plex", "B" if header else "", font_size)
        if fill:
            pdf.set_fill_color(238, 244, 242)
        y = pdf.get_y()
        row_height = 6.5
        if y + row_height > pdf.h - pdf.b_margin:
            pdf.add_page()
            y = pdf.get_y()
        x = pdf.w - pdf.r_margin
        for value, width in zip(values, column_widths):
            x -= width
            pdf.set_xy(x, y)
            pdf.cell(width, row_height, _shape(value), border=1, align="C", fill=fill)
        pdf.set_xy(pdf.l_margin, y + row_height)

    pdf.set_text_color(18, 59, 53)
    write_line(title, 14, bold=True, height=9)
    pdf.set_text_color(30, 30, 30)
    if subtitle:
        write_line(subtitle, 8)
    pdf.ln(2)

    draw_row(headers, header=True, fill=True)
    if rows:
        for row in rows:
            draw_row([_text(value) for value in row[: len(headers)]])
    else:
        draw_row(["لا توجد بيانات"] + [""] * (len(headers) - 1))

    pdf.ln(3)
    pdf.set_font("Plex", "", 8)
    pdf.cell(page_width, 6, _shape(footer), align="C")
    return bytes(pdf.output())


def build_table_csv(headers: list[str], rows: list[list[Any]]) -> bytes:
    """تصدير جدول إلى CSV بترميز UTF-8 مع BOM ليفتح صحيحاً في Excel العربي."""
    import csv

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(headers)
    for row in rows:
        writer.writerow([_text(value) for value in row[: len(headers)]])
    return buffer.getvalue().encode("utf-8-sig")
