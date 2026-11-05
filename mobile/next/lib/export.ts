/* أدوات التصدير لتطبيق المغسلة (Excel / CSV / PDF طباعة) — بنفس آلية تطبيق السكن.
   في تطبيق الأندرويد يُستخدم الجسر الأصلي window.LaundryApp. */

declare global {
  interface Window {
    LaundryApp?: {
      printHtml?: (name: string, html: string) => void;
      openFile?: (name: string, mime: string, base64: string) => void;
      shareText?: (subject: string, text: string) => void;
      notify?: (title: string, body: string) => void;
    };
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Cell = { value: string | number; type?: "String" | "Number"; style?: string };

function row(cells: Cell[]): string {
  return (
    "<Row>" +
    cells
      .map((cell) => {
        const type = cell.type || "String";
        const style = cell.style ? ` ss:StyleID="${cell.style}"` : "";
        return `<Cell${style}><Data ss:Type="${type}">${esc(cell.value)}</Data></Cell>`;
      })
      .join("") +
    "</Row>"
  );
}

function header(): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
    '<?mso-application progid="Excel.Sheet"?>\r\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">'
  );
}

function styles(): string {
  return (
    "<Styles>" +
    '<Style ss:ID="title"><Font ss:Bold="1" ss:Size="14" ss:Color="#123B35"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>' +
    '<Style ss:ID="hdr"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="11"/><Interior ss:Color="#1C9C79" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>' +
    '<Style ss:ID="alt"><Interior ss:Color="#F2F7F5" ss:Pattern="Solid"/><Alignment ss:Horizontal="Right" ss:WrapText="1"/></Style>' +
    "</Styles>"
  );
}

export function tableToXlsText(
  sheetName: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  title: string,
): string {
  const lines = [header(), styles(), `<Worksheet ss:Name="${esc(sheetName)}">`, "<Table>"];
  if (title) lines.push(row([{ value: title, style: "title" }]));
  lines.push(row(headers.map((h) => ({ value: h, style: "hdr" }))));
  rows.forEach((cells, index) => {
    lines.push(
      row(
        cells.map((cell) => ({
          value: cell,
          type: typeof cell === "number" ? ("Number" as const) : ("String" as const),
          style: index % 2 ? "alt" : undefined,
        })),
      ),
    );
  });
  lines.push("</Table>", "</Worksheet>", "</Workbook>");
  return lines.join("\r\n");
}

export function tableToText(
  title: string,
  headers: string[],
  rows: Array<Array<string | number>>,
): string {
  const lines = [title, "", headers.join(" | ")];
  rows.forEach((cells) => lines.push(cells.map((cell) => String(cell ?? "")).join(" | ")));
  return lines.join("\n");
}

export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>) =>
    cells
      .map((c) => {
        const text = String(c ?? "");
        return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      })
      .join(",");
  return [line(headers), ...rows.map(line)].join("\r\n");
}

function bridge() {
  if (typeof window === "undefined") return null;
  const value = window.LaundryApp;
  return value && typeof value === "object" ? value : null;
}

export function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
    if (typeof cap.getPlatform === "function" && cap.getPlatform() !== "web") return true;
  } catch {
    /* ignore */
  }
  return false;
}

function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(`\ufeff${content}`);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

