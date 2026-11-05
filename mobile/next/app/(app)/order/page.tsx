"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  ClipboardList,
  CloudUpload,
  Edit3,
  FileText,
  Printer,
  Share2,
  Trash2,
  Truck,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  PageHead,
  Panel,
  ProgressBar,
  TextArea,
  TextInput,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import {
  cancelOrder,
  confirmOrder,
  currency,
  deleteOrder,
  deliverOrder,
} from "@/lib/offlineStore";
import { dateTimeLabel, money } from "@/lib/format";
import { canConfirm, canDeleteOrder, canDeliver, canEditOrder } from "@/lib/permissions";
import { fulfillmentBadge, orderPieces, orderStatusBadge, orderTitle, syncBadge } from "@/lib/orderDisplay";
import { printReportSections, shareText } from "@/lib/export";
import type { DeliveryPiece } from "@/lib/types";

function OrderDetail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id") || "";
  const { session, orders, online, syncing, toast, syncNow } = useApp();

  const order = useMemo(
    () => orders.find((item) => item.client_uuid === id) || null,
    [orders, id],
  );

  const [deliverOpen, setDeliverOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [receiverKind, setReceiverKind] = useState<"same_employee" | "other">("same_employee");
  const [receiverName, setReceiverName] = useState("");
  const [deliverQty, setDeliverQty] = useState<Record<number, number>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setError("");
  }, [id]);

  if (!order) {
    return (
      <div className="stack">
        <PageHead title="تفاصيل الطلب" />
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="الطلب غير موجود على هذا الجهاز"
            hint="قد يكون محذوفاً أو لم تُحمّل بياناته بعد. حدّث القائمة من الخادم."
            action={
              <Link href="/orders" className="btn btn-primary btn-sm">
                عرض الطلبات
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const status = orderStatusBadge(order);
  const fulfillment = fulfillmentBadge(order);
  const sync = syncBadge(order);
  const pieces = orderPieces(order);
  const lines = Object.values(order.items || {});
  const delivered = order.fulfillment_status === "delivered";
  const editable = canEditOrder(session, order);
  const deletable = canDeleteOrder(session, order);
  const canReceive = canDeliver(session);
  const canReview = canConfirm(session);
  const canCancel = canReview && order.status === "pending";
  const currentOrder = order;

  function openDeliver() {
    const initial: Record<number, number> = {};
    for (const line of lines) {
      if (line.item_id) {
        const remaining = Math.max(Number(line.quantity) - Number(line.received_quantity || 0), 0);
        initial[Number(line.item_id)] = 0;
        if (remaining <= 0) continue;
      }
    }
    setDeliverQty(initial);
    setReceiverKind("same_employee");
    setReceiverName("");
    setError("");
    setDeliverOpen(true);
  }

  function deliverAll() {
    const next: Record<number, number> = {};
    for (const line of lines) {
      if (!line.item_id) continue;
      next[Number(line.item_id)] = Math.max(
        Number(line.quantity) - Number(line.received_quantity || 0),
        0,
      );
    }
    setDeliverQty(next);
  }

  async function submitDeliver() {
    setError("");
    const payload: DeliveryPiece[] = Object.entries(deliverQty)
      .map(([lineId, quantity]) => ({ id: Number(lineId), quantity: Number(quantity) }))
      .filter((piece) => piece.quantity > 0);
    if (!payload.length) {
      setError("أدخل كمية مستلمة أكبر من صفر لصنف واحد على الأقل.");
      return;
    }
    if (receiverKind === "other" && !receiverName.trim()) {
      setError("اكتب اسم مستلم الأصناف الآخر.");
      return;
    }
    setBusy(true);
    try {
      const result = await deliverOrder(currentOrder.client_uuid, payload, {
        kind: receiverKind,
        name: receiverName,
      });
      if (!result.ok) {
        setError(result.error || "تعذر تسجيل التسليم.");
        return;
      }
      toast(
        online
          ? "تم تسجيل التسليم — تجري المزامنة."
          : "تم تسجيل التسليم على الجهاز وسيُزامن تلقائياً.",
        "success",
      );
      setDeliverOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitApprove() {
    setBusy(true);
    try {
      const result = confirmOrder(currentOrder.client_uuid, "approved");
      if (!result.ok) {
        setError(result.error || "تعذر اعتماد الطلب.");
        return;
      }
      toast("تم اعتماد الطلب.", "success");
      setApproveOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    setError("");
    if (!reason.trim()) {
      setError("اكتب سبب الإلغاء / الرفض.");
      return;
    }
    setBusy(true);
    try {
      const result = cancelOrder(currentOrder.client_uuid, reason);
      if (!result.ok) {
        setError(result.error || "تعذر إلغاء الطلب.");
        return;
      }
      toast("تم إلغاء الطلب / رفضه.", "success");
      setRejectOpen(false);
      setReason("");
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete() {
    setBusy(true);
    try {
      const result = deleteOrder(currentOrder.client_uuid);
      if (!result.ok) {
        toast(result.error || "تعذر حذف الطلب.", "error");
        return;
      }
      toast("تم حذف الطلب من هذا الجهاز وسيُحذف من الخادم عند المزامنة.", "success");
      setDeleteOpen(false);
      router.replace("/orders");
    } finally {
      setBusy(false);
    }
  }

  function shareOrder() {
    const text = [
      `طلب مغسلة ${currentOrder.reference || ""}`,
      `الساكن: ${orderTitle(currentOrder)} (${currentOrder.employee_code || "—"})`,
      `التاريخ: ${currentOrder.service_date}`,
      `الحالة: ${status.label} — ${fulfillment.label}`,
      ...lines.map(
        (line) =>
          `• ${line.item_name}: ${line.quantity} ${line.unit || "قطعة"} × ${money(line.unit_price)}`,
      ),
      `الإجمالي: ${money(currentOrder.subtotal)} ${currency()}`,
    ].join("\n");
    shareText("تفاصيل طلب المغسلة", text);
  }

  function printOrder() {
    printReportSections(
      `طلب مغسلة ${currentOrder.reference || ""}`,
      [
        `الساكن: ${orderTitle(currentOrder)} — رقم الموظف: ${currentOrder.employee_code || "—"}`,
        `تاريخ الخدمة: ${currentOrder.service_date} — الحالة: ${status.label} — التسليم: ${fulfillment.label}`,
        `القيمة: ${money(currentOrder.subtotal)} ${currency()}`,
      ],
      [
        {
          headers: ["الصنف", "الوحدة", "الكمية", "سعر الوحدة", "الإجمالي", "المستلم", "المتبقي"],
          rows: lines.map((line) => [
            line.item_name,
            line.unit || "قطعة",
            line.quantity,
            money(line.unit_price),
            money(line.line_total ?? Number(line.quantity) * Number(line.unit_price)),
            Number(line.received_quantity || 0),
            Math.max(Number(line.quantity) - Number(line.received_quantity || 0), 0),
          ]),
        },
      ],
    );
  }

  return (
    <div className="stack-lg">
      <Link href="/orders" className="back-link">
        <ClipboardList size={15} /> كل الطلبات
      </Link>

      <PageHead
        eyebrow={order.reference || "طلب محلي"}
        title={orderTitle(order)}
        subtitle={`${order.service_date} — ${order.employee_code || "بدون رقم"}`}
        actions={
          <>
            <Button size="sm" variant="outline" icon={Share2} onClick={shareOrder}>
              مشاركة
            </Button>
            <Button size="sm" variant="outline" icon={Printer} onClick={printOrder}>
              طباعة
            </Button>
          </>
        }
      />

      <div className="row" style={{ gap: 6 }}>
        <Badge tone={status.tone} dot>
          {status.label}
        </Badge>
        <Badge tone={fulfillment.tone}>{fulfillment.label}</Badge>
        {sync && <Badge tone={sync.tone}>{sync.label}</Badge>}
        <Badge tone="muted">{pieces.sent} قطعة</Badge>
      </div>

      {order.sync_state === "error" && order.last_error && (
        <div className="alert alert-error">
          <AlertTriangle size={17} />
          <div className="grow">
            <strong>لم تُرسل آخر عملية إلى الخادم.</strong>
            <div className="small">{order.last_error}</div>
          </div>
          {online && (
            <Button size="sm" variant="outline" loading={syncing} onClick={() => void syncNow()}>
              إعادة المحاولة
            </Button>
          )}
        </div>
      )}

      {!order.server_id && (
        <div className="alert alert-warn">
          <CloudUpload size={17} />
          <div className="grow">
            <strong>الطلب محفوظ على الجهاز فقط.</strong>
            <div className="small">يجب مزامنته مع الخادم قبل تسجيل التسليم أو الاعتماد.</div>
          </div>
          {online && (
            <Button size="sm" variant="outline" loading={syncing} onClick={() => void syncNow()}>
              مزامنة
            </Button>
          )}
        </div>
      )}

      <Card>
        <div className="detail-grid">
          <div className="detail-item">
            <span>الساكن / الموظف</span>
            <strong>{order.employee_name || order.person_name || "—"}</strong>
          </div>
          <div className="detail-item">
            <span>رقم الموظف</span>
            <strong dir="ltr">{order.employee_code || "—"}</strong>
          </div>
          <div className="detail-item">
            <span>تاريخ الخدمة</span>
            <strong>{order.service_date || "—"}</strong>
          </div>
          <div className="detail-item">
            <span>قيمة الطلب</span>
            <strong>
              {money(order.subtotal)} {currency()}
            </strong>
          </div>
          <div className="detail-item">
            <span>اسم المستلم</span>
            <strong>
              {order.receiver_name || "—"}
              {order.receiver_kind === "other" ? " (عامل آخر)" : ""}
            </strong>
          </div>
          <div className="detail-item">
            <span>أنشأه</span>
            <strong>{order.creator_name || "—"}</strong>
          </div>
          <div className="detail-item">
            <span>تاريخ الإنشاء</span>
            <strong>{dateTimeLabel(order.created_at)}</strong>
          </div>
          <div className="detail-item">
            <span>آخر تحديث للمزامنة</span>
            <strong>{sync ? sync.label : "مُزامن"}</strong>
          </div>
          {order.confirmed_at && (
            <div className="detail-item">
              <span>تاريخ الاعتماد</span>
              <strong>{dateTimeLabel(order.confirmed_at)}</strong>
            </div>
          )}
          {order.delivered_at && (
            <div className="detail-item">
              <span>تاريخ اكتمال التسليم</span>
              <strong>{dateTimeLabel(order.delivered_at)}</strong>
            </div>
          )}
        </div>

        {order.rejection_reason && (
          <div className="alert alert-error" style={{ marginTop: 12 }}>
            <XCircle size={16} />
            <span>سبب الإلغاء / الرفض: {order.rejection_reason}</span>
          </div>
        )}

        {order.notes && (
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            <FileText size={16} />
            <span>{order.notes}</span>
          </div>
        )}
      </Card>

      <Panel title="أصناف الطلب" subtitle={`${lines.length} صنف — ${pieces.received} من ${pieces.sent} قطعة مستلمة`}>
        <div className="line-list">
          {lines.map((line, index) => {
            const quantity = Number(line.quantity || 0);
            const received = Number(line.received_quantity || 0);
            const remaining = Math.max(quantity - received, 0);
            const rate = quantity > 0 ? Math.round((received / quantity) * 100) : 0;
            return (
              <div key={`${line.item_id || index}`} className="line-item" style={{ display: "block" }}>
                <div className="row-between">
                  <div>
                    <div className="line-name">{line.item_name}</div>
                    <div className="line-sub">
                      {quantity} {line.unit || "قطعة"} × {money(line.unit_price)} ={" "}
                      {money(line.line_total ?? quantity * Number(line.unit_price))} {currency()}
                    </div>
                  </div>
                  <div className="line-amount">
                    <strong>{remaining > 0 ? `متبقٍ ${remaining}` : "مكتمل"}</strong>
                    <small>
                      مستلم {received} / {quantity}
                    </small>
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <ProgressBar value={rate} tone={rate >= 100 ? "primary" : rate > 0 ? "warn" : "danger"} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="total-bar" style={{ marginTop: 12 }}>
          <span>الإجمالي</span>
          <strong>
            {money(order.subtotal)} <small className="muted" style={{ fontSize: 11 }}>{currency()}</small>
          </strong>
        </div>
      </Panel>

      {(editable || deletable || canReceive || canReview) && order.status !== "rejected" && (
        <Panel title="الإجراءات" subtitle="كل الإجراءات تعمل دون اتصال وتُزامن تلقائياً">
          <div className="stack" style={{ gap: 8 }}>
            {editable && (
              <Link href={`/new?edit=${encodeURIComponent(order.client_uuid)}`} className="btn btn-outline btn-block">
                <Edit3 size={17} /> تعديل الطلب
              </Link>
            )}

            {canReceive && order.server_id && (
              <Button variant="primary" icon={Truck} block onClick={openDeliver} disabled={pieces.remaining <= 0}>
                {pieces.remaining > 0 ? "تسجيل استلام / تسليم جزئي" : "تم استلام جميع القطع"}
              </Button>
            )}

            {canReceive && !order.server_id && (
              <Button variant="soft" icon={CloudUpload} block loading={syncing} onClick={() => void syncNow()}>
                مزامنة الطلب قبل التسليم
              </Button>
            )}

            {canReview && order.status === "pending" && (
              <Button
                variant={delivered ? "primary" : "outline"}
                icon={BadgeCheck}
                block
                disabled={!delivered}
                onClick={() => setApproveOpen(true)}
              >
                {delivered ? "اعتماد الطلب" : "الاعتماد بعد اكتمال التسليم"}
              </Button>
            )}

            {canCancel && (
              <Button variant="soft" icon={XCircle} block onClick={() => setRejectOpen(true)}>
                إلغاء الطلب / رفضه
              </Button>
            )}

            {deletable && (
              <Button variant="danger" icon={Trash2} block onClick={() => setDeleteOpen(true)}>
                حذف الطلب نهائياً
              </Button>
            )}
          </div>
        </Panel>
      )}

      {order.status === "rejected" && deletable && (
        <Button variant="danger" icon={Trash2} block onClick={() => setDeleteOpen(true)}>
          حذف الطلب نهائياً
        </Button>
      )}

      {/* ------------------------------ نافذة التسليم ------------------------------ */}
      <Modal
        open={deliverOpen}
        title="تسجيل استلام القطع"
        subtitle="حدّد الكميات المستلمة الآن واسم المستلم. يمكن استلام الباقي لاحقاً."
        onClose={() => setDeliverOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeliverOpen(false)} disabled={busy}>
              إلغاء
            </Button>
            <Button loading={busy} onClick={() => void submitDeliver()}>
              تسجيل الاستلام
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 9 }}>
          <div className="row-between">
            <span className="muted small">المتبقي من الطلب: {pieces.remaining} قطعة</span>
            <Button size="sm" variant="ghost" onClick={deliverAll}>
              استلام الكل
            </Button>
          </div>
          {lines.map((line, index) => {
            if (!line.item_id) return null;
            const remaining = Math.max(
              Number(line.quantity) - Number(line.received_quantity || 0),
              0,
            );
            return (
              <div key={line.item_id || index} className="deliver-line">
                <div>
                  <div className="line-name">{line.item_name}</div>
                  <div className="remain">
                    الكمية {line.quantity} — المتبقي {remaining}
                  </div>
                </div>
                <TextInput
                  type="number"
                  min={0}
                  max={remaining}
                  step="any"
                  value={deliverQty[Number(line.item_id)] ?? ""}
                  disabled={remaining <= 0}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    setDeliverQty((current) => ({
                      ...current,
                      [Number(line.item_id)]: Number.isFinite(parsed)
                        ? Math.max(0, Math.min(parsed, remaining))
                        : 0,
                    }));
                  }}
                  inputMode="decimal"
                  placeholder="0"
                />
              </div>
            );
          })}

          <div className="divider" />
          <div className="stack" style={{ gap: 8 }}>
            <span className="small strong">مستلم الأصناف</span>
            <label className="service-pick" style={{ cursor: "pointer" }}>
              <div className="service-pick-info">
                <strong>نفس الموظف / الساكن</strong>
                <small>{order.person_name || order.employee_name || "المسجل في الطلب"}</small>
              </div>
              <input
                type="radio"
                name="receiver"
                checked={receiverKind === "same_employee"}
                onChange={() => setReceiverKind("same_employee")}
              />
            </label>
            <label className="service-pick" style={{ cursor: "pointer" }}>
              <div className="service-pick-info">
                <strong>عامل آخر</strong>
                <small>اكتب اسم المستلم الفعلي</small>
              </div>
              <input
                type="radio"
                name="receiver"
                checked={receiverKind === "other"}
                onChange={() => setReceiverKind("other")}
              />
            </label>
            {receiverKind === "other" && (
              <Field label="اسم المستلم الآخر" required>
                <TextInput
                  value={receiverName}
                  onChange={(event) => setReceiverName(event.target.value)}
                  placeholder="اسم العامل المستلم"
                />
              </Field>
            )}
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {!online && (
            <div className="alert alert-info">
              <CloudUpload size={16} />
              <span>دون اتصال: سيُحفظ التسليم محلياً ويُزامن عند عودة الاتصال.</span>
            </div>
          )}
        </div>
      </Modal>

      {/* ------------------------------ الاعتماد ------------------------------ */}
      <ConfirmDialog
        open={approveOpen}
        title="اعتماد الطلب"
        message={`سيتم اعتماد طلب ${orderTitle(order)} بقيمة ${money(order.subtotal)} ${currency()}. لا يمكن التراجع بعد الاعتماد.`}
        confirmLabel="اعتماد"
        busy={busy}
        onConfirm={() => void submitApprove()}
        onClose={() => setApproveOpen(false)}
      >
        {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
      </ConfirmDialog>

      {/* ------------------------------ الرفض ------------------------------ */}
      <Modal
        open={rejectOpen}
        title="إلغاء الطلب / رفضه"
        subtitle="سيُسجَّل الطلب كملغى مع سبب الرفض."
        onClose={() => setRejectOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)} disabled={busy}>
              تراجع
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void submitReject()}>
              تأكيد الإلغاء
            </Button>
          </>
        }
      >
        <Field label="سبب الإلغاء / الرفض" required>
          <TextArea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="مثال: طلب مكرر، أو بيانات غير صحيحة..."
            autoFocus
          />
        </Field>
        {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
      </Modal>

      {/* ------------------------------ الحذف ------------------------------ */}
      <ConfirmDialog
        open={deleteOpen}
        title="حذف الطلب نهائياً"
        message={`سيُحذف الطلب ${order.reference || ""} من هذا الجهاز ومن الخادم. لا يمكن التراجع.`}
        confirmLabel="حذف نهائي"
        tone="danger"
        busy={busy}
        onConfirm={() => void submitDelete()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<LoadingBlock label="جارٍ تحميل الطلب..." />}>
      <OrderDetail />
    </Suspense>
  );
}
