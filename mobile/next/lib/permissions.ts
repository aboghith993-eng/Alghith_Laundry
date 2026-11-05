/* صلاحيات العرض والإجراءات في تطبيق المغسلة.
   إخفاء الإعدادات وإدارة الأسعار عن كل المستخدمين عدا مدير النظام. */

import type { LocalOrder, SessionUser, UserRole } from "./types";

export function roleOf(user: SessionUser | null | undefined): UserRole {
  return (user?.role as UserRole) || "";
}

export function isAdmin(user: SessionUser | null | undefined): boolean {
  return roleOf(user) === "admin";
}

export function isSupervisor(user: SessionUser | null | undefined): boolean {
  return roleOf(user) === "supervisor";
}

export function isContractor(user: SessionUser | null | undefined): boolean {
  return roleOf(user) === "contractor";
}

/** الإعدادات (الخادم، الحساب، المزامنة) لمدير النظام فقط. */
export function canViewSettings(user: SessionUser | null | undefined): boolean {
  return isAdmin(user);
}

/** إضافة وتعديل الخدمات والأسعار لمدير النظام فقط. */
export function canManageServices(user: SessionUser | null | undefined): boolean {
  return isAdmin(user);
}

export function canCreateOrder(user: SessionUser | null | undefined): boolean {
  return isAdmin(user) || isContractor(user);
}

/** الخادم يسمح بالتسليم لمدير النظام والمتعهد. */
export function canDeliver(user: SessionUser | null | undefined): boolean {
  return isAdmin(user) || isContractor(user);
}

/** الخادم يسمح بالاعتماد أو الرفض لمدير النظام والمشرف. */
export function canConfirm(user: SessionUser | null | undefined): boolean {
  return isAdmin(user) || isSupervisor(user);
}

function hasReceipts(order: LocalOrder): boolean {
  return Object.values(order.items || {}).some(
    (line) => Number(line.received_quantity || 0) > 0,
  );
}

/** تعديل الطلب قبل المراجعة وقبل بدء التسليم — مدير النظام أو منشئه من المتعهد. */
export function canEditOrder(
  user: SessionUser | null | undefined,
  order: LocalOrder | null | undefined,
): boolean {
  if (!order) return false;
  if (order.status !== "pending") return false;
  if (hasReceipts(order)) return false;
  if (isAdmin(user)) return true;
  return isContractor(user);
}

/** الحذف النهائي — مدير النظام دائماً، والمتعهد للطلبات غير المعتمدة. */
export function canDeleteOrder(
  user: SessionUser | null | undefined,
  order: LocalOrder | null | undefined,
): boolean {
  if (!order) return false;
  if (isAdmin(user)) return true;
  if (isContractor(user)) return order.status === "pending";
  return false;
}

/** هل يستطيع المستخدم فتح صفحة الخدمات؟ */
export function canOpenServices(user: SessionUser | null | undefined): boolean {
  return canManageServices(user);
}

export function roleLabel(user: SessionUser | null | undefined): string {
  const labels: Record<string, string> = {
    admin: "مدير النظام",
    contractor: "متعهد المغسلة",
    supervisor: "مشرف السكن",
    super_admin: "المدير العام",
    super: "المدير العام",
  };
  return labels[roleOf(user)] || "مستخدم";
}
