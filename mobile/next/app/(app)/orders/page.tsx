"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ClipboardList,
  Download,
  FileSpreadsheet,
  FilterX,
  Plus,
  Printer,
  RefreshCw,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHead,
  SearchInput,
  Select,
  StatCard,
} from "@/components/ui";
import OrderCard from "@/components/OrderCard";
import { useApp } from "@/lib/store";
import { currency } from "@/lib/offlineStore";
import { money } from "@/lib/format";
import { daysAgoIso, filterOrders, orderStats } from "@/lib/report";
import { fulfillmentBadge, orderPieces, orderStatusBadge, orderTitle } from "@/lib/orderDisplay";
import { canCreateOrder } from "@/lib/permissions";
import { downloadTable, printReportSections, type ReportSection } from "@/lib/export";
import { todayIso, toIso } from "@/lib/shift";

export default function OrdersPage() {
  const { session, orders, online, syncing, syncNow } = useApp();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [fulfillment, setFulfillment] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(
    () => filterOrders(orders, { q, status, fulfillment, from, to }),
    [orders, q, status, fulfillment, from, to],
  );
  const stats = useMemo(() => orderStats(filtered), [filtered]);

  function applyPeriod(days: number | "all") {
    if (days === "all") {
      setFrom("");
      setTo("");
      return;
    }
    if (days === 0) {
      setFrom(todayIso());
      setTo(todayIso());
      return;
    }
    setFrom(daysAgoIso(days - 1));
    setTo(toIso(new Date()));
  }

  function resetFilters() {
    setQ("");
    setStatus("all");
    setFulfillment("all");
    setFrom("");
    setTo("");
  }

  function buildSections(): ReportSection[] {
    const rows = filtered.map((order) => {
      const statusInfo = orderStatusBadge(order);
      const fulfill = fulfillmentBadge(order);
      const pieces = orderPieces(order);
      return [
        order.reference || order.client_uuid.slice(0, 8),
        order.service_date || "",
        orderTitle(order),
        order.employee_code || "",
        statusInfo.label,
        fulfill.label,
        pieces.sent,
        pieces.received,
        pieces.remaining,
        order.receiver_name || "",
        money(order.subtotal),
      ];
    });
    return [
      {
        headers: [
          "المرجع",
          "التاريخ",
          "الساكن/المستلم",
          "رقم الموظف",
          "الحالة",
          "التسليم",
          "القطع",
          "المستلم",
          "المتبقي",
          "اسم المستلم",
          `القيمة (${currency()})`,
        ],
        rows,
      },
    ];
  }

  function exportExcel() {
    const sections = buildSections();
    downloadTable(
      "الطلبات",
      `laundry-orders-${todayIso()}.xls`,
      sections[0].headers,
      sections[0].rows,
      "تقرير طلبات المغسلة",
    );
  }

  function printList() {
    printReportSections(
      "تقرير طلبات المغسلة",
      [
        `الفترة: ${from || "البداية"} إلى ${to || "اليوم"}`,
        `عدد الطلبات: ${filtered.length} — القيمة: ${money(stats.value)} ${currency()}`,
      ],
      buildSections(),
    );
  }

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow="سجل الطلبات"
        title="الطلبات"
        subtitle={`${orders.length} طلباً محفوظاً — ${filtered.length} مطابقاً للتصفية`}
        actions={
          <>
            <Button size="sm" variant="outline" icon={Download} onClick={exportExcel} disabled={!filtered.length}>
              Excel
            </Button>
            <Button size="sm" variant="outline" icon={Printer} onClick={printList} disabled={!filtered.length}>
              طباعة
            </Button>
          </>
        }
      />

      <div className="metric-grid cols-3">
        <StatCard icon={ClipboardList} label="عدد الطلبات" value={stats.count} tone="primary" />
        <StatCard icon={FileSpreadsheet} label="القيمة" value={money(stats.value)} hint={currency()} tone="success" />
        <StatCard icon={CalendarDays} label="قطع متبقية" value={stats.remaining} hint={`${stats.received} مستلمة`} tone={stats.remaining ? "warn" : "success"} />
      </div>

      <Card>
        <div className="filter-grid">
          <div className="span-2">
            <SearchInput value={q} onChange={setQ} placeholder="بحث بالاسم، الرقم، المرجع، الملاحظات..." />
          </div>
          <Field label="الحالة">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={[
                { value: "all", label: "كل الحالات" },
                { value: "pending", label: "بانتظار التأكيد" },
                { value: "approved", label: "معتمد" },
                { value: "rejected", label: "ملغى / مرفوض" },
              ]}
            />
          </Field>
          <Field label="التسليم">
            <Select
              value={fulfillment}
              onChange={(event) => setFulfillment(event.target.value)}
              options={[
                { value: "all", label: "الكل" },
                { value: "remaining", label: "لم يكتمل" },
                { value: "delivered", label: "مكتمل" },
              ]}
            />
          </Field>
          <Field label="من تاريخ">
            <input
              type="date"
              className="ui-input"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="إلى تاريخ">
            <input
              type="date"
              className="ui-input"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <div className="span-2 row" style={{ gap: 6 }}>
            <Button size="sm" variant="soft" onClick={() => applyPeriod(0)}>اليوم</Button>
            <Button size="sm" variant="soft" onClick={() => applyPeriod(7)}>7 أيام</Button>
            <Button size="sm" variant="soft" onClick={() => applyPeriod(30)}>30 يوماً</Button>
            <Button size="sm" variant="outline" onClick={() => applyPeriod("all")}>الكل</Button>
            <Button size="sm" variant="ghost" icon={FilterX} onClick={resetFilters}>مسح</Button>
            {online && (
              <Button size="sm" variant="ghost" icon={RefreshCw} loading={syncing} onClick={() => void syncNow()}>
                تحديث
              </Button>
            )}
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 6 }}>
          <Badge tone="warn">{stats.pending} بانتظار التأكيد</Badge>
          <Badge tone="good">{stats.approved} معتمد</Badge>
          <Badge tone="bad">{stats.rejected} ملغى</Badge>
          <Badge tone="muted">{stats.fullyDelivered} مكتمل التسليم</Badge>
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={ClipboardList}
            title="لا توجد طلبات مطابقة"
            hint={
              orders.length
                ? "جرّب تغيير كلمة البحث أو الفترة."
                : "لم تُسجّل طلبات بعد. ابدأ بطلب جديد، وسيظهر هنا فور حفظه."
            }
            action={
              canCreateOrder(session) ? (
                <Link href="/new" className="btn btn-primary btn-sm">
                  <Plus size={16} /> طلب جديد
                </Link>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="order-list">
          {filtered.map((order) => (
            <OrderCard key={order.client_uuid} order={order} />
          ))}
        </div>
      )}

      {canCreateOrder(session) && (
        <Link href="/new" className="fab">
          <Plus size={20} /> طلب جديد
        </Link>
      )}
    </div>
  );
}
