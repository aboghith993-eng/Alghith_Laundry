"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Minus,
  Plus,
  Search,
  UserRound,
  WashingMachine,
  X,
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
  TextArea,
  TextInput,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import {
  createOrder,
  currency,
  findEmployees,
  getOrder,
  updateOrder,
} from "@/lib/offlineStore";
import { employeeCycle, shiftWarnings, todayIso } from "@/lib/shift";
import { money } from "@/lib/format";
import { canCreateOrder, canEditOrder } from "@/lib/permissions";
import type { Employee, OrderLine, ServiceItem } from "@/lib/types";

function NewOrderForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { session, snapshot, services, orders, online, toast } = useApp();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [personName, setPersonName] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const prefilled = useRef(false);

  const editing = useMemo(() => (editId ? getOrder(editId) : null), [editId, orders]);
  const allowed = editing ? canEditOrder(session, editing) : canCreateOrder(session);

  // تعبئة النموذج عند التعديل.
  useEffect(() => {
    if (!editId || prefilled.current) return;
    const order = getOrder(editId);
    if (!order) return;
    prefilled.current = true;
    const emp =
      (snapshot?.employees || []).find((item) => Number(item.id) === Number(order.employee_id)) ||
      ({
        id: Number(order.employee_id || 0),
        employee_code: order.employee_code || "",
        name: order.employee_name || order.person_name || "",
        person_type: "company",
      } as Employee);
    setEmployee(emp);
    setEmployeeQuery(order.employee_code || emp.employee_code || "");
    setServiceDate(order.service_date || todayIso());
    setPersonName(order.person_name || "");
    setNotes(order.notes || "");
    const values: Record<string, number> = {};
    for (const [key, line] of Object.entries(order.items || {})) {
      values[String(line.service_item_id ?? key)] = Number(line.quantity || 0);
    }
    setQuantities(values);
  }, [editId, snapshot]);

  // الخدمات المتاحة = الخدمات الفعّالة + أي خدمة مستخدمة في الطلب قيد التعديل.
  const available = useMemo<ServiceItem[]>(() => {
    const list = services.filter((item) => item.active !== false);
    if (editing) {
      for (const line of Object.values(editing.items || {})) {
        const id = Number(line.service_item_id || 0);
        if (id && !list.some((item) => Number(item.id) === id)) {
          list.push({
            id,
            name: line.item_name || "خدمة",
            unit: line.unit || "قطعة",
            rate: Number(line.unit_price || 0),
            active: false,
          });
        }
      }
    }
    return list;
  }, [services, editing]);

  const results = useMemo(() => {
    const query = employeeQuery.trim();
    if (!query) return [];
    return findEmployees(query, 12);
  }, [employeeQuery, snapshot]);

  const selectedLines = useMemo(() => {
    return available
      .map((item) => ({ service: item, quantity: Number(quantities[String(item.id)] || 0) }))
      .filter((row) => row.quantity > 0);
  }, [available, quantities]);

  const total = selectedLines.reduce(
    (sum, row) => sum + row.quantity * Number(row.service.rate || 0),
    0,
  );
  const totalPieces = selectedLines.reduce((sum, row) => sum + row.quantity, 0);

  const cycle = employee ? employeeCycle(employee, serviceDate) : null;
  const warnings = useMemo(
    () => (employee ? shiftWarnings(employee, serviceDate) : []),
    [employee, serviceDate],
  );

  function setQuantity(serviceId: number, value: number) {
    setQuantities((current) => {
      const next = { ...current };
      const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
      if (safe <= 0) delete next[String(serviceId)];
      else next[String(serviceId)] = safe;
      return next;
    });
  }

  function selectEmployee(item: Employee) {
    setEmployee(item);
    setEmployeeQuery(item.employee_code || "");
    setError("");
  }

  async function handleSave() {
    setError("");
    if (!employee) {
      setError("اختر الساكن/الموظف أولاً بالبحث بالاسم أو رقم الموظف.");
      return;
    }
    if (!selectedLines.length) {
      setError("أضف صنفاً واحداً على الأقل بالكمية.");
      return;
    }
    if ((employee.person_type || "") === "general" && !personName.trim()) {
      setError("للسجل العام اكتب اسم الزائر أو الضيف الفعلي.");
      return;
    }

    const items: Record<string, OrderLine> = {};
    for (const row of selectedLines) {
      const unitPrice = Number(row.service.rate || 0);
      items[String(row.service.id)] = {
        service_item_id: Number(row.service.id),
        item_name: row.service.name,
        unit: row.service.unit || "قطعة",
        quantity: row.quantity,
        unit_price: unitPrice,
        line_total: row.quantity * unitPrice,
        received_quantity: 0,
      };
    }

    setSaving(true);
    try {
      const result = editing
        ? updateOrder(editing.client_uuid, {
            employee,
            person_name: personName.trim(),
            service_date: serviceDate,
            notes: notes.trim(),
            items,
          })
        : createOrder({
            employee,
            person_name: personName.trim(),
            service_date: serviceDate,
            notes: notes.trim(),
            items,
          });

      if (!result.ok || !result.order) {
        setError(result.error || "تعذر حفظ الطلب.");
        return;
      }
      toast(
        editing
          ? "تم تعديل الطلب. ستُزامَن التغييرات تلقائياً."
          : online
            ? "تم حفظ الطلب — تجري المزامنة."
            : "تم حفظ الطلب على الجهاز وسيُزامن عند عودة الاتصال.",
        "success",
      );
      router.replace(`/order?id=${encodeURIComponent(result.order.client_uuid)}`);
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <div className="stack">
        <PageHead title={editing ? "تعديل الطلب" : "طلب جديد"} />
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title={editing ? "لا يمكن تعديل هذا الطلب" : "لا تملك صلاحية إنشاء طلبات"}
            hint={
              editing
                ? "التعديل متاح للطلبات التي لم تُعتمد ولم يبدأ تسليمها فقط."
                : "إنشاء الطلبات متاح لمدير النظام ومتعهد المغسلة."
            }
            action={
              <Link href={editing ? `/order?id=${encodeURIComponent(editing.client_uuid)}` : "/home"} className="btn btn-primary btn-sm">
                رجوع
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  if (editId && !editing) {
    return (
      <div className="stack">
        <PageHead title="تعديل الطلب" />
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="الطلب غير موجود على هذا الجهاز"
            hint="ربما حُذف أو لم تُزامن بياناته بعد."
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

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow={editing ? "تعديل طلب قائم" : "طلب جديد"}
        title={editing ? "تعديل الطلب" : "تسجيل طلب مغسلة"}
        subtitle="ابحث عن الساكن، حدّد الأصناف والكميات، ثم احفظ — يعمل دون إنترنت."
        actions={
          <Link href={editing ? `/order?id=${encodeURIComponent(editing.client_uuid)}` : "/orders"} className="btn btn-ghost btn-sm">
            إلغاء
          </Link>
        }
      />

      <Panel title="الساكن / الموظف" subtitle="بحث بالاسم أو رقم الموظف أو الشركة">
        {employee ? (
          <div className="stack" style={{ gap: 10 }}>
            <div className="quick-user" style={{ marginBottom: 0 }}>
              <span className="avatar large">{(employee.name || "؟").slice(0, 1)}</span>
              <div className="grow">
                <strong>{employee.name || "بدون اسم"}</strong>
                <small>
                  {employee.employee_code} — {employee.company || employee.department || "بدون شركة"}
                </small>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setEmployee(null);
                  setEmployeeQuery("");
                }}
                aria-label="تغيير الموظف"
              >
                <X size={16} />
              </button>
            </div>

            {employee.housing_location && (
              <div className="muted tiny">موقع السكن: {employee.housing_location}</div>
            )}

            {cycle && (
              <div className="row" style={{ gap: 6 }}>
                <Badge tone={cycle.known ? (cycle.is_work ? "good" : "warn") : "muted"}>
                  {cycle.known ? `الدوام: ${cycle.status}` : employee.status_label || "حالة الدوام غير محددة"}
                </Badge>
                {cycle.known && (
                  <Badge tone="muted">
                    اليوم {cycle.cycle_day} من {cycle.cycle_length}
                  </Badge>
                )}
                {cycle.known && (
                  <Badge tone={cycle.tomorrow_is_work ? "good" : "warn"}>
                    غداً: {cycle.tomorrow_status}
                  </Badge>
                )}
                {employee.service_type && <Badge tone="info">{employee.service_type}</Badge>}
              </div>
            )}

            {warnings.length > 0 && (
              <div className="alert alert-warn">
                <AlertTriangle size={16} />
                <div className="grow">
                  {warnings.map((warning) => (
                    <div key={warning} className="small">
                      • {warning}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="search-box">
              <Search size={17} />
              <input
                value={employeeQuery}
                onChange={(event) => setEmployeeQuery(event.target.value)}
                placeholder="اكتب الاسم أو رقم الموظف..."
                inputMode="search"
                autoFocus
              />
              {employeeQuery && (
                <button type="button" className="icon-plain" onClick={() => setEmployeeQuery("")} aria-label="مسح">
                  <X size={15} />
                </button>
              )}
            </div>
            {results.length > 0 ? (
              <div className="service-list" style={{ display: "grid", gap: 6 }}>
                {results.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="service-pick"
                    onClick={() => selectEmployee(item)}
                    style={{ textAlign: "start" }}
                  >
                    <div className="service-pick-info">
                      <strong>{item.name}</strong>
                      <small>
                        {item.employee_code} — {item.company || item.department || ""}
                        {item.housing_location ? ` — ${item.housing_location}` : ""}
                      </small>
                    </div>
                    <UserRound size={17} className="chev" />
                  </button>
                ))}
              </div>
            ) : employeeQuery.trim() ? (
              <div className="alert alert-info">
                <UserRound size={16} />
                <span>لا يوجد ساكن مطابق. تأكد من الاسم أو رقم الموظف، أو حدّث بيانات الساكنين من الرئيسية.</span>
              </div>
            ) : (
              <div className="muted tiny">اكتب حرفين على الأقل للبحث. تظهر النتائج من بيانات الساكنين المحفوظة على الجهاز.</div>
            )}
          </div>
        )}
      </Panel>

      <Panel title="بيانات الطلب">
        <div className="filter-grid">
          <Field label="تاريخ الخدمة" required>
            <TextInput
              type="date"
              value={serviceDate}
              onChange={(event) => setServiceDate(event.target.value)}
              max="2100-12-31"
            />
          </Field>
          <Field
            label={employee?.person_type === "general" ? "اسم الزائر / الضيف" : "اسم المستلم (اختياري)"}
            required={employee?.person_type === "general"}
            hint={employee?.person_type === "general" ? undefined : "إن تُرك فارغاً يُستخدم اسم الموظف المسجل."}
          >
            <TextInput
              value={personName}
              onChange={(event) => setPersonName(event.target.value)}
              placeholder={employee?.person_type === "general" ? "مطلوب للسجل العام" : employee?.name || "اسم المستلم"}
            />
          </Field>
          <Field label="ملاحظات" className="span-2">
            <TextArea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="ملاحظات للمغسلة (اختياري)..."
            />
          </Field>
        </div>
      </Panel>

      <Panel
        title="الأصناف والكميات"
        subtitle={`${available.length} خدمة متاحة — ${selectedLines.length} مختارة`}
        actions={
          <Badge tone={available.length ? "primary" : "bad"}>
            {selectedLines.length ? `${totalPieces} قطعة` : "لم يُحدد صنف"}
          </Badge>
        }
      >
        {available.length === 0 ? (
          <EmptyState
            icon={WashingMachine}
            title="لا توجد خدمات محفوظة"
            hint="حدّث بيانات الخدمات والأسعار من الخادم، أو أضف الخدمات من صفحة الخدمات (مدير النظام)."
          />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {available.map((item) => {
              const value = Number(quantities[String(item.id)] || 0);
              return (
                <div key={item.id} className={value > 0 ? "service-pick selected" : "service-pick"}>
                  <div className="service-pick-info">
                    <strong>
                      {item.name}{" "}
                      {item.active === false && (
                        <span className="badge badge-warn" style={{ marginInlineStart: 6 }}>
                          غير مفعّلة
                        </span>
                      )}
                    </strong>
                    <small>
                      {money(item.rate)} {currency()} / {item.unit || "قطعة"}
                      {item.code ? ` — ${item.code}` : ""}
                    </small>
                  </div>
                  <div className="qty-picker">
                    <button
                      type="button"
                      onClick={() => setQuantity(item.id, value - 1)}
                      aria-label={`تقليل ${item.name}`}
                      disabled={value <= 0}
                    >
                      <Minus size={15} />
                    </button>
                    <input
                      value={value || ""}
                      onChange={(event) => {
                        const parsed = Number(event.target.value);
                        setQuantity(item.id, Number.isFinite(parsed) ? parsed : 0);
                      }}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`كمية ${item.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(item.id, value + 1)}
                      aria-label={`زيادة ${item.name}`}
                    >
                      <Plus size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <div className="total-bar">
        <div>
          <span>إجمالي الطلب</span>
          <div className="muted tiny">
            {totalPieces} قطعة — {selectedLines.length} صنف
          </div>
        </div>
        <strong>
          {money(total)} <small className="muted" style={{ fontSize: 11 }}>{currency()}</small>
        </strong>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!online && (
        <div className="alert alert-info">
          <CalendarDays size={16} />
          <span>أنت دون اتصال — سيُحفظ الطلب محلياً ويُرسل تلقائياً عند عودة الاتصال.</span>
        </div>
      )}

      <div className="row" style={{ gap: 8 }}>
        <Button
          size="lg"
          block
          loading={saving}
          icon={editing ? Check : Plus}
          disabled={!available.length}
          onClick={() => void handleSave()}
        >
          {editing ? "حفظ التعديل" : "حفظ الطلب"}
        </Button>
        <Link
          href={editing ? `/order?id=${encodeURIComponent(editing.client_uuid)}` : "/orders"}
          className="btn btn-ghost btn-lg"
        >
          إلغاء
        </Link>
      </div>
    </div>
  );
}

export default function NewOrderPage() {
  return (
    <Suspense fallback={<LoadingBlock label="جارٍ تحميل نموذج الطلب..." />}>
      <NewOrderForm />
    </Suspense>
  );
}
