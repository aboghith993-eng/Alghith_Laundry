"""قراءة ملفات Excel (xlsx) بدون أي مكتبات خارجية.

الملف xlsx عبارة عن أرشيف ZIP يحتوي على XML، لذلك يمكن قراءته عبر
zipfile و xml.etree من مكتبة بايثون القياسية. الغرض: تشغيل سكربت استيراد
الموظفين دون إضافة اعتماديات جديدة للتطبيق.

استخدام:
    from xlsx_reader import read_workbook

    sheets = read_workbook("كشف الموظفين.xlsx")
    for name, rows in sheets:
        print(name, len(rows))
"""
from __future__ import annotations

import re
import zipfile
from datetime import date, datetime, time, timedelta
from xml.etree import ElementTree

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

#: نقطة الصفر لنظام Excel التسلسلي (تُستخدم مع قاعدة 1899-12-30).
EXCEL_EPOCH = datetime(1899, 12, 30)

_CELL_RE = re.compile(r"^([A-Z]+)")


def _tag(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}"


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        payload = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ElementTree.fromstring(payload)
    values: list[str] = []
    for item in root.findall(_tag(MAIN_NS, "si")):
        values.append("".join(node.text or "" for node in item.iter(_tag(MAIN_NS, "t"))))
    return values


def _sheet_paths(archive: zipfile.ZipFile) -> list[tuple[str, str]]:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {rel.get("Id"): rel.get("Target") or "" for rel in rels}
    sheets: list[tuple[str, str]] = []
    node = workbook.find(_tag(MAIN_NS, "sheets"))
    for sheet in [] if node is None else node:
        target = targets.get(sheet.get(_tag(REL_NS, "id")), "")
        if target.startswith("/"):
            path = target.lstrip("/")
        else:
            path = "xl/" + target.lstrip("./")
        sheets.append((sheet.get("name") or path, path))
    return sheets


def _column_index(reference: str) -> int:
    match = _CELL_RE.match(reference or "")
    if not match:
        return 0
    index = 0
    for char in match.group(1):
        index = index * 26 + (ord(char) - 64)
    return index - 1


def _cell_value(cell: ElementTree.Element, shared: list[str]) -> str:
    kind = cell.get("t")
    if kind == "s":
        node = cell.find(_tag(MAIN_NS, "v"))
        if node is None or node.text is None:
            return ""
        try:
            return shared[int(node.text)]
        except (ValueError, IndexError):
            return ""
    if kind == "inlineStr":
        node = cell.find(_tag(MAIN_NS, "is"))
        if node is None:
            return ""
        return "".join(item.text or "" for item in node.iter(_tag(MAIN_NS, "t")))
    node = cell.find(_tag(MAIN_NS, "v"))
    if node is None or node.text is None:
        return ""
    return node.text.strip()


def _read_sheet(archive: zipfile.ZipFile, path: str, shared: list[str]) -> list[list[str]]:
    root = ElementTree.fromstring(archive.read(path))
    data = root.find(_tag(MAIN_NS, "sheetData"))
    rows: list[list[str]] = []
    for row in [] if data is None else data:
        cells: dict[int, str] = {}
        for cell in row.findall(_tag(MAIN_NS, "c")):
            index = _column_index(cell.get("r") or "")
            cells[index] = _cell_value(cell, shared)
        width = max(cells) + 1 if cells else 0
        rows.append([cells.get(index, "") for index in range(width)])
    return rows


def read_workbook(path: str) -> list[tuple[str, list[list[str]]]]:
    """إرجاع قائمة (اسم الورقة، صفوفها) لكل ورقة في الملف."""
    sheets: list[tuple[str, list[list[str]]]] = []
    with zipfile.ZipFile(path) as archive:
        shared = _shared_strings(archive)
        for name, sheet_path in _sheet_paths(archive):
            sheets.append((name, _read_sheet(archive, sheet_path, shared)))
    return sheets


def excel_serial_to_date(serial: float) -> date:
    """تحويل الرقم التسلسلي في Excel إلى تاريخ."""
    return (EXCEL_EPOCH + timedelta(days=float(serial))).date()


def excel_serial_to_time(serial: float) -> time:
    """تحويل الرقم التسلسلي في Excel (جزء اليوم) إلى وقت."""
    seconds = round(float(serial) * 86400)
    seconds %= 86400
    return time(seconds // 3600, (seconds % 3600) // 60, seconds % 60)


def parse_excel_date(value: str) -> str:
    """تحويل قيمة خلية التاريخ (نص أو رقم تسلسلي) إلى صيغة YYYY-MM-DD."""
    text = (value or "").strip()
    if not text:
        return ""
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        pass
    try:
        return excel_serial_to_date(float(text)).isoformat()
    except (TypeError, ValueError):
        return ""


def parse_excel_time(value: str) -> str:
    """تحويل قيمة خلية الوقت (نص أو رقم تسلسلي) إلى صيغة HH:MM."""
    text = (value or "").strip()
    if not text:
        return ""
    parts = text.replace("T", " ").split()
    if len(parts) > 1:
        text = parts[1]
    try:
        parsed = time.fromisoformat(text)
        return parsed.strftime("%H:%M")
    except ValueError:
        pass
    try:
        return excel_serial_to_time(float(text)).strftime("%H:%M")
    except (TypeError, ValueError):
        return ""
