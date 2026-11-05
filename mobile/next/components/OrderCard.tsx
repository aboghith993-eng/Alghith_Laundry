"use client";

import Link from "next/link";
import { AlertTriangle, CalendarDays, Package, UserRound } from "lucide-react";
import { Badge } from "@/components/ui";
import { money } from "@/lib/format";
import { currency } from "@/lib/offlineStore";
import { orderPieces, orderStatusBadge, orderTitle, fulfillmentBadge, syncBadge } from "@/lib/orderDisplay";
import type { LocalOrder } from "@/lib/types";

export default function OrderCard({ order }: { order: LocalOrder }) {
  const status = orderStatusBadge(order);
  const fulfillment = fulfillmentBadge(order);
  const sync = syncBadge(order);
  const pieces = orderPieces(order);

  return (
    <Link className="order-card" href={`/order?id=${encodeURIComponent(order.client_uuid)}`}>
      <div className="order-card-top">
        <div className="order-card-title">
          <strong>{orderTitle(order)}</strong>
          {order.reference && <span className="order-ref">{order.reference}</span>}
        </div>
        <div className="badge-row">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <Badge tone={fulfillment.tone}>{fulfillment.label}</Badge>
          {sync && <Badge tone={sync.tone}>{sync.label}</Badge>}
        </div>
      </div>

      <div className="order-card-meta">
        <span>
          <CalendarDays size={12} style={{ verticalAlign: -2, marginInlineEnd: 3 }} />
          {order.service_date || "—"}
        </span>
        <span>
          <UserRound size={12} style={{ verticalAlign: -2, marginInlineEnd: 3 }} />
          {order.employee_name || order.employee_code || "—"}
        </span>
        <span>
          <Package size={12} style={{ verticalAlign: -2, marginInlineEnd: 3 }} />
          {pieces.sent} قطعة
          {pieces.remaining > 0 ? ` — متبقٍ ${pieces.remaining}` : " — مكتمل"}
        </span>
      </div>

      {order.sync_state === "error" && order.last_error && (
        <div className="sync-note error">
          <AlertTriangle size={13} />
          <span>{order.last_error}</span>
        </div>
      )}

      <div className="order-card-foot">
        <span className="muted small">
          {order.creator_name ? `أنشأه: ${order.creator_name}` : order.receiver_name ? `المستلم: ${order.receiver_name}` : "—"}
        </span>
        <span className="order-value">
          {money(order.subtotal)} <small className="muted">{currency()}</small>
        </span>
      </div>
    </Link>
  );
}
