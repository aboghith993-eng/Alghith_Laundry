/* تقارير المغسلة: تقرير الطلبات وتقرير الساكنين/الموظفين.
   تقرير الساكنين يُظهر كل الساكنين — ومن لم يرسل يظهر بالرقم صفر — لفترة لا تقل عن 30 يوماً. */

import type { Employee, LocalOrder, ServiceItem } from "./types";
import { num } from "./format";
import { toIso } from "./shift";

export type Period = { from: string; to: string };

export const MIN_RESIDENT_DAYS = 30;

export function daysAgoIso(days: number, fromDate = new Date()): string {
  const d = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  d.setDate(d.getDate() - days);
  return toIso(d);
}

/** الفترة الافتراضية لتقرير الساكنين: آخر 30 يوماً شاملة اليوم. */
export function defaultResidentPeriod(): Period {
  return { from: daysAgoIso(MIN_RESIDENT_DAYS - 1), to: toIso(new Date()) };
}

/** يضمن أن فترة تقرير الساكنين لا تقل عن 30 يوماً (يمدّ البداية للخلف). */
export function ensureMinimumPeriod(period: Period, minDays = MIN_RESIDENT_DAYS): Period {
  const to = period.to || toIso(new Date());
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(end.getTime())) return defaultResidentPeriod();
  const fromDate = period.from ? new Date(`${period.from}T00:00:00`) : null;
  const minimumStart = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (minDays - 1));
  const start = !fromDate || Number.isNaN(fromDate.getTime()) || fromDate < minimumStart
    ? minimumStart
    : fromDate;
  return { from: toIso(start), to };
}

