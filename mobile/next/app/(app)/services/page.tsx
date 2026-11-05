"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CloudUpload,
  Edit3,
  Eye,
  EyeOff,
  Package,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Trash2,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Modal,
  PageHead,
  Panel,
  StatCard,
  Switch,
  TextInput,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import {
  createService,
  currency,
  deleteService,
  toggleService,
  updateService,
} from "@/lib/offlineStore";
import { money } from "@/lib/format";
import { canManageServices } from "@/lib/permissions";
import type { ServiceItem } from "@/lib/types";

type FormState = {
  id: number | null;
  name: string;
  code: string;
  unit: string;
  rate: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  code: "",
  unit: "قطعة",
  rate: "",
  active: true,
};

export default function ServicesPage() {
  const { session, services, snapshot, online, syncing, pendingServices, toast, refreshSnapshot } = useApp();
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ServiceItem | null>(null);

  const allowed = canManageServices(session);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return services
      .filter((item) => (showInactive ? true : item.active !== false))
      .filter((item) => {
        if (!term) return true;
        return (
          (item.name || "").toLowerCase().includes(term) ||
          (item.code || "").toLowerCase().includes(term)
        );
      })
      .sort((a, b) => {
        if ((a.active !== false) !== (b.active !== false)) return a.active === false ? 1 : -1;
        return (a.name || "").localeCompare(b.name || "", "ar");
      });
  }, [services, q, showInactive]);

  const activeCount = services.filter((item) => item.active !== false).length;
  const average = activeCount
    ? services
        .filter((item) => item.active !== false)
        .reduce((sum, item) => sum + Number(item.rate || 0), 0) / activeCount
    : 0;

  if (!allowed) {
    return (
      <div className="stack">
        <PageHead title="الخدمات والأسعار" />
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="هذه الصفحة لمدير النظام فقط"
            hint="إضافة الخدمات وتعديل الأسعار متاح لمدير النظام. تواصل معه لتحديث قائمة الخدمات."
            action={
              <Link href="/home" className="btn btn-primary btn-sm">
                العودة للرئيسية
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setError("");
    setFormOpen(true);
  }

  function openEdit(item: ServiceItem) {
    setForm({
      id: Number(item.id),
      name: item.name || "",
      code: item.code || "",
      unit: item.unit || "قطعة",
      rate: String(item.rate ?? ""),
      active: item.active !== false,
    });
    setError("");
    setFormOpen(true);
  }

  function submitForm() {
    setError("");
    const rate = Number(form.rate);
    if (!form.name.trim()) {
      setError("اكتب اسم الخدمة.");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setError("أدخل سعراً صحيحاً غير سالب.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim(),
        unit: form.unit.trim() || "قطعة",
        rate,
        active: form.active,
      };
      const result =
        form.id === null ? createService(payload) : updateService(form.id, payload);
      if (!result.ok) {
        setError(result.error || "تعذر حفظ الخدمة.");
        return;
      }
      toast(
        form.id === null
          ? "تمت إضافة الخدمة. ستُزامن تلقائياً."
          : "تم حفظ تعديل الخدمة والسعر.",
        "success",
      );
      setFormOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function handleToggle(item: ServiceItem) {
    const result = toggleService(Number(item.id));
    if (!result.ok) {
      toast(result.error || "تعذر تغيير حالة الخدمة.", "error");
      return;
    }
    toast(
      item.active === false ? "تم تفعيل الخدمة." : "تم إيقاف الخدمة عن الطلبات الجديدة.",
      "success",
    );
  }

  function handleDelete() {
    if (!deleteTarget) return;
    const result = deleteService(Number(deleteTarget.id));
    if (!result.ok) {
      toast(result.error || "تعذر حذف الخدمة.", "error");
      return;
    }
    toast("تم حذف الخدمة من القائمة. الطلبات السابقة تحتفظ بأسعارها.", "success");
    setDeleteTarget(null);
  }

  return (
    <div className="stack-lg">
      <Link href="/settings" className="back-link">
        <ArrowRight size={15} /> الإعدادات
      </Link>

      <PageHead
        eyebrow="مدير النظام"
        title="الخدمات والأسعار"
        subtitle="إضافة الخدمات وتعديل أسعارها — تعمل دون اتصال وتُزامن تلقائياً."
        actions={
          <>
            {online && (
              <Button
                size="sm"
                variant="outline"
                icon={RefreshCw}
                loading={syncing}
                onClick={() => void refreshSnapshot()}
              >
                تحديث
              </Button>
            )}
            <Button size="sm" icon={Plus} onClick={openCreate}>
              خدمة جديدة
            </Button>
          </>
        }
      />

      <div className="metric-grid">
        <StatCard icon={Tags} label="إجمالي الخدمات" value={services.length} tone="primary" />
        <StatCard icon={Package} label="خدمات مفعّلة" value={activeCount} tone="success" />
        <StatCard
          icon={CloudUpload}
          label="بانتظار المزامنة"
          value={pendingServices}
          tone={pendingServices ? "warn" : "muted"}
          hint={pendingServices ? "ستُرسل تلقائياً" : "كل التغييرات محفوظة"}
        />
        <StatCard icon={Tags} label="متوسط السعر" value={money(average)} hint={currency()} tone="info" />
      </div>

      {!online && (
        <div className="alert alert-info">
          <CloudUpload size={17} />
          <span>دون اتصال — يمكنك إضافة وتعديل الخدمات الآن، وستُزامن كل التغييرات تلقائياً عند عودة الإنترنت.</span>
        </div>
      )}

      {pendingServices > 0 && (
        <div className="alert alert-warn">
          <CloudUpload size={17} />
          <span>{pendingServices} تغييراً على الخدمات بانتظار الإرسال. لا تُغلق التطبيق قبل المزامنة إن أمكن.</span>
        </div>
      )}

      <Card>
        <div className="row" style={{ gap: 8 }}>
          <div className="search-box grow">
            <Search size={17} />
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="بحث باسم الخدمة أو الرمز..."
              inputMode="search"
            />
          </div>
          <Button
            size="sm"
            variant={showInactive ? "soft" : "outline"}
            icon={showInactive ? Eye : EyeOff}
            onClick={() => setShowInactive((value) => !value)}
          >
            {showInactive ? "إخفاء الموقوفة" : "إظهار الموقوفة"}
          </Button>
        </div>
        {snapshot?.built_at && (
          <div className="muted tiny" style={{ marginTop: 8 }}>
            آخر تحديث لبيانات الخدمات: {new Date(snapshot.built_at).toLocaleString("ar-EG")}
          </div>
        )}
      </Card>

      <Panel
        title="قائمة الخدمات"
        subtitle={`${filtered.length} خدمة معروضة — الأسعار بالـ${currency()}`}
        actions={<Badge tone="primary">{activeCount} مفعّلة</Badge>}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={Tags}
            title={services.length ? "لا توجد خدمات مطابقة" : "لا توجد خدمات بعد"}
            hint={
              services.length
                ? "جرّب تغيير البحث أو إظهار الخدمات الموقوفة."
                : "أضف أول خدمة وسعرها، وستظهر مباشرة في نموذج الطلبات."
            }
            action={
              <Button size="sm" icon={Plus} onClick={openCreate}>
                إضافة خدمة
              </Button>
            }
          />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {filtered.map((item) => (
              <div key={item.id} className={item.active === false ? "service-row inactive" : "service-row"}>
                <div className="service-main">
                  <strong>
                    {item.name}
                    {item.active === false && (
                      <span className="badge badge-muted" style={{ marginInlineStart: 6 }}>موقوفة</span>
                    )}
                    {Number(item.id) < 0 && (
                      <span className="badge badge-warn" style={{ marginInlineStart: 6 }}>بانتظار المزامنة</span>
                    )}
                  </strong>
                  <small>
                    {item.code || "بدون رمز"} — {item.unit || "قطعة"}
                  </small>
                </div>
                <div className="service-rate">
                  {money(item.rate)} <small className="muted tiny">{currency()}</small>
                </div>
                <div className="service-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToggle(item)}
                    title={item.active === false ? "تفعيل" : "إيقاف"}
                  >
                    {item.active === false ? <Eye size={15} /> : <EyeOff size={15} />}
                  </Button>
                  <Button size="sm" variant="soft" icon={Edit3} onClick={() => openEdit(item)}>
                    تعديل
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    onClick={() => setDeleteTarget(item)}
                    aria-label={`حذف ${item.name}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="alert alert-info">
        <Tags size={16} />
        <span>
          تعديل السعر لا يغيّر قيمة الطلبات السابقة؛ كل طلب يحتفظ بسعر الخدمة المسجل وقت إنشائه.
        </span>
      </div>

      <Modal
        open={formOpen}
        title={form.id === null ? "إضافة خدمة وسعر" : "تعديل الخدمة والسعر"}
        subtitle="تظهر الخدمات المفعّلة مباشرة في نموذج إنشاء الطلب."
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={busy}>
              إلغاء
            </Button>
            <Button loading={busy} onClick={submitForm}>
              {form.id === null ? "إضافة الخدمة" : "حفظ التعديل"}
            </Button>
          </>
        }
      >
        <div className="stack" style={{ gap: 10 }}>
          <Field label="اسم الخدمة" required>
            <TextInput
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="مثال: غسيل قميص"
              autoFocus
            />
          </Field>
          <div className="filter-grid">
            <Field label="الرمز" hint="اختياري — يُولَّد تلقائياً من الاسم.">
              <TextInput
                value={form.code}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
                placeholder="SHIRT"
                dir="ltr"
              />
            </Field>
            <Field label="الوحدة">
              <TextInput
                value={form.unit}
                onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))}
                placeholder="قطعة"
              />
            </Field>
            <Field label={`السعر (${currency()})`} required>
              <TextInput
                value={form.rate}
                onChange={(event) => setForm((current) => ({ ...current, rate: event.target.value }))}
                inputMode="decimal"
                placeholder="0.00"
              />
            </Field>
            <Field label="الحالة">
              <Switch
                checked={form.active}
                onChange={(value) => setForm((current) => ({ ...current, active: value }))}
                label="خدمة مفعّلة"
              />
            </Field>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="alert alert-info">
            <CloudUpload size={15} />
            <span>الحفظ فوري على الجهاز، وتُرسل التغييرات للخادم تلقائياً عند توفر الاتصال.</span>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="حذف الخدمة"
        message={`سيتم إيقاف الخدمة «${deleteTarget?.name || ""}» وحذفها من قائمة الطلبات الجديدة. الطلبات السابقة لا تتأثر.`}
        confirmLabel="حذف الخدمة"
        tone="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