export function downloadContent(
  filename: string,
  content: string,
  mime: string,
  withBom = true,
): void {
  const payload = withBom ? `\ufeff${content}` : content;
  if (isNative()) {
    const native = bridge();
    if (native && typeof native.openFile === "function") {
      native.openFile(filename, mime, toBase64(content));
      return;
    }
  }
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const blob = new Blob([payload], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function downloadTable(
  sheetName: string,
  filename: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  title: string,
): void {
  downloadContent(filename, tableToXlsText(sheetName, headers, rows, title), "application/vnd.ms-excel");
}

export function downloadCsv(filename: string, content: string): void {
  downloadContent(filename, content, "text/csv");
}

const PRINT_CSS = `
 body{font-family:"Segoe UI",Tahoma,Arial,sans-serif;margin:24px;color:#17202b;direction:rtl}
 h1{font-size:21px;margin:0 0 6px;padding-inline-start:10px;border-inline-start:5px solid #1c9c79;color:#123b35}
 .meta{color:#55606e;font-size:13px;margin-bottom:5px;line-height:1.8}
 h2{font-size:15px;margin:20px 0 8px;color:#123b35;padding-inline-start:8px;border-inline-start:4px solid #8fd3bd}
 table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
 th,td{border:1px solid #cfd6dd;padding:7px 9px;text-align:right}
 th{background:#1c9c79;color:#fff;font-weight:700;border-color:#1c9c79}
 tbody tr:nth-child(even) td{background:#f2f7f5}
 thead{display:table-header-group}
 tr{page-break-inside:avoid}
 .empty{color:#6d7a8a;text-align:center;padding:14px}
 @media print{body{margin:10mm}}
`;

export function printReport(jobName: string, html: string): boolean {
  const native = bridge();
  if (native && typeof native.printHtml === "function") {
    native.printHtml(jobName, html);
    return true;
  }
  if (isNative()) {
    let frame = document.getElementById("laundry-print-frame") as HTMLIFrameElement | null;
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "laundry-print-frame";
      frame.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;border:0;visibility:hidden;";
      document.body.appendChild(frame);
    }
    const doc = frame.contentDocument;
    if (!doc) return false;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      try {
        frame?.contentWindow?.focus();
        frame?.contentWindow?.print();
      } catch {
        /* تجاهل */
      }
    }, 300);
    return true;
  }
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => {
    win.focus();
    win.print();
  }, 350);
  return true;
}

export type ReportSection = {
  heading?: string;
  headers: string[];
  rows: Array<Array<string | number>>;
};

export function printReportSections(
  title: string,
  meta: string[],
  sections: ReportSection[],
  extraHtml = "",
): boolean {
  const blocks = sections
    .map((section) => {
      const head = section.headers.map((cell) => `<th>${esc(cell)}</th>`).join("");
      const body = section.rows
        .map((cells) => `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`)
        .join("");
      const heading = section.heading ? `<h2>${esc(section.heading)}</h2>` : "";
      const empty = `<tr><td colspan="${section.headers.length}" class="empty">لا توجد بيانات</td></tr>`;
      return `${heading}<table><thead><tr>${head}</tr></thead><tbody>${body || empty}</tbody></table>`;
    })
    .join("");
  const metaHtml = meta
    .filter(Boolean)
    .map((line) => `<div class="meta">${esc(line)}</div>`)
    .join("");
  const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${esc(
    title,
  )}</title><style>${PRINT_CSS}</style></head><body><h1>${esc(title)}</h1>${metaHtml}${extraHtml}${blocks}</body></html>`;
  return printReport(title, html);
}

export function downloadSectionsXls(
  filename: string,
  sheetName: string,
  title: string,
  meta: string[],
  sections: ReportSection[],
): void {
  const lines = [header(), styles(), `<Worksheet ss:Name="${esc(sheetName)}">`, "<Table>"];
  lines.push(row([{ value: title, style: "title" }]));
  meta.filter(Boolean).forEach((line) => lines.push(row([{ value: line }])));
  sections.forEach((section) => {
    lines.push(row([{ value: "" }]));
    if (section.heading) lines.push(row([{ value: section.heading, style: "hdr" }]));
    lines.push(row(section.headers.map((cell) => ({ value: cell, style: "hdr" }))));
    section.rows.forEach((cells, index) => {
      lines.push(
        row(
          cells.map((cell) => ({
            value: cell,
            type: typeof cell === "number" ? ("Number" as const) : ("String" as const),
            style: index % 2 ? "alt" : undefined,
          })),
        ),
      );
    });
  });
  lines.push("</Table>", "</Worksheet>", "</Workbook>");
  downloadContent(filename, lines.join("\r\n"), "application/vnd.ms-excel");
}

export function shareText(subject: string, text: string): void {
  const native = bridge();
  if (native && typeof native.shareText === "function") {
    native.shareText(subject, text);
    return;
  }
  if (typeof navigator !== "undefined" && "share" in navigator) {
    void navigator.share?.({ title: subject, text }).catch(() => {});
    return;
  }
  openWhatsApp(text);
}

export function openWhatsApp(text: string): void {
  if (typeof window === "undefined") return;
  window.open(
    `https://wa.me/?text=${encodeURIComponent(text)}`,
    isNative() ? "_system" : "_blank",
    "noopener",
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
