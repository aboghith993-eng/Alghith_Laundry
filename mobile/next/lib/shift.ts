/* حساب دورة دوام الموظف — نسخة مطابقة لمنطق الخادم (app.py: employee_cycle). */

import type { Employee } from "./types";

/** أنواع الخدمة المعتمدة لخدمة المغسلة السكنية. */
export const HOUSING_SERVICE_TYPES = ["سكن", "نقل-سكن"];

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

export type CycleResult = {
  work_days: number;
  rest_days: number;
  cycle_length: number;
  cycle_day: number;
  is_work: boolean;
  status: string;
  tomorrow_cycle_day: number;
  tomorrow_is_work: boolean;
  tomorrow_status: string;
  known: boolean;
};

/** يحسب يوم الدورة وحالة الدوام ليوم معيّن. */
export function employeeCycle(employee: Employee | null | undefined, onDate?: string): CycleResult {
  const result: CycleResult = {
    work_days: 0,
    rest_days: 0,
    cycle_length: 0,
    cycle_day: 0,
    is_work: false,
    status: "",
    tomorrow_cycle_day: 0,
    tomorrow_is_work: false,
    tomorrow_status: "",
    known: false,
  };
  if (!employee) return result;

  const workDays = Number(employee.work_days || 0);
  const restDays = Number(employee.rest_days || 0);
  result.work_days = workDays;
  result.rest_days = restDays;
  const cycleLength = workDays + restDays;
  result.cycle_length = cycleLength;
  if (cycleLength <= 0) {
    result.status = employee.status_label || "";
    result.known = !!employee.status_label;
    return result;
  }

  const anchor = parseDate(employee.cycle_anchor || employee.cycle_start);
  if (!anchor) {
    result.status = employee.status_label || "";
    result.known = !!employee.status_label;
    return result;
  }

  const target = parseDate(onDate) || new Date();
  const day = (((diffDays(target, anchor) % cycleLength) + cycleLength) % cycleLength) + 1;
  result.cycle_day = day;
  result.is_work = day <= workDays;
  result.status = result.is_work ? "دوام" : "راحة";

  const next = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1);
  const nextDay = (((diffDays(next, anchor) % cycleLength) + cycleLength) % cycleLength) + 1;
  result.tomorrow_cycle_day = nextDay;
  result.tomorrow_is_work = nextDay <= workDays;
  result.tomorrow_status = result.tomorrow_is_work ? "دوام" : "راحة";
  result.known = true;
  return result;
}

/** تنبيهات توافق نوع الخدمة ومرحلة الراحة — تُعرض ولا تمنع إنشاء الطلب. */
export function shiftWarnings(employee: Employee | null | undefined, serviceDate: string): string[] {
  const warnings: string[] = [];
  if (!employee) return warnings;

  const serviceType = (employee.service_type || "").trim();
  const housing = (employee.housing_location || "").trim();
  const personType = employee.person_type || "company";

  if (personType !== "general" && serviceType && !HOUSING_SERVICE_TYPES.includes(serviceType)) {
    warnings.push(`نوع خدمة الموظف «${serviceType}» وليس «سكن»، فهذه الخدمة تخص السكن فقط.`);
  }
  if (
    personType !== "general" &&
    serviceType &&
    HOUSING_SERVICE_TYPES.includes(serviceType) &&
    !housing
  ) {
    warnings.push("نوع خدمة السكن مسجّل للموظف لكن موقع السكن غير محدد.");
  }

  const cycle = employeeCycle(employee, serviceDate);
  if (cycle.known && !cycle.is_work) {
    warnings.push(
      `التاريخ ${serviceDate} يقع في مرحلة الراحة لدورة دوام الموظف (اليوم ${cycle.cycle_day} من ${cycle.cycle_length}، والدوام ${cycle.work_days} يوم عمل).`,
    );
  }
  if (cycle.known && cycle.tomorrow_is_work === false) {
    warnings.push(
      `موعد المغادرة غداً (${cycle.tomorrow_cycle_day} من ${cycle.cycle_length}) يقع في مرحلة الراحة. تحقّق من موعد الاستلام.`,
    );
  }
  if (!cycle.known && employee.status_label) {
    warnings.push(`حالة الدوام المسجّلة للموظف: ${employee.status_label}.`);
  }
  return warnings;
}

export function formatDate(value?: string | null): string {
  const d = parseDate(value);
  return d ? toIso(d) : value || "";
}

export function todayIso(): string {
  return toIso(new Date());
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** أول يوم في الشهر الحالي — يُستخدم كفلتر افتراضي للتقارير. */
export function monthStartIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
