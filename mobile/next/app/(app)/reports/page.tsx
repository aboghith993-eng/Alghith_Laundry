"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ChartColumn,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Package,
  Percent,
  Printer,
  Share2,
  UsersRound,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingBlock,
  PageHead,
  Panel,
  ProgressBar,
  SearchInput,
  Select,
  StatCard,
  Switch,
  Tabs,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import { currency } from "@/lib/offlineStore";
import { money, qty } from "@/lib/format";
import {
  MIN_RESIDENT_DAYS,
  buildResidentReport,
  defaultResidentPeriod,
  daysAgoIso,
  ensureMinimumPeriod,
  filterOrders,
  orderStats,
  periodDays,
  residentShareText,
  serviceBreakdown,
  type Period,
} from "@/lib/report";
import { fulfillmentBadge, orderPieces, orderStatusBadge, orderTitle } from "@/lib/orderDisplay";
import {
  downloadCsv,
  downloadSectionsXls,
  printReportSections,
  shareText,
  toCsv,
  type ReportSection,
} from "@/lib/export";
import { todayIso } from "@/lib/shift";
import type { Employee, LocalOrder } from "@/lib/types";

type TabValue = "orders" | "residents";

function ReportsInner() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "residents" ? "residents" : "orders";
  const { snapshot, orders, online } = useApp();
  const [tab, setTab] = useState<TabValue>(initialTab);

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow="التقارير والتحليلات"
        title="التقارير"
        subtitle="تقارير الطلبات وقيمها، وتقرير الساكنين لفترة لا تقل عن 30 يوماً يشمل من لم يرسل."
      />

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "orders", label: "تقرير الطلبات", icon: ClipboardList },
          { value: "residents", label: "تقرير الساكنين", icon: UsersRound },
        ]}
      />

      {tab === "orders" ? (
        <OrdersReport orders={orders} online={online} />
      ) : (
        <ResidentsReport employees={snapshot?.employees || []} orders={orders} />
      )}
    </div>
  );
}

/* ============================== تقرير الطلبات ============================== */

