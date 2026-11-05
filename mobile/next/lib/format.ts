/* أدوات تنسيق مشتركة */

export function money(value: unknown): string {
  const n = Number(value || 0);
  return n.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function qty(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}

export function dateLabel(value?: string | null): string {
  const s = String(value || "").trim();
  if (!s) return "—";
  return s.slice(0, 10);
}

export function dateTimeLabel(value?: string | null): string {
  const s = String(value || "").trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(value?: string | null): string {
  if (!value) return "—";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم`;
}

export function num(value: unknown): number {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

/** إجمالي بند الطلب بغض النظر عن مصدره. */
export function lineTotal(line: { quantity?: number; unit_price?: number; line_total?: number }): number {
  if (line.line_total !== undefined && line.line_total !== null) return num(line.line_total);
  return num(line.quantity) * num(line.unit_price);
}

/** قيمة الطلب: المبلغ المحفوظ من الخادم أو محسوب من البنود. */
export function orderValue(order: {
  subtotal?: number;
  items?: Record<string, { quantity?: number; unit_price?: number; line_total?: number }>;
}): number {
  if (order.subtotal !== undefined && order.subtotal !== null && num(order.subtotal) > 0) {
    return num(order.subtotal);
  }
  return Object.values(order.items || {}).reduce((sum, line) => sum + lineTotal(line), 0);
}
