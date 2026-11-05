"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  CloudUpload,
  CircleDollarSign,
  Package,
  Plus,
  RefreshCw,
  Settings,
  Tags,
  UserRound,
  UsersRound,
  WashingMachine,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHead, SectionTitle, StatCard } from "@/components/ui";
import OrderCard from "@/components/OrderCard";
import { useApp } from "@/lib/store";
import { currency, orderRemaining } from "@/lib/offlineStore";
import { money, timeAgo } from "@/lib/format";
import { toIso } from "@/lib/shift";
import { buildResidentReport, defaultResidentPeriod, orderStats } from "@/lib/report";
import { canCreateOrder, canViewSettings, roleLabel } from "@/lib/permissions";

export default function HomePage() {
  const { session, snapshot, orders, services, pending, pendingServices, online, syncing, lastSync, lastError, syncNow, refreshSnapshot } =
    useApp();

  const today = toIso(new Date());
  const monthStart = `${today.slice(0, 7)}-01`;
  const employees = snapshot?.employees || [];

  const todayOrders = useMemo(
    () => orders.filter((order) => order.service_date === today),
    [orders, today],
  );
  const monthOrders = useMemo(
    () => orders.filter((order) => order.service_date >= monthStart && order.service_date <= today),
    [orders, monthStart, today],
  );
  const monthStats = useMemo(() => orderStats(monthOrders), [monthOrders]);
  const pendingOrders = useMemo(
    () => orders.filter((order) => order.status === "pending"),
    [orders],
  );
  const awaitingDelivery = useMemo(
    () => orders.filter((order) => order.status !== "rejected" && orderRemaining(order) > 0),
    [orders],
  );
  const residents = useMemo(() => {
    const report = buildResidentReport(employees, orders, defaultResidentPeriod(), false);
    return report;
  }, [employees, orders]);

  const recent = orders.slice(0, 5);
  const displayName = session?.full_name || session?.name || session?.username || "بك";
  const companyName = typeof session?.company === "string" ? session.company : "";

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={companyName || roleLabel(session)}
        title={`مرحباً، ${displayName}`}
        subtitle={`اليوم ${today} — ملخّص سريع لحركة المغسلة`}
        actions={
          canCreateOrder(session) ? (
            <Link href="/new" className="btn btn-primary btn-sm">
              <Plus size={16} /> طلب جديد
            </Link>
          ) : undefined
        }
      />

      {!snapshot && (
        <div className="alert alert-warn">
          <AlertTriangle size={17} />
          <div className="grow">
            <strong>لم تُحمّل بيانات الساكنين بعد.</strong>
            <div className="small">اتصل بالإنترنت واضغط تحديث البيانات لتحميل الساكنين والخدمات والأسعار.</div>
          </div>
          <Button size="sm" variant="outline" loading={syncing} onClick={() => void refreshSnapshot()}>
            تحديث
          </Button>
        </div>
      )}

      <div className="metric-grid">
        <StatCard icon={CalendarDays} label="طلبات اليوم" value={todayOrders.length} hint={`${todayOrders.reduce((sum, o) => sum + Object.keys(o.items).length, 0)} بند`} tone="primary" />
        <StatCard
          icon={ClipboardList}
          label="بانتظار التأكيد"
          value={pendingOrders.length}
          hint="تحتاج مراجعة واعتماد"
          tone={pendingOrders.length ? "warn" : "success"}
        />
        <StatCard
          icon={Package}
          label="بانتظار التسليم"
          value={awaitingDelivery.length}
          hint="قطع لم تُستلم كاملة"
          tone={awaitingDelivery.length ? "info" : "success"}
        />
        <StatCard
          icon={CircleDollarSign}
          label="قيمة الشهر"
          value={money(monthStats.value)}
          hint={currency()}
          tone="success"
        />
      </div>

      <Card className="sync-card">
        <div className="row-between">
          <div className="row" style={{ gap: 10 }}>
            <span className={online ? "sync-orb" : "sync-orb off"}>
              <CloudUpload size={19} />
            </span>
            <div>
              <strong style={{ fontSize: 13.5 }}>{online ? "المزامنة التلقائية مفعّلة" : "يعمل دون اتصال"}</strong>
              <div className="muted tiny">
                {lastSync ? `آخر مزامنة ${timeAgo(lastSync)}` : "لم تتم مزامنة بعد"}
                {snapshot?.built_at ? ` — بيانات محفوظة من ${timeAgo(snapshot.built_at)}` : ""}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {(pending > 0 || pendingServices > 0) && (
              <Badge tone="warn">
                {pending + pendingServices} بانتظار الإرسال
              </Badge>
            )}
            <Button size="sm" variant="outline" loading={syncing} icon={RefreshCw} onClick={() => void syncNow()}>
              مزامنة
            </Button>
          </div>
        </div>
        {lastError && (
          <div className="sync-note error" style={{ marginTop: 10 }}>
            <AlertTriangle size={13} />
            <span>{lastError}</span>
          </div>
        )}
        <div className="row" style={{ marginTop: 10, gap: 14 }}>
          <span className="muted tiny">الساكنون: {employees.length}</span>
          <span className="muted tiny">الخدمات: {services.filter((s) => s.active !== false).length}</span>
          <span className="muted tiny">الطلبات المحفوظة: {orders.length}</span>
        </div>
      </Card>

      <div>
        <SectionTitle title="إجراءات سريعة" hint="كل ما تحتاجه للعمل اليومي" />
        <div className="quick-grid">
          {canCreateOrder(session) && (
            <Link href="/new" className="quick-tile primary">
              <span className="quick-icon">
                <Plus size={20} />
              </span>
              <strong>تسجيل طلب</strong>
              <small>إرسال أغراض للمغسلة</small>
            </Link>
          )}
          <Link href="/orders" className="quick-tile">
            <span className="quick-icon">
              <ClipboardList size={20} />
            </span>
            <strong>الطلبات</strong>
            <small>بحث ومتابعة وتسليم</small>
          </Link>
          <Link href="/reports" className="quick-tile">
            <span className="quick-icon">
              <ChartColumn size={20} />
            </span>
            <strong>التقارير</strong>
            <small>قيم وفترات وتصدير</small>
          </Link>
          <Link href="/reports?tab=residents" className="quick-tile">
            <span className="quick-icon">
              <UsersRound size={20} />
            </span>
            <strong>تقرير الساكنين</strong>
            <small>30 يوماً — يشمل من لم يرسل</small>
          </Link>
          {canViewSettings(session) && (
            <Link href="/services" className="quick-tile">
              <span className="quick-icon">
                <Tags size={20} />
              </span>
              <strong>الخدمات والأسعار</strong>
              <small>إضافة وتعديل الأسعار</small>
            </Link>
          )}
          {canViewSettings(session) && (
            <Link href="/settings" className="quick-tile">
              <span className="quick-icon">
                <Settings size={20} />
              </span>
              <strong>الإعدادات</strong>
              <small>الخادم والمزامنة والحساب</small>
            </Link>
          )}
          <Link href="/account" className="quick-tile">
            <span className="quick-icon">
              <UserRound size={20} />
            </span>
            <strong>حسابي</strong>
            <small>رمز الدخول والقفل</small>
          </Link>
        </div>
      </div>

      <Card className="resident-summary">
        <div className="row-between">
          <div>
            <strong style={{ fontSize: 13.5 }}>حركة الساكنين — آخر 30 يوماً</strong>
            <div className="muted tiny">
              {residents.period.from} إلى {residents.period.to}
            </div>
          </div>
          <Link href="/reports?tab=residents" className="back-link" style={{ margin: 0 }}>
            التقرير الكامل <ArrowLeft size={14} />
          </Link>
        </div>
        <div className="resident-mini">
          <div>
            <span>الساكنون</span>
            <strong>{residents.totals.residents}</strong>
          </div>
          <div>
            <span>أرسلوا</span>
            <strong style={{ color: "var(--success)" }}>{residents.totals.senders}</strong>
          </div>
          <div>
            <span>لم يرسلوا</span>
            <strong style={{ color: "var(--danger)" }}>{residents.totals.nonSenders}</strong>
          </div>
          <div>
            <span>نسبة التسليم</span>
            <strong>{residents.totals.delivery_rate}%</strong>
          </div>
        </div>
        <div className="progress" style={{ marginTop: 10 }}>
          <span style={{ width: `${Math.min(100, residents.totals.delivery_rate)}%` }} />
        </div>
      </Card>

      {recent.length > 0 ? (
        <div>
          <SectionTitle
            title="أحدث الطلبات"
            hint={`${orders.length} طلباً محفوظاً على الجهاز`}
            action={
              <Link href="/orders" className="back-link" style={{ margin: 0 }}>
                عرض الكل <ArrowLeft size={14} />
              </Link>
            }
          />
          <div className="order-list">
            {recent.map((order) => (
              <OrderCard key={order.client_uuid} order={order} />
            ))}
          </div>
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={WashingMachine}
            title="لا توجد طلبات محفوظة بعد"
            hint={
              canCreateOrder(session)
                ? "ابدأ بتسجيل أول طلب — يعمل دون إنترنت ويُزامن تلقائياً."
                : "ستظهر الطلبات هنا فور تحميل البيانات ومزامنتها."
            }
            action={
              canCreateOrder(session) ? (
                <Link href="/new" className="btn btn-primary btn-sm">
                  <Plus size={16} /> تسجيل طلب
                </Link>
              ) : undefined
            }
          />
        </Card>
      )}
    </div>
  );
}