function OrdersReport({ orders, online }: { orders: LocalOrder[]; online: boolean }) {
  const [period, setPeriod] = useState<Period>(defaultResidentPeriod());
  const [status, setStatus] = useState("all");
  const [fulfillment, setFulfillment] = useState("all");
  const [q, setQ] = useState("");

  const filtered = useMemo(
    () =>
      filterOrders(orders, {
        from: period.from,
        to: period.to,
        status,
        fulfillment,
        q,
      }),
    [orders, period, status, fulfillment, q],
  );
  const stats = useMemo(() => orderStats(filtered), [filtered]);
  const services = useMemo(() => serviceBreakdown(filtered), [filtered]);

  function setDays(days: number) {
    setPeriod({ from: daysAgoIso(days - 1), to: todayIso() });
  }

  function sections(): ReportSection[] {
    return [
      {
        heading: "تفاصيل الطلبات",
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
          "المستلم الفعلي",
          `القيمة (${currency()})`,
        ],
        rows: filtered.map((order) => {
          const pieces = orderPieces(order);
          return [
            order.reference || order.client_uuid.slice(0, 8),
            order.service_date || "",
            orderTitle(order),
            order.employee_code || "",
            orderStatusBadge(order).label,
            fulfillmentBadge(order).label,
            pieces.sent,
            pieces.received,
            pieces.remaining,
            order.receiver_name || "",
            Number(Number(order.subtotal || 0).toFixed(2)),
          ];
        }),
      },
      {
        heading: "حسب الخدمة",
        headers: ["الخدمة", "الوحدة", "عدد الطلبات", "الكمية", "المستلم", "المتبقي", `القيمة (${currency()})`],
        rows: services.map((row) => [
          row.name,
          row.unit,
          row.orders,
          row.quantity,
          row.received,
          row.remaining,
          Number(row.value.toFixed(2)),
        ]),
      },
    ];
  }

  function meta(): string[] {
    return [
      `الفترة: ${period.from} إلى ${period.to} (${periodDays(period)} يوماً)`,
      `عدد الطلبات: ${stats.count} — القطع: ${qty(stats.pieces)} — المستلم: ${qty(stats.received)} — المتبقي: ${qty(stats.remaining)}`,
      `القيمة الإجمالية: ${money(stats.value)} ${currency()} — معتمد: ${stats.approved} — بانتظار التأكيد: ${stats.pending} — ملغى: ${stats.rejected}`,
    ];
  }

  function exportExcel() {
    downloadSectionsXls(
      `laundry-orders-report-${todayIso()}.xls`,
      "تقرير الطلبات",
      "تقرير طلبات المغسلة",
      meta(),
      sections(),
    );
  }

  function exportCsv() {
    const rows = filtered.map((order) => {
      const pieces = orderPieces(order);
      return [
        order.reference || "",
        order.service_date || "",
        orderTitle(order),
        order.employee_code || "",
        orderStatusBadge(order).label,
        fulfillmentBadge(order).label,
        pieces.sent,
        pieces.received,
        pieces.remaining,
        Number(Number(order.subtotal || 0).toFixed(2)),
      ];
    });
    downloadCsv(
      `laundry-orders-${todayIso()}.csv`,
      toCsv(
        ["المرجع", "التاريخ", "الساكن", "رقم الموظف", "الحالة", "التسليم", "القطع", "المستلم", "المتبقي", "القيمة"],
        rows,
      ),
    );
  }

  return (
    <div className="stack">
      <Card>
        <div className="filter-grid">
          <Field label="من تاريخ">
            <input type="date" className="ui-input" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} />
          </Field>
          <Field label="إلى تاريخ">
            <input type="date" className="ui-input" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} />
          </Field>
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
          <div className="span-2">
            <SearchInput value={q} onChange={setQ} placeholder="بحث بالاسم أو المرجع أو الرقم..." />
          </div>
          <div className="span-2 row" style={{ gap: 6 }}>
            <Button size="sm" variant="soft" onClick={() => setDays(30)}>30 يوماً</Button>
            <Button size="sm" variant="soft" onClick={() => setDays(60)}>60 يوماً</Button>
            <Button size="sm" variant="soft" onClick={() => setDays(90)}>90 يوماً</Button>
            <Button size="sm" variant="outline" onClick={() => setPeriod({ from: "", to: todayIso() })}>من البداية</Button>
          </div>
        </div>
      </Card>

      <div className="metric-grid">
        <StatCard icon={ClipboardList} label="عدد الطلبات" value={stats.count} tone="primary" />
        <StatCard icon={FileSpreadsheet} label="القيمة الإجمالية" value={money(stats.value)} hint={currency()} tone="success" />
        <StatCard icon={Package} label="إجمالي القطع" value={qty(stats.pieces)} hint={`${qty(stats.received)} مستلمة`} tone="info" />
        <StatCard icon={Percent} label="نسبة التسليم" value={`${stats.pieces ? Math.round((stats.received / stats.pieces) * 1000) / 10 : 0}%`} hint={`${qty(stats.remaining)} متبقية`} tone="warn" />
      </div>

      <div className="report-actions">
        <Button size="sm" variant="outline" icon={Download} onClick={exportExcel} disabled={!filtered.length}>Excel</Button>
        <Button size="sm" variant="outline" icon={FileSpreadsheet} onClick={exportCsv} disabled={!filtered.length}>CSV</Button>
        <Button size="sm" variant="outline" icon={Printer} onClick={() => printReportSections("تقرير طلبات المغسلة", meta(), sections())} disabled={!filtered.length}>طباعة</Button>
        {!online && <Badge tone="warn">يعمل ببيانات محفوظة على الجهاز</Badge>}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={ChartColumn} title="لا توجد بيانات في هذه الفترة" hint="غيّر الفترة أو الحالة، أو سجّل طلبات جديدة." />
        </Card>
      ) : (
        <>
          <Panel title="ملخّص الحالات">
            <div className="row" style={{ gap: 6 }}>
              <Badge tone="warn">{stats.pending} بانتظار التأكيد</Badge>
              <Badge tone="good">{stats.approved} معتمد</Badge>
              <Badge tone="bad">{stats.rejected} ملغى</Badge>
              <Badge tone="primary">{stats.fullyDelivered} مكتمل التسليم</Badge>
              <Badge tone="muted">{stats.deliveredOrders} بدأ تسليمه</Badge>
            </div>
          </Panel>

          {services.length > 0 && (
            <Panel title="الكميات حسب الخدمة" subtitle="الأكثر استخداماً في الفترة">
              <div className="breakdown-list">
                {services.slice(0, 8).map((row) => (
                  <div key={`${row.service_item_id}-${row.name}`} className="breakdown-row">
                    <div className="bar-wrap">
                      <div className="bar-label">
                        <span>{row.name}</span>
                        <span>
                          {qty(row.quantity)} {row.unit} — {money(row.value)} {currency()}
                        </span>
                      </div>
                      <ProgressBar value={services[0].quantity ? (row.quantity / services[0].quantity) * 100 : 0} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>المرجع</th>
                  <th>التاريخ</th>
                  <th>الساكن</th>
                  <th>الحالة</th>
                  <th className="num">القطع</th>
                  <th className="num">مستلم</th>
                  <th className="num">متبقٍ</th>
                  <th className="num">القيمة</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <tr key={order.client_uuid}>
                    <td dir="ltr">{order.reference || order.client_uuid.slice(0, 6)}</td>
                    <td>{order.service_date}</td>
                    <td>{orderTitle(order)}</td>
                    <td>{orderStatusBadge(order).label}</td>
                    <td className="num">{qty(orderPieces(order).sent)}</td>
                    <td className="num">{qty(orderPieces(order).received)}</td>
                    <td className="num">{qty(orderPieces(order).remaining)}</td>
                    <td className="num">{money(order.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================== تقرير الساكنين ============================== */

function ResidentsReport({ employees, orders }: { employees: Employee[]; orders: LocalOrder[] }) {
  const [period, setPeriod] = useState<Period>(defaultResidentPeriod());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [includeInactive, setIncludeInactive] = useState(false);

  const safePeriod = ensureMinimumPeriod(period);
  const report = useMemo(
    () => buildResidentReport(employees, orders, period, includeInactive),
    [employees, orders, period, includeInactive],
  );

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return report.rows.filter((row) => {
      if (filter === "sent" && row.orders === 0) return false;
      if (filter === "zero" && row.orders > 0) return false;
      if (!term) return true;
      return (
        row.name.toLowerCase().includes(term) ||
        row.employee_code.toLowerCase().includes(term) ||
        row.housing_location.toLowerCase().includes(term) ||
        row.department.toLowerCase().includes(term)
      );
    });
  }, [report.rows, q, filter]);

  const totals = useMemo(() => {
    const residentCount = rows.length;
    const senders = rows.filter((row) => row.orders > 0).length;
    const pieces = rows.reduce((sum, row) => sum + row.pieces, 0);
    const received = rows.reduce((sum, row) => sum + row.received, 0);
    return {
      residents: residentCount,
      senders,
      nonSenders: residentCount - senders,
      orders: rows.reduce((sum, row) => sum + row.orders, 0),
      pieces,
      received,
      remaining: rows.reduce((sum, row) => sum + row.remaining, 0),
      value: rows.reduce((sum, row) => sum + row.value, 0),
      rate: pieces > 0 ? Math.round((received / pieces) * 1000) / 10 : 0,
    };
  }, [rows]);

  function setDays(days: number) {
    setPeriod({ from: daysAgoIso(days - 1), to: todayIso() });
  }

  function sections(): ReportSection[] {
    return [
      {
        headers: [
          "#",
          "الاسم",
          "رقم الموظف",
          "السكن",
          "عدد مرات الإرسال",
          "القطع المرسلة",
          "المستلمة",
          "المتبقية",
          "نسبة التسليم %",
          `القيمة (${currency()})`,
          "آخر إرسال",
          "آخر استلام",
        ],
        rows: rows.map((row, index) => [
          index + 1,
          row.name,
          row.employee_code,
          row.housing_location || row.department || "",
          row.orders,
          row.pieces,
          row.received,
          row.remaining,
          row.delivery_rate,
          Number(row.value.toFixed(2)),
          row.last_sent || "لم يرسل",
          row.last_received || "—",
        ]),
      },
      {
        heading: "ملخّص الخدمات المرسلة",
        headers: ["الخدمة", "الوحدة", "إجمالي الكمية", "عدد الساكنين"],
        rows: report.services.map((row) => [row.name, row.unit, row.quantity, row.residents]),
      },
    ];
  }

  function meta(): string[] {
    return [
      `الفترة: ${report.period.from} إلى ${report.period.to} (${report.days} يوماً) — الحد الأدنى ${MIN_RESIDENT_DAYS} يوماً`,
      `الساكنون: ${totals.residents} — أرسلوا: ${totals.senders} — لم يرسلوا: ${totals.nonSenders}`,
      `الطلبات: ${totals.orders} — القطع: ${qty(totals.pieces)} — المستلمة: ${qty(totals.received)} — نسبة التسليم: ${totals.rate}% — القيمة: ${money(totals.value)} ${currency()}`,
    ];
  }

  function exportExcel() {
    downloadSectionsXls(
      `laundry-residents-report-${todayIso()}.xls`,
      "تقرير الساكنين",
      "تقرير ساكنين المغسلة",
      meta(),
      sections(),
    );
  }

  function exportCsv() {
    downloadCsv(
      `laundry-residents-${todayIso()}.csv`,
      toCsv(
        ["#", "الاسم", "رقم الموظف", "السكن", "عدد مرات الإرسال", "القطع", "المستلمة", "المتبقية", "نسبة التسليم", "القيمة", "آخر إرسال"],
        rows.map((row, index) => [
          index + 1,
          row.name,
          row.employee_code,
          row.housing_location || row.department || "",
          row.orders,
          row.pieces,
          row.received,
          row.remaining,
          row.delivery_rate,
          Number(row.value.toFixed(2)),
          row.last_sent || "لم يرسل",
        ]),
      ),
    );
  }

  const periodAdjusted = safePeriod.from !== period.from || safePeriod.to !== period.to;

  return (
    <div className="stack">
      <Card>
        <div className="filter-grid">
          <Field label="من تاريخ">
            <input type="date" className="ui-input" value={period.from} onChange={(event) => setPeriod((current) => ({ ...current, from: event.target.value }))} />
          </Field>
          <Field label="إلى تاريخ">
            <input type="date" className="ui-input" value={period.to} onChange={(event) => setPeriod((current) => ({ ...current, to: event.target.value }))} />
          </Field>
          <div className="span-2">
            <SearchInput value={q} onChange={setQ} placeholder="بحث بالاسم أو رقم الموظف أو السكن..." />
          </div>
          <div className="span-2 row" style={{ gap: 6 }}>
            <Button size="sm" variant="soft" onClick={() => setDays(30)}>آخر 30 يوماً</Button>
            <Button size="sm" variant="soft" onClick={() => setDays(60)}>60 يوماً</Button>
            <Button size="sm" variant="soft" onClick={() => setDays(90)}>90 يوماً</Button>
            <Button size="sm" variant="outline" onClick={() => setDays(180)}>180 يوماً</Button>
          </div>
          <Field label="عرض الساكنين">
            <Select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              options={[
                { value: "all", label: "الكل" },
                { value: "sent", label: "من أرسل" },
                { value: "zero", label: "من لم يرسل (0)" },
              ]}
            />
          </Field>
          <Field label="غير النشطين">
            <Switch checked={includeInactive} onChange={setIncludeInactive} label="إظهار غير النشطين" />
          </Field>
        </div>
        <div className="period-note" style={{ marginTop: 10 }}>
          <AlertTriangle size={15} />
          <span>
            فترة التقرير: <b>{report.period.from}</b> إلى <b>{report.period.to}</b> ({report.days} يوماً). الحد الأدنى {MIN_RESIDENT_DAYS} يوماً — تُمدّ البداية تلقائياً إن كانت الفترة أقصر.
            {periodAdjusted ? " تم تعديل البداية لتلبية الحد الأدنى." : ""}
          </span>
        </div>
      </Card>

      <div className="metric-grid">
        <StatCard icon={UsersRound} label="عدد الساكنين" value={totals.residents} tone="primary" />
        <StatCard icon={Package} label="أرسلوا للمغسلة" value={totals.senders} hint={`${qty(totals.pieces)} قطعة`} tone="success" />
        <StatCard icon={AlertTriangle} label="لم يرسلوا (0)" value={totals.nonSenders} hint="خلال الفترة" tone={totals.nonSenders ? "danger" : "success"} />
        <StatCard icon={Percent} label="نسبة التسليم" value={`${totals.rate}%`} hint={`${qty(totals.received)} من ${qty(totals.pieces)}`} tone="info" />
      </div>

      <div className="report-actions">
        <Button size="sm" variant="outline" icon={Download} onClick={exportExcel} disabled={!rows.length}>Excel</Button>
        <Button size="sm" variant="outline" icon={FileSpreadsheet} onClick={exportCsv} disabled={!rows.length}>CSV</Button>
        <Button size="sm" variant="outline" icon={Printer} onClick={() => printReportSections("تقرير ساكنين المغسلة", meta(), sections())} disabled={!rows.length}>طباعة</Button>
        <Button
          size="sm"
          variant="soft"
          icon={Share2}
          onClick={() => shareText("تقرير ساكنين المغسلة", residentShareText(report))}
          disabled={!rows.length}
        >
          مشاركة
        </Button>
      </div>

      <Card className="resident-summary">
        <div className="row-between">
          <div>
            <strong style={{ fontSize: 13.5 }}>نسبة مشاركة الساكنين</strong>
            <div className="muted tiny">
              {totals.senders} من {totals.residents} أرسلوا أغراضهم خلال {report.days} يوماً
            </div>
          </div>
          <Badge tone={totals.nonSenders ? "warn" : "good"}>
            {totals.nonSenders ? `${totals.nonSenders} لم يرسل` : "الجميع أرسل"}
          </Badge>
        </div>
        <div className="progress" style={{ marginTop: 10 }}>
          <span style={{ width: `${totals.residents ? Math.round((totals.senders / totals.residents) * 100) : 0}%` }} />
        </div>
        <div className="row" style={{ gap: 14, marginTop: 8 }}>
          <span className="muted tiny">الطلبات: {totals.orders}</span>
          <span className="muted tiny">القيمة: {money(totals.value)} {currency()}</span>
          <span className="muted tiny">المتبقي: {qty(totals.remaining)}</span>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={UsersRound}
            title={employees.length ? "لا يوجد ساكنون مطابقون" : "لا توجد بيانات ساكنين"}
            hint={employees.length ? "جرّب تغيير البحث أو خيار العرض." : "اتصل بالإنترنت وحدّث بيانات الساكنين من الرئيسية."}
          />
        </Card>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>الساكن</th>
                <th>رقم الموظف</th>
                <th>السكن</th>
                <th className="num">مرات الإرسال</th>
                <th className="num">القطع</th>
                <th className="num">مستلم</th>
                <th className="num">متبقٍ</th>
                <th className="num">نسبة التسليم</th>
                <th className="num">القيمة</th>
                <th>آخر إرسال</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.employee_id || row.employee_code} className={row.orders === 0 ? "zero-row" : undefined}>
                  <td className="num">{index + 1}</td>
                  <td>
                    <span className="strong">{row.name}</span>
                    {!row.active && <span className="badge badge-muted" style={{ marginInlineStart: 6 }}>غير نشط</span>}
                  </td>
                  <td dir="ltr">{row.employee_code}</td>
                  <td>{row.housing_location || row.department || "—"}</td>
                  <td className={row.orders === 0 ? "num zero-highlight" : "num"}>{row.orders}</td>
                  <td className="num">{qty(row.pieces)}</td>
                  <td className="num">{qty(row.received)}</td>
                  <td className="num">{qty(row.remaining)}</td>
                  <td className="num">{row.delivery_rate}%</td>
                  <td className="num">{money(row.value)}</td>
                  <td>{row.last_sent || <span className="badge badge-bad">لم يرسل</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<LoadingBlock label="جارٍ تحميل التقارير..." />}>
      <ReportsInner />
    </Suspense>
  );
}