export function periodDays(period: Period): number {
  const from = new Date(`${period.from}T00:00:00`).getTime();
  const to = new Date(`${period.to}T00:00:00`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0;
  return Math.floor((to - from) / 86400000) + 1;
}

export function inPeriod(dateText: string | undefined, period: Period): boolean {
  const value = String(dateText || "").slice(0, 10);
  if (!value) return false;
  if (period.from && value < period.from) return false;
  if (period.to && value > period.to) return false;
  return true;
}

export type OrderFilters = {
  from?: string;
  to?: string;
  status?: string;
  fulfillment?: string;
  q?: string;
};

export function filterOrders(orders: LocalOrder[], filters: OrderFilters): LocalOrder[] {
  const q = (filters.q || "").trim().toLowerCase();
  return orders.filter((order) => {
    if (filters.from && String(order.service_date || "").slice(0, 10) < filters.from) return false;
    if (filters.to && String(order.service_date || "").slice(0, 10) > filters.to) return false;
    if (filters.status && filters.status !== "all" && order.status !== filters.status) return false;
    if (filters.fulfillment && filters.fulfillment !== "all") {
      if (filters.fulfillment === "remaining" && order.fulfillment_status === "delivered") {
        return false;
      }
      if (
        filters.fulfillment === "delivered" &&
        order.fulfillment_status !== "delivered"
      ) {
        return false;
      }
    }
    if (q) {
      const haystack = [
        order.reference,
        order.employee_code,
        order.employee_name,
        order.person_name,
        order.notes,
        order.creator_name,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export type OrderStats = {
  count: number;
  value: number;
  pieces: number;
  received: number;
  remaining: number;
  deliveredOrders: number;
  pending: number;
  approved: number;
  rejected: number;
  fullyDelivered: number;
};

export function orderStats(orders: LocalOrder[]): OrderStats {
  const stats: OrderStats = {
    count: orders.length,
    value: 0,
    pieces: 0,
    received: 0,
    remaining: 0,
    deliveredOrders: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    fullyDelivered: 0,
  };
  for (const order of orders) {
    stats.value += num(order.subtotal);
    if (order.status === "pending") stats.pending += 1;
    if (order.status === "approved") stats.approved += 1;
    if (order.status === "rejected") stats.rejected += 1;
    if (order.fulfillment_status === "delivered") stats.fullyDelivered += 1;
    let sent = 0;
    let got = 0;
    for (const line of Object.values(order.items || {})) {
      sent += num(line.quantity);
      got += num(line.received_quantity);
    }
    stats.pieces += sent;
    stats.received += got;
    stats.remaining += Math.max(sent - got, 0);
    if (got > 0) stats.deliveredOrders += 1;
  }
  return stats;
}

export type ServiceBreakdownRow = {
  service_item_id?: number;
  name: string;
  unit: string;
  orders: number;
  quantity: number;
  received: number;
  remaining: number;
  value: number;
};

export function serviceBreakdown(orders: LocalOrder[]): ServiceBreakdownRow[] {
  const map = new Map<string, ServiceBreakdownRow & { orderSet: Set<string> }>();
  for (const order of orders) {
    for (const [key, line] of Object.entries(order.items || {})) {
      const id = String(line.service_item_id ?? key);
      const row =
        map.get(id) ||
        {
          service_item_id: line.service_item_id,
          name: line.item_name || "خدمة",
          unit: line.unit || "قطعة",
          orders: 0,
          quantity: 0,
          received: 0,
          remaining: 0,
          value: 0,
          orderSet: new Set<string>(),
        };
      if (!row.orderSet.has(order.client_uuid)) {
        row.orderSet.add(order.client_uuid);
        row.orders += 1;
      }
      row.quantity += num(line.quantity);
      row.received += num(line.received_quantity);
      row.remaining += Math.max(num(line.quantity) - num(line.received_quantity), 0);
      row.value += num(line.line_total ?? num(line.quantity) * num(line.unit_price));
      map.set(id, row);
    }
  }
  return Array.from(map.values())
    .map(({ orderSet: _orderSet, ...row }) => row)
    .sort((a, b) => b.quantity - a.quantity);
}

export type EmployeeBreakdownRow = {
  employee_id?: number | null;
  employee_code: string;
  name: string;
  orders: number;
  pieces: number;
  value: number;
};

export function employeeBreakdown(orders: LocalOrder[]): EmployeeBreakdownRow[] {
  const map = new Map<string, EmployeeBreakdownRow>();
  for (const order of orders) {
    const key = String(order.employee_id ?? order.employee_code ?? order.employee_name ?? "?");
    const row =
      map.get(key) ||
      {
        employee_id: order.employee_id,
        employee_code: order.employee_code || "",
        name: order.employee_name || order.person_name || "غير محدد",
        orders: 0,
        pieces: 0,
        value: 0,
      };
    row.orders += 1;
    row.value += num(order.subtotal);
    row.pieces += Object.values(order.items || {}).reduce(
      (sum, line) => sum + num(line.quantity),
      0,
    );
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.orders - a.orders);
}

/* ------------------------------ تقرير الساكنين ------------------------------ */

export type ResidentRow = {
  employee_id: number;
  employee_code: string;
  name: string;
  department: string;
  housing_location: string;
  service_type: string;
  active: boolean;
  orders: number;
  pieces: number;
  received: number;
  remaining: number;
  value: number;
  delivery_rate: number;
  last_sent: string;
  last_received: string;
};

export type ResidentTotals = {
  residents: number;
  senders: number;
  nonSenders: number;
  orders: number;
  pieces: number;
  received: number;
  remaining: number;
  value: number;
  delivery_rate: number;
};

export type ResidentReport = {
  period: Period;
  days: number;
  rows: ResidentRow[];
  totals: ResidentTotals;
  services: Array<{ name: string; unit: string; quantity: number; residents: number }>;
};

function isServiceOnlyEmployee(employee: Employee): boolean {
  return (employee.person_type || "") === "general";
}

/** يجمع طلبات الساكنين في الفترة، ويضيف من لم يرسل بصفوف صفرية. */
export function buildResidentReport(
  employees: Employee[],
  orders: LocalOrder[],
  rawPeriod: Period,
  includeInactive = false,
): ResidentReport {
  const period = ensureMinimumPeriod(rawPeriod);
  const relevant = orders.filter((order) => {
    if (order.status === "rejected") return false;
    return inPeriod(order.service_date, period);
  });

  const byEmployeeId = new Map<number, LocalOrder[]>();
  const byCode = new Map<string, LocalOrder[]>();
  for (const order of relevant) {
    if (order.employee_id) {
      const list = byEmployeeId.get(Number(order.employee_id)) || [];
      list.push(order);
      byEmployeeId.set(Number(order.employee_id), list);
    }
    if (order.employee_code) {
      const list = byCode.get(order.employee_code) || [];
      list.push(order);
      byCode.set(order.employee_code, list);
    }
  }

  const rows: ResidentRow[] = [];
  for (const employee of employees) {
    if (isServiceOnlyEmployee(employee)) continue;
    const active = employee.active !== false;
    if (!active && !includeInactive) continue;
    const matched = new Set<LocalOrder>();
    for (const order of byEmployeeId.get(Number(employee.id)) || []) matched.add(order);
    for (const order of byCode.get(employee.employee_code) || []) matched.add(order);
    const list = Array.from(matched);

    let pieces = 0;
    let received = 0;
    let value = 0;
    let lastSent = "";
    let lastReceived = "";
    const serviceNames = new Map<string, { name: string; unit: string; quantity: number }>();
    for (const order of list) {
      value += num(order.subtotal);
      const sentDate = String(order.service_date || "").slice(0, 10);
      if (sentDate > lastSent) lastSent = sentDate;
      for (const [key, line] of Object.entries(order.items || {})) {
        const quantity = num(line.quantity);
        const got = num(line.received_quantity);
        pieces += quantity;
        received += got;
        if (got > 0) {
          const receivedDate = String(order.delivered_at || order.received_at || "").slice(0, 10);
          if (receivedDate > lastReceived) lastReceived = receivedDate;
        }
        const itemKey = String(line.service_item_id ?? key);
        const item = serviceNames.get(itemKey) || {
          name: line.item_name || "خدمة",
          unit: line.unit || "قطعة",
          quantity: 0,
        };
        item.quantity += quantity;
        serviceNames.set(itemKey, item);
      }
    }

    rows.push({
      employee_id: employee.id,
      employee_code: employee.employee_code || "",
      name: employee.name || "",
      department: employee.department || "",
      housing_location: employee.housing_location || "",
      service_type: employee.service_type || "",
      active,
      orders: list.length,
      pieces,
      received,
      remaining: Math.max(pieces - received, 0),
      value,
      delivery_rate: pieces > 0 ? Math.round((received / pieces) * 1000) / 10 : 0,
      last_sent: lastSent,
      last_received: lastReceived,
    });
  }

  rows.sort((a, b) => {
    if (b.orders !== a.orders) return b.orders - a.orders;
    if (b.pieces !== a.pieces) return b.pieces - a.pieces;
    return a.name.localeCompare(b.name, "ar");
  });

  const senders = rows.filter((row) => row.orders > 0).length;
  const totals: ResidentTotals = {
    residents: rows.length,
    senders,
    nonSenders: rows.length - senders,
    orders: rows.reduce((sum, row) => sum + row.orders, 0),
    pieces: rows.reduce((sum, row) => sum + row.pieces, 0),
    received: rows.reduce((sum, row) => sum + row.received, 0),
    remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
    value: rows.reduce((sum, row) => sum + row.value, 0),
    delivery_rate: 0,
  };
  totals.delivery_rate =
    totals.pieces > 0 ? Math.round((totals.received / totals.pieces) * 1000) / 10 : 0;

  const serviceMap = new Map<string, { name: string; unit: string; quantity: number; residents: Set<string> }>();
  for (const row of rows) {
    for (const order of relevant) {
      if (
        Number(order.employee_id) !== Number(row.employee_id) &&
        order.employee_code !== row.employee_code
      ) {
        continue;
      }
      for (const [key, line] of Object.entries(order.items || {})) {
        const itemKey = `${line.service_item_id ?? key}:${line.item_name}`;
        const item = serviceMap.get(itemKey) || {
          name: line.item_name || "خدمة",
          unit: line.unit || "قطعة",
          quantity: 0,
          residents: new Set<string>(),
        };
        item.quantity += num(line.quantity);
        item.residents.add(String(row.employee_id));
        serviceMap.set(itemKey, item);
      }
    }
  }

  return {
    period,
    days: periodDays(period),
    rows,
    totals,
    services: Array.from(serviceMap.values())
      .map((item) => ({
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        residents: item.residents.size,
      }))
      .sort((a, b) => b.quantity - a.quantity),
  };
}

/** ملخّص نصي للمشاركة عبر واتساب. */
export function residentShareText(report: ResidentReport, title = "تقرير ساكنين المغسلة"): string {
  const nonSenders = report.rows
    .filter((row) => row.orders === 0)
    .slice(0, 25)
    .map((row) => `• ${row.name} (${row.employee_code})`)
    .join("\n");
  return [
    title,
    `الفترة: ${report.period.from} إلى ${report.period.to} (${report.days} يوماً)`,
    `الساكنون: ${report.totals.residents} — أرسلوا: ${report.totals.senders} — لم يرسلوا: ${report.totals.nonSenders}`,
    `الطلبات: ${report.totals.orders} — القطع: ${report.totals.pieces} — المستلم: ${report.totals.received} — نسبة التسليم: ${report.totals.delivery_rate}%`,
    nonSenders ? `\nلم يرسلوا أي غرض خلال الفترة:\n${nonSenders}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function servicesAsOptions(items: ServiceItem[]): Array<{ value: string; label: string }> {
  return items.map((item) => ({
    value: String(item.id),
    label: `${item.name} — ${num(item.rate)} / ${item.unit || "قطعة"}`,
  }));
}
