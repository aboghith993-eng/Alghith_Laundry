/* عرض حالات الطلب بشكل موحّد في القوائم والتفاصيل. */

import { num } from "./format";
import type { LocalOrder } from "./types";
import type { BadgeTone } from "@/components/ui";

export function orderStatusBadge(order: LocalOrder): { label: string; tone: BadgeTone } {
  if (order.status === "approved") return { label: "معتمد", tone: "good" };
  if (order.status === "rejected") return { label: "ملغى / مرفوض", tone: "bad" };
  return { label: "بانتظار التأكيد", tone: "warn" };
}

export function fulfillmentBadge(order: LocalOrder): { label: string; tone: BadgeTone } {
  const lines = Object.values(order.items || {});
  const received = lines.reduce((sum, line) => sum + num(line.received_quantity), 0);
  if (order.fulfillment_status === "delivered") return { label: "مكتمل التسليم", tone: "primary" };
  if (received > 0) return { label: "تسليم جزئي", tone: "info" };
  return { label: "بانتظار التسليم", tone: "muted" };
}

export function syncBadge(order: LocalOrder): { label: string; tone: BadgeTone } | null {
  if (order.sync_state === "error") return { label: "فشل الإرسال", tone: "bad" };
  if (order.sync_state === "pending") return { label: "بانتظار المزامنة", tone: "warn" };
  if (order.sync_state === "created") return { label: "تم الإرسال", tone: "good" };
  if (order.sync_state === "duplicate") return { label: "مُرسل سابقاً", tone: "info" };
  return null;
}

export function orderPieces(order: LocalOrder): { sent: number; received: number; remaining: number } {
  let sent = 0;
  let received = 0;
  for (const line of Object.values(order.items || {})) {
    sent += num(line.quantity);
    received += num(line.received_quantity);
  }
  return { sent, received, remaining: Math.max(sent - received, 0) };
}

export function orderTitle(order: LocalOrder): string {
  return order.person_name || order.employee_name || order.employee_code || "طلب";
}
