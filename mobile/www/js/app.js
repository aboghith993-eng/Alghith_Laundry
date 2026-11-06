/* تطبيق المغسلة للجوال — واجهة تعمل دون اتصال مع مزامنة تلقائية. */

import {
  state, loadSession, hasSession, clearSession, tryOnlineLogin, verifyLocalPin, hasLocalPin,
  setLocalPin, isOnline, setOnline, backendBaseUrl, saveConfig, getConfig,
  syncSnapshotFromServer, syncOrders, syncEverything, enqueueOrder, dequeueOrder,
  getQueue, pendingCount, getLocalOrders, saveLocalOrder, getOrderByUuid, searchEmployee,
  findEmployeesByName, serviceItems, activeServiceItems, settings, uuid, autoSync, snapshotMeta,
  queueAction, syncActions, pendingActionCount, isLocked, setLocked, getIdentity,
  fetchServerOrders, testServerConnection, hasServerUrl, BUILD_DEFAULT_SERVER,
  queueServiceAction, deleteLocalOrder, pendingServiceCount, refreshOrderFromServer,
  snapshotUsers, fetchUsers, createUser, updateUser, toggleUser, deleteUser, resetUserPassword,
} from "./store.js";

import { shiftWarnings, employeeCycle, todayIso, nowIso, formatDate } from "./shift.js";

import {
  downloadTable, downloadCsv, downloadSectionsXls, printReportSections, tableToText, shareText, toCsv,
} from "./export.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ROLE_LABELS = { admin: "مدير النظام", contractor: "متعهد المغسلة", supervisor: "مشرف السكن" };
const STATUS_LABELS = { pending: "بانتظار التأكيد", approved: "معتمد", rejected: "مرفوض" };

let currentPage = "home";
let draft = { employee: null, items: {}, person_name: "", notes: "", service_date: todayIso() };

/* فلاتر التقارير — الافتراضي آخر 30 يوماً. */
let reportRange = { from: isoDaysAgo(29), to: todayIso() };
let residentsRange = { from: isoDaysAgo(29), to: todayIso() };
let reportTab = "quantities";
let residentsShowInactive = false;
let usersPageLoaded = false;

/* ---------- أدوات واجهة ---------- */

function toast(message, kind = "") {
  const area = $("#toast-area");
  if (!area) return;
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function money(value) {
  const n = Number(value || 0);
  return n.toLocaleString("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* نسبة مئوية بصيغة مقروءة (تُستخدم في أعمدة التقارير). */
function percentText(part, total) {
  const denom = Number(total || 0);
  if (!denom) return "0%";
  return `${((Number(part || 0) / denom) * 100).toFixed(1)}%`;
}

function openModal(html) {
  $("#modal-box").innerHTML = html;
  $("#modal-backdrop").classList.remove("hidden");
}

function closeModal() {
  $("#modal-backdrop").classList.add("hidden");
  $("#modal-box").innerHTML = "";
}

document.addEventListener("click", (e) => {
  if (e.target.id === "modal-backdrop") closeModal();
});

function currentRole() {
  return (state.session && state.session.role) || (getIdentity() || {}).role || "";
}

function isAdmin() {
  return currentRole() === "admin";
}

function canManageOrders() {
  const role = currentRole();
  return role === "admin" || role === "contractor";
}

function canReviewOrders() {
  const role = currentRole();
  return role === "admin" || role === "supervisor";
}

/* تقرير الساكنين: مشرف السكن ومدير النظام فقط (وليس متعهد المغسلة). */
function canViewResidents() {
  const role = currentRole();
  return role === "admin" || role === "supervisor" || role === "super_admin";
}

/* صفحة الإعدادات والخدمات والمستخدمين لمدير النظام فقط؛
   غير المدير يرى زر «حسابي» بدلاً منها (لضبط رمز الدخول دون اتصال والمزامنة). */
function applyRoleVisibility() {
  const admin = isAdmin();
  $$(".tab").forEach((tab) => {
    if (tab.dataset.page !== "settings" && tab.dataset.tabFor !== "settings") return;
    const forPage = admin ? "settings" : "account";
    tab.dataset.tabFor = "settings";
    tab.dataset.page = forPage;
    tab.innerHTML = `<span>⚙</span>${admin ? "الإعدادات" : "حسابي"}`;
    tab.classList.remove("hidden");
  });
  if (!admin && (currentPage === "settings" || currentPage === "services" || currentPage === "users")) {
    currentPage = "account";
  }
  if (currentPage === "residents" && !canViewResidents()) {
    reportTab = "quantities";
    currentPage = "reports";
  }
}

function setPage(page) {
  if ((page === "services" || page === "users") && !isAdmin()) {
    toast("هذه الصفحة متاحة لمدير النظام فقط.", "warn");
    page = "home";
  }
  if (page === "settings" && !isAdmin()) page = "account";
  if (page === "reports") reportTab = "quantities";
  if (page === "residents") {
    if (!canViewResidents()) {
      toast("تقرير الساكنين متاح لمشرف السكن ومدير النظام فقط.", "warn");
      page = "reports";
    } else {
      reportTab = "residents";
    }
  }
  currentPage = page;
  $$(".tab").forEach((t) => {
    const active = t.dataset.page === page || (page === "residents" && t.dataset.page === "reports");
    t.classList.toggle("active", active);
  });
  const titles = {
    home: "الرئيسية", new: "طلب جديد", orders: "الطلبات", reports: "التقارير",
    residents: "تقرير الساكنين", settings: "الإعدادات", account: "حسابي", services: "الخدمات والأسعار",
    users: "المستخدمون والصلاحيات",
  };
  $("#page-title").textContent = titles[page] || "";
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  applyRoleVisibility();
  const container = $("#page-container");
  const view = VIEWS[currentPage] || VIEWS.home;
  container.innerHTML = view ? view() : "";
  if (currentPage === "new") bindNewOrderPage();
  if (currentPage === "orders") bindOrdersPage();
  if (currentPage === "settings" || currentPage === "account") bindSettingsPage();
  if (currentPage === "reports" || currentPage === "residents") bindReportsPage();
  if (currentPage === "services") bindServicesPage();
  if (currentPage === "users") bindUsersPage();
  updateSyncBadge();
}

function updateSyncBadge() {
  const badge = $("#sync-badge");
  if (!badge) return;
  const pending = pendingCount() + pendingActionCount();
  if (!isOnline()) {
    badge.textContent = pending ? `غير متصل · ${pending}` : "غير متصل";
    badge.className = "sync-badge offline";
  } else if (pending) {
    badge.textContent = `بانتظار المزامنة ${pending}`;
    badge.className = "sync-badge pending";
  } else {
    badge.textContent = "متصل";
    badge.className = "sync-badge online";
  }
  const banner = $("#offline-banner");
  if (banner) banner.classList.toggle("hidden", isOnline());
}

/* ---------- أدوات التواريخ والطلبات ---------- */

function isoLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoLocal(d);
}

function parseIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(from, to) {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function inRange(date, from, to) {
  const value = String(date || "").slice(0, 10);
  if (!value) return false;
  if (from && value < from) return false;
  if (to && value > to) return false;
  return true;
}

function localOrdersInRange(from, to) {
  return getLocalOrders().filter((order) => inRange(order.service_date, from, to));
}

function itemRate(line, itemId) {
  if (line && line.unit_price != null && line.unit_price !== "") return Number(line.unit_price || 0);
  const item = serviceItems().find((i) => String(i.id) === String(itemId));
  return Number(item?.rate || 0);
}

function orderTotal(order) {
  const computed = Object.entries(order.items || {}).reduce(
    (sum, [itemId, line]) => sum + Number(line.quantity || 0) * itemRate(line, itemId), 0
  );
  if (computed) return computed;
  return Number(order.subtotal || 0);
}

function orderQuantity(order) {
  return Object.values(order.items || {}).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}

function orderReceived(order) {
  return Object.values(order.items || {}).reduce((sum, line) => {
    if (line.received_quantity != null && line.received_quantity !== "") {
      return sum + Number(line.received_quantity || 0);
    }
    return sum + (order.fulfillment_status === "delivered" ? Number(line.quantity || 0) : 0);
  }, 0);
}

function orderRemaining(order) {
  return Object.values(order.items || {}).reduce(
    (sum, line) => sum + Math.max(Number(line.quantity || 0) - Number(line.received_quantity || 0), 0), 0
  );
}

function orderIsPartial(order) {
  return order.fulfillment_status === "delivered" && orderRemaining(order) > 0.0001;
}

function orderStatusPill(order) {
  if (!order.status || order.status === "pending") return "";
  const cls = order.status === "approved" ? "pill-approved" : order.status === "rejected" ? "pill-rejected" : "";
  return `<span class="pill ${cls}">${esc(STATUS_LABELS[order.status] || order.status)}</span>`;
}

function orderDeliveryPill(order) {
  if (orderIsPartial(order)) return '<span class="pill pill-pending">تسليم جزئي</span>';
  if (order.fulfillment_status === "delivered" && orderReceived(order) > 0.0001) return '<span class="pill pill-synced">تم التسليم</span>';
  if (orderRemaining(order) > 0.0001) return '<span class="pill pill-local">مرحلة التسليم</span>';
  return "";
}

/* ---------- الشاشات ---------- */

const VIEWS = {};

VIEWS.home = () => {
  const snap = snapshotMeta();
  const local = getLocalOrders();
  const pendingLocal = local.filter((o) => o.sync_state !== "created" && o.sync_state !== "duplicate");
  const user = state.session || {};
  const count = snap?.counts?.employees || 0;
  const admin = isAdmin();
  return `
    <div class="card">
      <h2 class="card-title">مرحباً ${esc(user.full_name || user.username || "")}</h2>
      <p class="muted small">الدور: ${esc(ROLE_LABELS[user.role] || user.role || "-")}</p>
      <div class="grid-4" style="margin-top:12px">
        <div class="stat"><div class="value">${count}</div><div class="label">موظف مسجّل</div></div>
        <div class="stat"><div class="value">${serviceItems().length}</div><div class="label">صنف خدمة</div></div>
        <div class="stat"><div class="value">${pendingLocal.length}</div><div class="label">طلب محلي</div></div>
        <div class="stat"><div class="value">${pendingCount() + pendingActionCount()}</div><div class="label">بانتظار الإرسال</div></div>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">حالة البيانات</h3>
      <p class="small muted">${snap ? `آخر تحديث للنسخة المحلية: ${esc(snap.built_at || "-")}` : "لا توجد نسخة محلية بعد — ستُحمَّل عند أول اتصال."}</p>
      <p class="small muted">${snap ? `عدد الموظفين في النسخة: ${snap.counts?.employees || 0}` : ""}</p>
      ${isOnline() ? "" : '<div class="alert alert-warn">أنت غير متصل. يمكنك تسجيل الطلبات وستُرسل لاحقاً.</div>'}
      <button class="btn btn-accent btn-block" id="home-sync">تحديث البيانات من الخادم</button>
    </div>

    <div class="card">
      <h3 class="card-title">إجراءات سريعة</h3>
      <div class="grid-2">
        <button class="btn btn-primary" data-go="new">＋ طلب غسيل جديد</button>
        <button class="btn btn-ghost" data-go="orders">≡ مراجعة الطلبات</button>
        <button class="btn btn-ghost" data-go="reports">▤ تقرير الكميات</button>
        <button class="btn btn-ghost" data-go="residents">⌂ تقرير الساكنين</button>
        <button class="btn btn-ghost" data-go="account">👤 حسابي</button>
        ${admin ? `<button class="btn btn-ghost" data-go="services">🏷 الخدمات والأسعار</button>
        <button class="btn btn-ghost" data-go="settings">⚙ الإعدادات</button>` : ""}
      </div>
    </div>`;
};

/* حالات التسليم: غير مستلم / جزئي / كامل — تُستخدم في الفلترة والتصدير. */
function orderDeliveryState(o) {
  const received = orderReceived(o);
  if (o.fulfillment_status === "delivered") {
    return orderIsPartial(o) ? "partial" : "received";
  }
  return received > 0.0001 ? "partial" : "not-received";
}

const ORDER_DELIVERY_LABELS = {
  "all": "الكل",
  "not-received": "غير مستلمة",
  "partial": "مستلمة جزئياً",
  "received": "مستلمة كاملة",
};

const ORDER_STATUS_LABELS_ALL = { "all": "الكل", "pending": "قيد الاعتماد", "approved": "معتمد", "rejected": "مرفوض" };

let ordersFilter = { delivery: "all", status: "all", q: "", from: "", to: "" };
let ordersPage = 1;
const ORDERS_PAGE_SIZE = 25;

/* تضمين كل الطلبات المحلية + سجل الخادم المحمَّل، مع تشغيل الفلاتر والبحث واستخراج صفحات العرض. */
function filteredOrders() {
  const q = ordersFilter.q.trim().toLowerCase();
  return getLocalOrders().filter((o) => {
    if (ordersFilter.delivery !== "all" && orderDeliveryState(o) !== ordersFilter.delivery) return false;
    if (canReviewOrders() && ordersFilter.status !== "all" && (o.status || "pending") !== ordersFilter.status) return false;
    if (ordersFilter.from && (o.service_date || "") < ordersFilter.from) return false;
    if (ordersFilter.to && (o.service_date || "") > ordersFilter.to) return false;
    if (q) {
      const haystack = [
        o.reference, o.client_uuid, o.employee_code, o.employee_name, o.person_name,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function orderCreatorName(o) {
  return o.creator_name || "";
}

function orderConfirmerInfo(o) {
  if (o.status === "approved") {
    return {
      label: "اعتمده",
      value: [o.confirmer_name, o.confirmed_at ? String(o.confirmed_at).replace("T", " ").slice(0, 16) : ""]
        .filter(Boolean).join(" · "),
    };
  }
  if (o.status === "rejected") {
    return { label: "رفضه", value: o.confirmer_name || "", reason: o.rejection_reason || "" };
  }
  return { label: "الاعتماد", value: "قيد المراجعة" };
}

VIEWS.orders = () => {
  const pendingActions = pendingActionCount();
  const header = `
    <div class="card">
      <h3 class="card-title">الطلبات</h3>
      <p class="small muted">تُرسل تلقائياً عند توفر الاتصال، وتُحمَّل سجلات الخادم للمزامنة.</p>
      <div class="row">
        <button class="btn btn-ghost btn-sm" id="btn-reload-orders">تحديث من الخادم</button>
        ${pendingActions ? `<span class="pill pill-local">${pendingActions} إجراء بانتظار الإرسال</span>` : ""}
      </div>
    </div>`;
  const all = getLocalOrders();
  if (!all.length) {
    return `${header}
      <div class="empty"><div class="big">≡</div><p>لا توجد طلبات محفوظة على هذا الجهاز بعد.</p>
      <button class="btn btn-primary" data-go="new">إنشاء طلب جديد</button></div>`;
  }
  const deliveryPills = Object.entries(ORDER_DELIVERY_LABELS).map(([key, label]) => `
    <button class="btn btn-sm ${ordersFilter.delivery === key ? "btn-primary" : "btn-ghost"}" data-odelivery="${key}">${label}</button>
  `).join("");
  const statusPills = canReviewOrders() ? `
    <div class="row" id="orders-status-filter" style="flex-wrap:wrap;gap:6px;margin-top:8px">
      ${Object.entries(ORDER_STATUS_LABELS_ALL).map(([key, label]) => `
        <button class="btn btn-sm ${ordersFilter.status === key ? "btn-primary" : "btn-ghost"}" data-ostatus="${key}">${label}</button>
      `).join("")}
    </div>` : "";
  const items = filteredOrders();
  const totalPages = Math.max(Math.ceil(items.length / ORDERS_PAGE_SIZE), 1);
  if (ordersPage > totalPages) ordersPage = totalPages;
  const start = (ordersPage - 1) * ORDERS_PAGE_SIZE;
  const pageItems = items.slice(start, start + ORDERS_PAGE_SIZE);
  const listHtml = pageItems.length ? `
    <ul class="list" id="orders-list">
      ${pageItems.map((o) => {
        const emp = searchEmployee(o.employee_code);
        const name = emp ? emp.name : (o.employee_name || o.employee_code);
        const isSent = o.sync_state === "created" || o.sync_state === "duplicate" || o.source === "server";
        const statePill = isSent
          ? `<span class="pill pill-synced">مُرسل${o.reference ? " · " + esc(o.reference) : ""}</span>`
          : `<span class="pill pill-local">محلي</span>`;
        const reviewPill = orderStatusPill(o);
        const deliveredPill = orderDeliveryPill(o);
        const receiptsCount = (Array.isArray(o.receipts) ? o.receipts : []).length;
        return `<li class="list-item" data-uuid="${esc(o.client_uuid)}">
          <div class="li-main">
            <div class="li-title">${esc(name)} ${statePill} ${reviewPill} ${deliveredPill}</div>
            <div class="li-sub">${esc(o.employee_code)} · ${esc(o.service_date)} ${o.person_name ? "· " + esc(o.person_name) : ""}</div>
            <div class="li-sub">${money(orderTotal(o))} ${esc(settings().currency || "")}${o.creator_name ? ` · أنشأه: ${esc(orderCreatorName(o))}` : ""}${receiptsCount > 1 ? ` · ${receiptsCount} دفعات تسليم` : ""}</div>
          </div>
          <button class="btn btn-sm btn-ghost" data-detail="${esc(o.client_uuid)}">تفاصيل</button>
        </li>`;
      }).join("")}
    </ul>` : `<div class="empty"><div class="big">⌕</div><p>لا توجد طلبات مطابقة للفلاتر الحالية.</p>
      <button class="btn btn-ghost" id="orders-clear-filters">مسح الفلاتر</button></div>`;
  const pager = `
    <div class="row" style="justify-content:space-between;align-items:center;margin:10px 0">
      <button class="btn btn-ghost btn-sm" id="orders-prev" ${ordersPage <= 1 ? "disabled" : ""}>‹ السابق</button>
      <span class="small muted">صفحة ${ordersPage} من ${totalPages} · ${items.length} طلب</span>
      <button class="btn btn-ghost btn-sm" id="orders-next" ${ordersPage >= totalPages ? "disabled" : ""}>التالي ›</button>
    </div>`;
  const exportBar = `
    <div class="card">
      <h3 class="card-title">تصدير جميع البيانات</h3>
      <p class="small muted">يُصدَّر كل الطلبات المطابقة للفلاتر (لا الصفحة الحالية) مع أقسام دفعات الاستلام والمستلمين${canReviewOrders() ? " ومجموعة الطلبات غير المعتمدة" : ""}.</p>
      <div class="row">
        <button class="btn btn-primary btn-sm" id="orders-export-pdf">تصدير PDF ▾</button>
        <button class="btn btn-ghost btn-sm" id="orders-export-xls">Excel ▾</button>
        <button class="btn btn-ghost btn-sm" id="orders-export-csv">CSV</button>
      </div>
    </div>`;
  return `${header}
    <div class="card">
      <h3 class="card-title">تصفية وبحث</h3>
      <div class="row" id="orders-delivery-filter" style="flex-wrap:wrap;gap:6px">${deliveryPills}</div>
      ${statusPills}
      <label class="field" style="margin-top:10px"><span>بحث (رقم الطلب، رقم الكود، اسم الموظف، اسم الزائر)</span>
        <input type="text" id="orders-q" value="${esc(ordersFilter.q)}" placeholder="مثال: LND-2611-000031 أو 10159 أو محمد">
      </label>
      <div class="row">
        <label class="field" style="flex:1"><span>من تاريخ الخدمة</span><input type="date" id="orders-from" value="${esc(ordersFilter.from)}"></label>
        <label class="field" style="flex:1"><span>إلى تاريخ الخدمة</span><input type="date" id="orders-to" value="${esc(ordersFilter.to)}"></label>
      </div>
    </div>
    ${items.length > ORDERS_PAGE_SIZE ? pager : ""}
    ${listHtml}
    ${items.length > ORDERS_PAGE_SIZE ? pager : ""}
    ${exportBar}`;
};

/* ---------- تقرير الكميات والقيمة ---------- */

/* فلتر الأصناف في تقرير الكميات: قائمة أسماء الأصناف المختارة (فارغة = كل الأصناف). */
let reportItemFilter = [];

function buildReportSections(from = reportRange.from, to = reportRange.to) {
  const local = localOrdersInRange(from, to);
  const selected = new Set(reportItemFilter);
  const byEmployee = new Map();
  const byService = new Map();
  const allNames = new Set();
  for (const order of local) {
    const emp = searchEmployee(order.employee_code);
    const serviceType = (emp && emp.service_type) || "غير محدد";
    const empKey = order.employee_code;
    // وجّه أصناف الطلب أولاً: مع الفلتر يُحتسب الطلب فقط إن احتوى صنفاً مختاراً.
    const itemLines = [];
    for (const [itemId, line] of Object.entries(order.items || {})) {
      const item = serviceItems().find((i) => String(i.id) === String(itemId));
      const name = line.item_name || (item ? item.name : `صنف ${itemId}`);
      allNames.add(name);
      if (selected.size && !selected.has(name)) continue;
      itemLines.push({
        name,
        qty: Number(line.quantity || 0),
        value: Number(line.quantity || 0) * itemRate(line, itemId),
      });
    }
    if (selected.size && !itemLines.length) continue;
    const empRow = byEmployee.get(empKey) || {
      code: order.employee_code,
      name: emp ? emp.name : (order.employee_name || order.employee_code),
      service: serviceType,
      items: {},
      total: 0,
      value: 0,
      orders: 0,
    };
    const svcRow = byService.get(serviceType) || { label: serviceType, items: {}, total: 0, value: 0, orders: 0 };
    empRow.orders += 1;
    svcRow.orders += 1;
    for (const line of itemLines) {
      empRow.items[line.name] = (empRow.items[line.name] || 0) + line.qty;
      svcRow.items[line.name] = (svcRow.items[line.name] || 0) + line.qty;
      empRow.total += line.qty;
      svcRow.total += line.qty;
      empRow.value += line.value;
      svcRow.value += line.value;
    }
    byEmployee.set(empKey, empRow);
    byService.set(serviceType, svcRow);
  }
  if (!byEmployee.size) {
    return {
      meta: [`الفترة: ${from || "-"} إلى ${to || "-"}`, "لا توجد طلبات في هذه الفترة."],
      sections: [],
      totalValue: 0,
      allItemNames: [...allNames].sort(),
      summary: { orders: 0, employees: 0, serviceTypes: 0, sent: 0, received: 0, value: 0 },
    };
  }
  // الأعمدة المعروضة: كل الأصناف، أو المختار منها فقط عند تفعيل فلتر الأصناف.
  const itemNames = selected.size
    ? [...selected].filter((n) => allNames.has(n)).sort()
    : [...allNames].sort();
  const empHeaders = ["الاسم", "الكود", "نوع الخدمة", "عدد الطلبات", ...itemNames, "إجمالي الكمية", "قيمة الطلبات", "النسبة %"];
  const svcHeaders = ["نوع الخدمة", "عدد الطلبات", ...itemNames, "إجمالي الكمية", "قيمة الطلبات", "النسبة %"];
  const totalValue = [...byEmployee.values()].reduce((sum, r) => sum + r.value, 0);
  const totalQuantity = [...byEmployee.values()].reduce((sum, r) => sum + r.total, 0);
  const totalReceived = local.reduce((sum, order) => sum + orderReceived(order), 0);
  const totalOrders = [...byEmployee.values()].reduce((sum, r) => sum + r.orders, 0);
  const itemTotals = {};
  for (const r of byEmployee.values()) {
    for (const n of itemNames) itemTotals[n] = (itemTotals[n] || 0) + (r.items[n] || 0);
  }
  const empRows = [...byEmployee.values()].map((r) => [
    r.name, r.code, r.service, r.orders,
    ...itemNames.map((n) => (r.items[n] ? Number(r.items[n].toFixed(2)) : 0)),
    Number(r.total.toFixed(2)),
    Number(r.value.toFixed(2)),
    percentText(r.value, totalValue),
  ]);
  empRows.push([
    "الإجمالي", "", "", totalOrders,
    ...itemNames.map((n) => Number((itemTotals[n] || 0).toFixed(2))),
    Number(totalQuantity.toFixed(2)),
    Number(totalValue.toFixed(2)),
    totalValue > 0 ? "100%" : "0%",
  ]);
  const svcRows = [...byService.values()].map((r) => [
    r.label, r.orders,
    ...itemNames.map((n) => (r.items[n] ? Number(r.items[n].toFixed(2)) : 0)),
    Number(r.total.toFixed(2)),
    Number(r.value.toFixed(2)),
    percentText(r.value, totalValue),
  ]);
  const serviceOrders = [...byService.values()].reduce((sum, r) => sum + r.orders, 0);
  svcRows.push([
    "الإجمالي", serviceOrders,
    ...itemNames.map((n) => Number((itemTotals[n] || 0).toFixed(2))),
    Number(totalQuantity.toFixed(2)),
    Number(totalValue.toFixed(2)),
    totalValue > 0 ? "100%" : "0%",
  ]);
  const issuedAt = new Date().toLocaleString("ar");
  const meta = [
    `الفترة: ${from || "-"} إلى ${to || "-"}`,
    selected.size ? `الأصناف المختارة: ${[...selected].sort().join("، ")}` : "الأصناف: الكل",
    `عدد الطلبات: ${local.length} · ${byEmployee.size} موظف · ${byService.size} نوع خدمة`,
    `إجمالي قيمة الطلبات: ${money(totalValue)} ${settings().currency || ""}`,
    `تاريخ الإصدار: ${issuedAt}`,
  ];
  return {
    meta,
    totalValue,
    allItemNames: [...allNames].sort(),
    itemFilter: selected.size ? [...selected].sort() : [],
    summary: {
      orders: local.length,
      employees: byEmployee.size,
      serviceTypes: byService.size,
      sent: totalQuantity,
      received: totalReceived,
      value: totalValue,
    },
    sections: [
      { heading: "ملخص كميات الغسيل وقيمتها لكل موظف", headers: empHeaders, rows: empRows },
      { heading: "الملخص حسب نوع الخدمة", headers: svcHeaders, rows: svcRows },
    ],
  };
}

/* ---------- تقرير الساكنين (كل الساكنين، بما فيهم من لم يرسل = 0) ---------- */

function buildResidentsReport(from = residentsRange.from, to = residentsRange.to, showInactive = residentsShowInactive) {
  const employees = (state.snapshot && Array.isArray(state.snapshot.employees) ? state.snapshot.employees : [])
    .filter((emp) => (emp.person_type || "company") !== "general")
    .filter((emp) => showInactive || emp.active !== false);
  const rows = new Map();
  for (const emp of employees) {
    rows.set(emp.employee_code, {
      code: emp.employee_code,
      name: emp.name,
      company: emp.company || "",
      department: emp.department || "",
      active: emp.active !== false,
      orders: 0,
      delivered: 0,
      quantity: 0,
      received: 0,
      value: 0,
    });
  }
  const local = localOrdersInRange(from, to);
  for (const order of local) {
    const row = rows.get(order.employee_code);
    if (!row) continue;
    row.orders += 1;
    row.quantity += orderQuantity(order);
    row.received += orderReceived(order);
    row.value += orderTotal(order);
    // دفعات الاستلام الفعلية: قد يُسلّم نفس الطلب لأكثر من مستلم على دفعات متعددة.
    row.delivered += (Array.isArray(order.receipts) && order.receipts.length)
      ? order.receipts.length
      : (order.fulfillment_status === "delivered" && orderReceived(order) > 0.0001 ? 1 : 0);
  }
  const list = [...rows.values()].sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
  const headers = [
    "الاسم", "الكود", "الشركة", "عدد الطلبات", "مرات التسليم",
    "الكمية المرسلة", "الكمية المستلمة", "قيمة الطلبات", "النسبة %",
  ];
  const totals = list.reduce((acc, r) => {
    acc.orders += r.orders;
    acc.delivered += r.delivered;
    acc.quantity += r.quantity;
    acc.received += r.received;
    acc.value += r.value;
    return acc;
  }, { orders: 0, delivered: 0, quantity: 0, received: 0, value: 0 });
  const dataRows = list.map((r) => [
    r.name, r.code, r.company, r.orders, r.delivered,
    Number(r.quantity.toFixed(2)), Number(r.received.toFixed(2)), Number(r.value.toFixed(2)),
    percentText(r.value, totals.value),
  ]);
  dataRows.push([
    "الإجمالي", "", "", totals.orders, totals.delivered,
    Number(totals.quantity.toFixed(2)), Number(totals.received.toFixed(2)), Number(totals.value.toFixed(2)),
    totals.value > 0 ? "100%" : "0%",
  ]);
  const issuedAt = new Date().toLocaleString("ar");
  const meta = [
    `الفترة: ${from || "-"} إلى ${to || "-"} (${daysBetween(from, to)} يوم)`,
    `عدد الساكنين: ${list.length} · ${list.filter((r) => r.orders > 0).length} أرسلوا · ${list.filter((r) => r.orders === 0).length} لم يرسلوا`,
    `إجمالي الكميات المستلمة: ${money(totals.received)} · إجمالي القيمة: ${money(totals.value)} ${settings().currency || ""}`,
    `تاريخ الإصدار: ${issuedAt}`,
  ];
  return {
    meta,
    totalValue: totals.value,
    summary: {
      orders: totals.orders,
      people: list.length,
      sent: totals.quantity,
      received: totals.received,
      value: totals.value,
      delivered: totals.delivered,
      notSent: list.filter((r) => r.orders === 0).length,
      sentPeople: list.filter((r) => r.orders > 0).length,
    },
    sections: [{ heading: "حركة إرسال واستلام المغسلة لكل ساكن", headers, rows: dataRows }],
  };
}

function sectionTable(section) {
  return `<div class="table-wrap"><table class="data">
      <thead>${section.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</thead>
      <tbody>${section.rows.map((cells) => `<tr>${cells.map((c, i) => `<td class="${i ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function reportsView() {
  if (reportTab === "residents" && !canViewResidents()) reportTab = "quantities";
  const residents = reportTab === "residents";
  const range = residents ? residentsRange : reportRange;
  const report = residents
    ? buildResidentsReport(range.from, range.to, residentsShowInactive)
    : buildReportSections(range.from, range.to);
  const rangeDays = daysBetween(range.from, range.to);
  const minNote = residents && rangeDays < 30
    ? '<div class="alert alert-warn">تقرير الساكنين يتطلب فترة لا تقل عن 30 يوماً — سيتم تعديل تاريخ البداية تلقائياً.</div>'
    : "";
  const summary = report.summary || { orders: 0, people: 0, employees: 0, sent: 0, received: 0, value: 0 };
  const totalPeople = residents ? summary.people : summary.employees;
  const receivedPct = percentText(summary.received, summary.sent);
  const currency = settings().currency || "";
  return `
    <div class="card">
      <h3 class="card-title">التقارير</h3>
      <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <button class="btn btn-sm ${residents ? "btn-ghost" : "btn-primary"}" data-report-tab="quantities">كميات الغسيل والقيمة</button>
        ${canViewResidents() ? `<button class="btn btn-sm ${residents ? "btn-primary" : "btn-ghost"}" data-report-tab="residents">تقرير الساكنين</button>` : ""}
      </div>
      <div class="grid-2">
        <label class="field"><span>من تاريخ</span><input type="date" id="report-from" value="${esc(range.from)}"></label>
        <label class="field"><span>إلى تاريخ</span><input type="date" id="report-to" value="${esc(range.to)}"></label>
      </div>
      ${residents ? `<label class="row small" style="gap:8px;align-items:center;margin-bottom:10px">
        <input type="checkbox" id="residents-inactive" ${residentsShowInactive ? "checked" : ""} style="width:auto;min-height:auto">
        <span>إظهار الساكنين غير النشطين</span>
      </label>` : ""}
      ${minNote}
      ${!residents && report.allItemNames && report.allItemNames.length ? `
      <div class="row small" style="flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0">
        <span style="font-weight:600">فلتر الأصناف (اختيار متعدد):</span>
        ${report.allItemNames.map((n) => `
          <label class="row small" style="gap:5px;align-items:center;border:1px solid var(--line,#d6dde6);border-radius:10px;padding:5px 10px;margin:0">
            <input type="checkbox" data-rpt-item="${esc(n)}" ${reportItemFilter.includes(n) ? "checked" : ""} style="width:auto;min-height:auto;margin:0">
            <span>${esc(n)}</span>
          </label>`).join("")}
        ${reportItemFilter.length ? `<button class="btn btn-ghost btn-sm" id="rpt-items-clear">مسح اختيار الأصناف</button>`
          : `<span class="small muted">بدون اختيار = كل الأصناف</span>`}
      </div>` : ""}
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <button class="btn btn-accent btn-sm" id="report-apply">تطبيق الفترة</button>
        <button class="btn btn-ghost btn-sm" id="report-refresh">تحديث من الخادم</button>
        <span class="small muted">${rangeDays} يوم</span>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">خلاصة التقرير</h3>
      <div class="grid-2">
        <div class="stat"><div class="value">${summary.orders}</div><div class="label">عدد الطلبات</div></div>
        <div class="stat"><div class="value">${totalPeople}</div><div class="label">${residents ? "عدد الساكنين" : "عدد الموظفين"}</div></div>
        <div class="stat"><div class="value">${money(summary.sent)}</div><div class="label">الكمية المرسلة</div></div>
        <div class="stat"><div class="value">${money(summary.received)}</div><div class="label">الكمية المستلمة</div></div>
        <div class="stat"><div class="value">${money(summary.value)}</div><div class="label">إجمالي القيمة ${esc(currency)}</div></div>
        <div class="stat"><div class="value">${receivedPct}</div><div class="label">نسبة المستلم من المرسل</div></div>
      </div>
      ${residents ? `<p class="small muted center" style="margin-top:10px">${summary.sentPeople || 0} ساكناً أرسلوا · ${summary.notSent || 0} لم يرسلوا في هذه الفترة</p>` : ""}
    </div>

    <div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <button class="btn btn-primary btn-sm" id="rep-export-xls">Export Excel ▾</button>
      <button class="btn btn-ghost btn-sm" id="rep-export-csv">CSV</button>
      <button class="btn btn-accent btn-sm" id="rep-export-pdf">PDF / طباعة</button>
      <button class="btn btn-ghost btn-sm" id="rep-export-share">مشاركة</button>
    </div>

    ${report.sections.length
      ? report.sections.map((section) => `<div class="card">
          <h3 class="card-title">${esc(section.heading)}</h3>
          ${sectionTable(section)}
        </div>`).join("")
      : `<div class="empty"><div class="big">▤</div><p>لا توجد بيانات كافية لعرض التقرير في هذه الفترة.<br>أنشئ طلبات أو زامن البيانات من الخادم أولاً.</p></div>`}
    <p class="small muted center">التقرير مبني على الطلبات المحفوظة على هذا الجهاز. استخدم زر «تحديث من الخادم» لجلب طلبات الفترة كاملة.</p>`;
}

VIEWS.reports = reportsView;
VIEWS.residents = reportsView;

function bindReportsPage() {
  const residents = reportTab === "residents";
  const range = residents ? residentsRange : reportRange;

  $$("[data-report-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      reportTab = btn.dataset.reportTab;
      setPage(reportTab === "residents" ? "residents" : "reports");
    });
  });

  const applyBtn = $("#report-apply");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      let from = $("#report-from").value || range.from;
      let to = $("#report-to").value || range.to;
      if (from > to) [from, to] = [to, from];
      if (residents && daysBetween(from, to) < 30) {
        const end = parseIsoDate(to) || new Date();
        end.setDate(end.getDate() - 29);
        from = isoLocal(end);
        toast("تم فرض حد أدنى 30 يوماً لتقرير الساكنين.", "warn");
      }
      if (residents) residentsRange = { from, to };
      else reportRange = { from, to };
      render();
    });
  }

  const inactive = $("#residents-inactive");
  if (inactive) {
    inactive.addEventListener("change", () => {
      residentsShowInactive = inactive.checked;
      render();
    });
  }

  /* فلتر الأصناف متعدد الاختيار: إعادة بناء التقرير والتصدير حسب المختار. */
  $$("[data-rpt-item]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const name = cb.dataset.rptItem;
      if (cb.checked) {
        if (!reportItemFilter.includes(name)) reportItemFilter.push(name);
      } else {
        reportItemFilter = reportItemFilter.filter((n) => n !== name);
      }
      render();
    });
  });
  const clearItems = $("#rpt-items-clear");
  if (clearItems) {
    clearItems.addEventListener("click", () => {
      reportItemFilter = [];
      render();
    });
  }

  const refreshBtn = $("#report-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      const res = await fetchServerOrders({ from: range.from, to: range.to, limit: 3000 });
      refreshBtn.disabled = false;
      toast(res.ok ? `تم تحميل ${res.count} طلباً من الخادم.` : (res.error || "تعذر التحديث."), res.ok ? "ok" : "warn");
      render();
    });
  }

  const report = residents
    ? buildResidentsReport(range.from, range.to, residentsShowInactive)
    : buildReportSections(range.from, range.to);
  const stamp = todayIso().replace(/-/g, "");
  const title = residents
    ? "تقرير الساكنين — المغسلة"
    : "تقرير كميات المغسلة وقيمتها" + (report.itemFilter && report.itemFilter.length ? " — الأصناف: " + report.itemFilter.join("، ") : "");
  const fileBase = residents ? "laundry-residents" : "laundry-quantities";

  const xlsBtn = $("#rep-export-xls");
  if (xlsBtn) {
    xlsBtn.addEventListener("click", () => {
      try {
        downloadSectionsXls(`${fileBase}-${stamp}.xls`, residents ? "الساكنين" : "الكميات", title, report.meta, report.sections);
        toast("تم إنشاء ملف Excel.", "ok");
      } catch (err) {
        toast("تعذر إنشاء ملف Excel: " + err.message, "err");
      }
    });
  }
  const csvBtn = $("#rep-export-csv");
  if (csvBtn) {
    csvBtn.addEventListener("click", () => {
      try {
        const body = report.sections.map((section) => (
          (section.heading ? section.heading + "\r\n" : "") + toCsv(section.headers, section.rows)
        )).join("\r\n\r\n");
        downloadCsv(`${fileBase}-${stamp}.csv`, [title, ...report.meta, "", body].join("\r\n"));
        toast("تم إنشاء ملف CSV.", "ok");
      } catch (err) {
        toast("تعذر إنشاء CSV: " + err.message, "err");
      }
    });
  }
  const pdfBtn = $("#rep-export-pdf");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      const ok = printReportSections(title, report.meta, report.sections);
      if (!ok) toast("تعذر فتح الطباعة على هذا الجهاز.", "err");
    });
  }
  const shareBtn = $("#rep-export-share");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const first = report.sections[0];
      if (!first) {
        toast("لا توجد بيانات للمشاركة.", "warn");
        return;
      }
      shareText(title, tableToText(title, first.headers, first.rows));
    });
  }
}

/* ---------- الإعدادات والحساب ---------- */

VIEWS.account = () => {
  const user = state.session || {};
  const snap = snapshotMeta();
  const username = user.username || (getIdentity() || {}).username || "";
  const pinReady = username && hasLocalPin(username);
  return `
    <div class="card">
      <h3 class="card-title">معلومات الحساب</h3>
      <p class="small">${esc(user.full_name || user.username || "-")} — ${esc(ROLE_LABELS[user.role] || user.role || "-")}</p>
    </div>
    <div class="card">
      <h3 class="card-title">رمز الدخول المحلي ${pinReady ? '<span class="pill pill-synced">مفعّل على هذا الجهاز</span>' : '<span class="pill pill-local">غير مضبوط بعد</span>'}</h3>
      <p class="small muted">ضع رمزاً رقمياً لفتح التطبيق دون اتصال بالإنترنت (بعد أول تسجيل دخول). ${pinReady ? "يمكنك تغييره في أي وقت." : "ينصح بضبطه بعد أول دخول بالإنترنت حتى تستطيع فتح التطبيق والمواصلة العمل دون شبكة."}</p>
      <label class="field">
        <span>رمز الدخول المحلي (4 أرقام أو أكثر)</span>
        <input type="password" id="cfg-pin" inputmode="numeric" placeholder="••••">
      </label>
      <button class="btn btn-ghost btn-block" id="cfg-pin-save">${pinReady ? "تغيير رمز الدخول المحلي" : "حفظ رمز الدخول المحلي"}</button>
    </div>
    <div class="card">
      <h3 class="card-title">المزامنة</h3>
      <p class="small muted">${snap ? "آخر تحديث للبيانات: " + esc(snap.built_at || "-") : "لم يتم تحميل البيانات بعد."}</p>
      <p class="small muted">طلبات بانتظار الإرسال: <strong>${pendingCount()}</strong> · إجراءات: <strong>${pendingActionCount()}</strong></p>
      <button class="btn btn-primary btn-block" id="cfg-sync">مزامنة الآن</button>
    </div>
    <div class="card">
      <button class="btn btn-danger btn-block" id="cfg-logout">قفل التطبيق / الخروج</button>
    </div>`;
};

VIEWS.settings = () => {
  if (!isAdmin()) return VIEWS.account();
  const cfg = getConfig();
  const user = state.session || {};
  const snap = snapshotMeta();
  return `
    <div class="card">
      <h3 class="card-title">معلومات الحساب</h3>
      <p class="small">${esc(user.full_name || user.username || "-")} — ${esc(ROLE_LABELS[user.role] || user.role || "-")}</p>
    </div>
    <div class="card">
      <h3 class="card-title">عنوان الخادم (خاص بالمدير)</h3>
      <label class="field">
        <span>عنوان الخادم</span>
        <input type="text" id="cfg-server" value="${esc(cfg.server_url || BUILD_DEFAULT_SERVER || "")}" placeholder="https://alghith-laundry.onrender.com" dir="ltr" autocapitalize="off" autocorrect="off" spellcheck="false">
      </label>
      <p class="small muted">يُستخدم هذا العنوان للاتصال بـAPI. في حالة وجود رابط مدمج في التطبيق يمكن تركه فارغاً.</p>
      <div class="row">
        <button class="btn btn-ghost btn-sm" id="cfg-test">فحص الاتصال</button>
        <button class="btn btn-accent btn-sm" id="cfg-save">حفظ عنوان الخادم</button>
      </div>
      <p class="small muted" id="cfg-server-status"></p>
    </div>
    <div class="card">
      <h3 class="card-title">الخدمات والأسعار</h3>
      <p class="small muted">إضافة وتعديل أصناف الغسيل وأسعارها متاح لمدير النظام فقط.</p>
      <button class="btn btn-primary btn-block" data-go="services">إدارة الخدمات والأسعار</button>
    </div>
    <div class="card">
      <h3 class="card-title">المستخدمون والصلاحيات</h3>
      <p class="small muted">إضافة مشرف السكن أو متعهد المغسلة أو مدير نظام، وتعديل كلمات المرور وتعطيل الحسابات.</p>
      <button class="btn btn-primary btn-block" data-go="users">إدارة المستخدمين</button>
    </div>
    <div class="card">
      <h3 class="card-title">رمز الدخول المحلي</h3>
      <p class="small muted">ضع رمزاً رقمياً لفتح التطبيق دون اتصال بالإنترنت (بعد أول تسجيل دخول).</p>
      <label class="field">
        <span>رمز الدخول المحلي (4 أرقام أو أكثر)</span>
        <input type="password" id="cfg-pin" inputmode="numeric" placeholder="••••">
      </label>
      <button class="btn btn-ghost btn-block" id="cfg-pin-save">حفظ رمز الدخول المحلي</button>
    </div>
    <div class="card">
      <h3 class="card-title">المزامنة</h3>
      <p class="small muted">${snap ? "آخر تحديث للبيانات: " + esc(snap.built_at || "-") : "لم يتم تحميل البيانات بعد."}</p>
      <p class="small muted">طلبات بانتظار الإرسال: <strong>${pendingCount()}</strong> · إجراءات: <strong>${pendingActionCount()}</strong></p>
      <button class="btn btn-primary btn-block" id="cfg-sync">مزامنة الآن</button>
    </div>
    <div class="card">
      <button class="btn btn-danger btn-block" id="cfg-logout">قفل التطبيق / الخروج</button>
    </div>`;
};

/* ---------- الخدمات والأسعار (مدير النظام) ---------- */

VIEWS.services = () => {
  if (!isAdmin()) return VIEWS.account();
  const items = serviceItems().slice().sort((a, b) => Number(b.active !== false) - Number(a.active !== false)
    || String(a.name).localeCompare(String(b.name), "ar"));
  return `
    <div class="card">
      <h3 class="card-title">إضافة خدمة وسعر</h3>
      <label class="field"><span>الاسم</span><input type="text" id="svc-add-name" placeholder="مثال: غسيل بطانية"></label>
      <div class="grid-2">
        <label class="field"><span>الرمز</span><input type="text" id="svc-add-code" placeholder="BLANKET" dir="ltr"></label>
        <label class="field"><span>الوحدة</span><input type="text" id="svc-add-unit" value="قطعة"></label>
      </div>
      <label class="field"><span>السعر</span><input type="number" id="svc-add-rate" inputmode="decimal" step="0.25" min="0" value="0"></label>
      <button class="btn btn-primary btn-block" id="svc-add-btn">إضافة الخدمة</button>
      <p class="small muted">تُحفظ الإضافة محلياً وتُزامن تلقائياً عند توفر الاتصال.</p>
    </div>
    <div class="card">
      <h3 class="card-title">الخدمات المسجلة</h3>
      ${items.length ? `<ul class="list">${items.map((item) => `
        <li class="list-item">
          <div class="li-main">
            <div class="li-title">${esc(item.name)} ${item.active === false ? '<span class="pill">معطّلة</span>' : '<span class="pill pill-synced">مفعّلة</span>'} ${item._local ? '<span class="pill pill-local">محلي</span>' : ""}</div>
            <div class="li-sub">${esc(item.code || "")} · ${esc(item.unit || "قطعة")} · ${money(item.rate)} ${esc(settings().currency || "")}</div>
          </div>
          <div class="row" style="gap:4px">
            <button class="btn btn-sm btn-ghost" data-service-edit="${esc(item.id)}">تعديل</button>
            <button class="btn btn-sm btn-ghost" data-service-toggle="${esc(item.id)}">${item.active === false ? "تفعيل" : "تعطيل"}</button>
            <button class="btn btn-sm btn-danger" data-service-delete="${esc(item.id)}">حذف</button>
          </div>
        </li>`).join("")}</ul>` : '<div class="empty"><div class="big">🏷</div><p>لا توجد خدمات مسجلة بعد.</p></div>'}
    </div>`;
};

function serviceActionFeedback(res, successMessage) {
  if (res.applied) toast(successMessage, "ok");
  else if (res.offline) toast("تم الحفظ على الجهاز وسيُزامن عند عودة الاتصال.", "warn");
  else if (res.failed && res.errors && res.errors.length) toast(res.errors[0], "warn");
  else if (res.failed) toast("تعذر تنفيذ العملية. تحقق من الاتصال والبيانات.", "warn");
  else toast(successMessage, "ok");
}

function bindServicesPage() {
  const addBtn = $("#svc-add-btn");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const name = $("#svc-add-name").value.trim();
      const code = $("#svc-add-code").value.trim().toUpperCase().replace(/\s+/g, "_");
      const unit = $("#svc-add-unit").value.trim() || "قطعة";
      const rate = Number($("#svc-add-rate").value || 0);
      if (!name || !code) {
        toast("أدخل اسم الخدمة والرمز.", "err");
        return;
      }
      if (rate < 0) {
        toast("أدخل سعراً صحيحاً غير سالب.", "err");
        return;
      }
      queueServiceAction("service_create", { code, name, unit, rate });
      addBtn.disabled = true;
      const res = await syncActions();
      addBtn.disabled = false;
      serviceActionFeedback(res, "تمت إضافة الخدمة والسعر.");
      render();
    });
  }

  $$("[data-service-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = serviceItems().find((i) => String(i.id) === String(btn.dataset.serviceEdit));
      if (!item) return;
      openModal(`
        <h3>تعديل الخدمة</h3>
        <label class="field"><span>الاسم</span><input type="text" id="svc-edit-name" value="${esc(item.name)}"></label>
        <label class="field"><span>الرمز</span><input type="text" id="svc-edit-code" value="${esc(item.code || "")}" dir="ltr"></label>
        <div class="grid-2">
          <label class="field"><span>الوحدة</span><input type="text" id="svc-edit-unit" value="${esc(item.unit || "قطعة")}"></label>
          <label class="field"><span>السعر</span><input type="number" id="svc-edit-rate" step="0.25" min="0" value="${Number(item.rate || 0)}"></label>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" id="svc-edit-save">حفظ</button>
          <button class="btn btn-ghost" data-modal-close>إلغاء</button>
        </div>`);
      $("#modal-box [data-modal-close]").addEventListener("click", closeModal);
      $("#svc-edit-save").addEventListener("click", async () => {
        const name = $("#svc-edit-name").value.trim();
        const code = $("#svc-edit-code").value.trim().toUpperCase().replace(/\s+/g, "_");
        const unit = $("#svc-edit-unit").value.trim() || "قطعة";
        const rate = Number($("#svc-edit-rate").value || 0);
        if (!name || rate < 0) {
          toast("أدخل اسماً وسعراً صحيحاً.", "err");
          return;
        }
        queueServiceAction("service_update", {
          name, code, unit, rate, active: item.active !== false,
        }, item.id);
        closeModal();
        const res = await syncActions();
        serviceActionFeedback(res, "تم حفظ الخدمة والسعر.");
        render();
      });
    });
  });

  $$("[data-service-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = serviceItems().find((i) => String(i.id) === String(btn.dataset.serviceToggle));
      if (!item) return;
      queueServiceAction("service_toggle", { active: item.active === false }, item.id);
      const res = await syncActions();
      serviceActionFeedback(res, item.active === false ? "تم تفعيل الخدمة." : "تم تعطيل الخدمة.");
      render();
    });
  });

  $$("[data-service-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = serviceItems().find((i) => String(i.id) === String(btn.dataset.serviceDelete));
      if (!item) return;
      if (!window.confirm(`هل تريد حذف الخدمة «${item.name}»؟`)) return;
      queueServiceAction("service_delete", {}, item.id);
      const res = await syncActions();
      serviceActionFeedback(res, "تم حذف الخدمة أو تعطيلها إن كانت مستخدمة.");
      render();
    });
  });
}

/* ---------- المستخدمون والصلاحيات (مدير النظام) ---------- */

const USER_ROLE_OPTIONS = [
  ["supervisor", "مشرف السكن (اعتماد ورفض الطلبات)"],
  ["contractor", "متعهد المغسلة (إنشاء وتعديل وتسليم الطلبات)"],
  ["admin", "مدير النظام (كل الصلاحيات)"],
];

function userRoleOptions(selected) {
  return USER_ROLE_OPTIONS.map(([value, label]) => (
    `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`
  )).join("");
}

VIEWS.users = () => {
  if (!isAdmin()) return VIEWS.account();
  const users = snapshotUsers();
  return `
    <div class="card">
      <h3 class="card-title">إضافة مستخدم جديد</h3>
      <label class="field"><span>الاسم الكامل</span><input type="text" id="usr-add-name" placeholder="مثال: أحمد محمد"></label>
      <div class="grid-2">
        <label class="field"><span>اسم المستخدم</span><input type="text" id="usr-add-username" dir="ltr" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="supervisor1"></label>
        <label class="field"><span>الدور</span><select id="usr-add-role">${userRoleOptions("supervisor")}</select></label>
      </div>
      <label class="field"><span>كلمة المرور</span><input type="password" id="usr-add-password" placeholder="8 أحرف على الأقل"></label>
      <button class="btn btn-primary btn-block" id="usr-add-btn">إنشاء الحساب</button>
      <p class="small muted">الدور يحدد الصلاحيات: مدير النظام يدير كل شيء، متعهد المغسلة ينشئ ويعدّل ويسلّم الطلبات، مشرف السكن يعتمد أو يرفض الطلبات. تُحفظ الحسابات على الخادم مباشرة.</p>
    </div>
    <div class="card">
      <h3 class="card-title">المستخدمون (${users.length})</h3>
      ${users.length ? `<ul class="list">${users.map((u) => `
        <li class="list-item">
          <div class="li-main">
            <div class="li-title">${esc(u.full_name || u.username)} ${u.active ? '<span class="pill pill-synced">نشط</span>' : '<span class="pill">معطّل</span>'}</div>
            <div class="li-sub">${esc(u.username)} · ${esc(ROLE_LABELS[u.role] || u.role)}</div>
          </div>
          <div class="row" style="gap:4px">
            <button class="btn btn-sm btn-ghost" data-user-edit="${esc(u.id)}">تعديل</button>
            <button class="btn btn-sm btn-ghost" data-user-pass="${esc(u.id)}">كلمة المرور</button>
            <button class="btn btn-sm btn-ghost" data-user-toggle="${esc(u.id)}">${u.active ? "تعطيل" : "تفعيل"}</button>
            <button class="btn btn-sm btn-danger" data-user-delete="${esc(u.id)}">حذف</button>
          </div>
        </li>`).join("")}</ul>` : '<div class="empty"><div class="big">👤</div><p>لا توجد حسابات محمّلة. اضغط تحديث القائمة.</p></div>'}
      <button class="btn btn-ghost btn-block" id="usr-refresh">تحديث القائمة من الخادم</button>
    </div>`;
};

function userFeedback(res, okMessage) {
  if (res.ok) toast(okMessage || res.message || "تم الحفظ.", "ok");
  else toast(res.error || "تعذر تنفيذ العملية.", "err");
}

function bindUsersPage() {
  const addBtn = $("#usr-add-btn");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const fullName = $("#usr-add-name").value.trim();
      const username = $("#usr-add-username").value.trim();
      const role = $("#usr-add-role").value;
      const password = $("#usr-add-password").value;
      if (!fullName) {
        toast("أدخل الاسم الكامل.", "err");
        return;
      }
      if (username.length < 3) {
        toast("اسم المستخدم 3 أحرف على الأقل.", "err");
        return;
      }
      if (password.length < 8) {
        toast("كلمة المرور 8 أحرف على الأقل.", "err");
        return;
      }
      addBtn.disabled = true;
      const res = await createUser({ username, full_name: fullName, role, password });
      addBtn.disabled = false;
      userFeedback(res, "تم إنشاء الحساب بنجاح.");
      if (res.ok) render();
    });
  }

  const refreshBtn = $("#usr-refresh");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", async () => {
      refreshBtn.disabled = true;
      const res = await fetchUsers();
      refreshBtn.disabled = false;
      if (res.ok) {
        toast("تم تحديث قائمة المستخدمين.", "ok");
        render();
      } else {
        toast(res.error || "تعذر تحديث القائمة.", "err");
      }
    });
  }

  $$("[data-user-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const user = snapshotUsers().find((u) => String(u.id) === String(btn.dataset.userEdit));
      if (!user) return;
      openModal(`
        <h3>تعديل الحساب</h3>
        <label class="field"><span>الاسم الكامل</span><input type="text" id="usr-edit-name" value="${esc(user.full_name || "")}"></label>
        <label class="field"><span>اسم المستخدم</span><input type="text" id="usr-edit-username" value="${esc(user.username || "")}" dir="ltr"></label>
        <label class="field"><span>الدور</span><select id="usr-edit-role">${userRoleOptions(user.role)}</select></label>
        <div class="modal-actions">
          <button class="btn btn-primary" id="usr-edit-save">حفظ</button>
          <button class="btn btn-ghost" data-modal-close>إلغاء</button>
        </div>`);
      $("#modal-box [data-modal-close]").addEventListener("click", closeModal);
      $("#usr-edit-save").addEventListener("click", async () => {
        const full_name = $("#usr-edit-name").value.trim();
        const username = $("#usr-edit-username").value.trim();
        const role = $("#usr-edit-role").value;
        if (!full_name || username.length < 3) {
          toast("أدخل الاسم الكامل واسم مستخدم من 3 أحرف على الأقل.", "err");
          return;
        }
        const res = await updateUser(user.id, { username, full_name, role });
        userFeedback(res, "تم تحديث الحساب.");
        if (res.ok) {
          closeModal();
          render();
        }
      });
    });
  });

  $$("[data-user-pass]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const user = snapshotUsers().find((u) => String(u.id) === String(btn.dataset.userPass));
      if (!user) return;
      openModal(`
        <h3>تغيير كلمة المرور</h3>
        <p class="small muted">${esc(user.full_name || user.username)} — ${esc(user.username)}</p>
        <label class="field"><span>كلمة المرور الجديدة</span><input type="password" id="usr-pass-new" placeholder="8 أحرف على الأقل"></label>
        <div class="modal-actions">
          <button class="btn btn-primary" id="usr-pass-save">حفظ كلمة المرور</button>
          <button class="btn btn-ghost" data-modal-close>إلغاء</button>
        </div>`);
      $("#modal-box [data-modal-close]").addEventListener("click", closeModal);
      $("#usr-pass-save").addEventListener("click", async () => {
        const password = $("#usr-pass-new").value;
        if (password.length < 8) {
          toast("كلمة المرور 8 أحرف على الأقل.", "err");
          return;
        }
        const res = await resetUserPassword(user.id, password);
        userFeedback(res, "تم تغيير كلمة المرور.");
        if (res.ok) {
          closeModal();
          render();
        }
      });
    });
  });

  $$("[data-user-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const user = snapshotUsers().find((u) => String(u.id) === String(btn.dataset.userToggle));
      if (!user) return;
      const verb = user.active ? "تعطيل" : "تفعيل";
      if (!window.confirm(`هل تريد ${verb} حساب «${user.full_name || user.username}»؟`)) return;
      const res = await toggleUser(user.id);
      userFeedback(res, `تم ${verb} الحساب.`);
      if (res.ok) render();
    });
  });

  $$("[data-user-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const user = snapshotUsers().find((u) => String(u.id) === String(btn.dataset.userDelete));
      if (!user) return;
      if (!window.confirm(`هل تريد حذف حساب «${user.full_name || user.username}» نهائياً؟`)) return;
      const res = await deleteUser(user.id);
      userFeedback(res, "تم حذف الحساب.");
      if (res.ok) render();
    });
  });

  // تحميل القائمة من الخادم مرة واحدة عند فتح الصفحة.
  if (!usersPageLoaded) {
    usersPageLoaded = true;
    if (isOnline()) {
      fetchUsers().then((res) => {
        if (res.ok && currentPage === "users") render();
      });
    }
  }
}

function bindSettingsPage() {
  const saveBtn = $("#cfg-save");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      const url = $("#cfg-server").value.trim();
      saveConfig({ server_url: url });
      toast("تم حفظ عنوان الخادم.", "ok");
      render();
    });
  }
  const testBtn = $("#cfg-test");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      const status = $("#cfg-server-status");
      if (status) status.textContent = "جارٍ الفحص...";
      const res = await testServerConnection();
      if (status) status.textContent = res.ok ? `متصل ✓ ${res.base}` : (res.error || "تعذر الاتصال.");
    });
  }
  const pinBtn = $("#cfg-pin-save");
  if (pinBtn) {
    pinBtn.addEventListener("click", async () => {
      const pin = $("#cfg-pin").value.trim();
      if (pin.length < 4) {
        toast("الرمز المحلي يجب أن يكون 4 أرقام على الأقل.", "err");
        return;
      }
      const username = (state.session || getIdentity() || {}).username;
      if (!username) {
        toast("سجّل الدخول أولاً.", "err");
        return;
      }
      await setLocalPin(pin, username);
      toast("تم حفظ الرمز المحلي على هذا الجهاز.", "ok");
    });
  }
  const syncBtn = $("#cfg-sync");
  if (syncBtn) {
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      const result = await syncEverything();
      syncBtn.disabled = false;
      if (result.snapshot?.ok) toast("تم تحديث البيانات من الخادم.", "ok");
      else toast(result.snapshot?.error || "تعذر التحديث.", "err");
      render();
    });
  }
  const logoutBtn = $("#cfg-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearSession();
      location.reload();
    });
  }
}

/* ---------- إنشاء الطلب ---------- */

VIEWS.new = () => {
  const emp = draft.employee;
  const items = activeServiceItems();
  const cycle = emp ? employeeCycle(emp, draft.service_date) : null;
  const warnings = emp ? shiftWarnings(emp, draft.service_date) : [];
  return `
    <div class="card">
      <h3 class="card-title">بيانات الموظف</h3>
      <label class="field">
        <span>ابحث بكود الموظف أو اسمه</span>
        <input type="search" id="emp-search" placeholder="مثال: 20848 أو اسم الموظف" autocomplete="off">
      </label>
      <ul class="result-list hidden" id="emp-results"></ul>
      ${emp ? `
        <div class="alert alert-info" style="margin-top:10px">
          <strong>${esc(emp.name)}</strong> — ${esc(emp.employee_code)}<br>
          <span class="small">${esc(emp.company || "")} ${emp.department ? "· " + esc(emp.department) : ""}</span><br>
          ${emp.service_type ? `<span class="small">نوع الخدمة: ${esc(emp.service_type)}</span><br>` : ""}
          ${cycle?.known ? `<span class="small">يوم الدورة ${cycle.cycle_day} من ${cycle.cycle_length} — الحالة: ${esc(cycle.status)} (غداً: ${esc(cycle.tomorrow_status)})</span>` : ""}
        </div>
        ${warnings.length ? `<div class="warn-box"><strong>تنبيهات التوافق:</strong><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
        <button class="btn btn-ghost btn-sm" id="emp-clear">تغيير الموظف</button>
      ` : `<p class="small muted">اختر موظفاً من قاعدة البيانات للمتابعة.</p>`}
    </div>

    <div class="card">
      <h3 class="card-title">تفاصيل الطلب</h3>
      <label class="field">
        <span>تاريخ الخدمة</span>
        <input type="date" id="order-date" value="${esc(draft.service_date)}">
      </label>
      <label class="field">
        <span>اسم الزائر (للسجل العام فقط)</span>
        <input type="text" id="order-person" value="${esc(draft.person_name)}" placeholder="اتركه فارغاً لموظف مسجّل">
      </label>
      <label class="field">
        <span>ملاحظات</span>
        <textarea id="order-notes" placeholder="أي تفاصيل إضافية">${esc(draft.notes)}</textarea>
      </label>
    </div>

    <div class="card">
      <h3 class="card-title">الأصناف والكميات</h3>
      ${items.length ? items.map((item) => {
        const line = draft.items[item.id] || {};
        return `<div class="item-row">
          <div>
            <div>${esc(item.name)}</div>
            <div class="item-meta">${esc(item.unit)} · ${money(item.rate)} ${esc(settings().currency || "")}</div>
          </div>
          <input type="number" inputmode="decimal" step="0.5" min="0" data-item="${item.id}"
                 value="${line.quantity ?? ""}" placeholder="0">
          <button class="icon-btn sm" data-remove-item="${item.id}" title="مسح">✕</button>
        </div>`;
      }).join("") : '<p class="small muted">لا توجد خدمات مفعّلة. أضف الخدمات من صفحة «الخدمات والأسعار».</p>'}
      <div style="margin-top:12px;display:flex;align-items:center;gap:10px">
        <strong>الإجمالي التقديري:</strong>
        <strong id="order-total">${money(computeTotal())}</strong>
      </div>
    </div>

    <button class="btn btn-primary btn-block" id="order-save" ${emp ? "" : "disabled"}>
      حفظ الطلب وإرساله
    </button>
    <p class="small muted center" style="margin-top:8px">
      يُحفظ الطلب على الجهاز فوراً، ثم يُرسل إلى الخادم تلقائياً عند توفر الاتصال.
    </p>`;
};

function computeTotal() {
  let total = 0;
  for (const [itemId, line] of Object.entries(draft.items || {})) {
    const qty = Number(line.quantity || 0);
    if (!qty) continue;
    const item = serviceItems().find((i) => String(i.id) === String(itemId));
    total += qty * Number(line.unit_price ?? item?.rate ?? 0);
  }
  return total;
}

function bindNewOrderPage() {
  const search = $("#emp-search");
  if (search) {
    search.addEventListener("input", () => {
      const list = $("#emp-results");
      const q = search.value.trim();
      if (!q) {
        list.classList.add("hidden");
        list.innerHTML = "";
        return;
      }
      const exact = searchEmployee(q);
      const results = exact ? [exact] : findEmployeesByName(q);
      if (!results.length) {
        list.innerHTML = '<li class="result-item"><span class="name muted">لا يوجد موظف مطابق</span></li>';
        list.classList.remove("hidden");
        return;
      }
      list.innerHTML = results.map((e) => `<li class="result-item" data-code="${esc(e.employee_code)}">
          <span class="code">${esc(e.employee_code)}</span>
          <span class="name">${esc(e.name)}</span>
          ${e.service_type ? `<span class="pill pill-service">${esc(e.service_type)}</span>` : ""}
        </li>`).join("");
      list.classList.remove("hidden");
    });
  }

  const dateInput = $("#order-date");
  if (dateInput) {
    dateInput.addEventListener("change", () => {
      draft.service_date = dateInput.value || todayIso();
      render();
    });
  }
  const personInput = $("#order-person");
  if (personInput) personInput.addEventListener("input", () => { draft.person_name = personInput.value; });
  const notesInput = $("#order-notes");
  if (notesInput) notesInput.addEventListener("input", () => { draft.notes = notesInput.value; });

  $$("[data-item]").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.item;
      const qty = Number(input.value || 0);
      const item = serviceItems().find((i) => String(i.id) === String(id));
      if (qty > 0) {
        draft.items[id] = { quantity: qty, unit_price: Number(item?.rate || 0), item_name: item?.name || "" };
      } else {
        delete draft.items[id];
      }
      const totalEl = $("#order-total");
      if (totalEl) totalEl.textContent = money(computeTotal());
    });
  });

  $$("[data-remove-item]").forEach((btn) => {
    btn.addEventListener("click", () => {
      delete draft.items[btn.dataset.removeItem];
      render();
    });
  });

  const clearBtn = $("#emp-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      draft.employee = null;
      render();
    });
  }

  const saveBtn = $("#order-save");
  if (saveBtn) saveBtn.addEventListener("click", saveOrder);
}

/* بناء أقسام التقرير الكامل: الطلبات ثم دفعات الاستلام ثم (للمشرف/المدير) الطلبات غير المعتمدة والإجماليات. */
function buildOrdersExportSections() {
  const isReviewer = canReviewOrders();
  const orders = filteredOrders();
  const role = currentRole();
  const roleLabel = { admin: "مدير النظام", contractor: "متعهد المغسلة", supervisor: "مشرف السكن", super_admin: "مدير عام" }[role] || role || "";

  const orderRows = orders.map((o, index) => {
    const emp = searchEmployee(o.employee_code);
    const name = emp ? emp.name : (o.employee_name || o.employee_code);
    const itemsText = Object.entries(o.items || {}).map(([id, line]) => {
      const item = serviceItems().find((i) => String(i.id) === String(id));
      return `${line.item_name || item?.name || id}: ${line.quantity}`;
    }).join(" | ");
    const isSent = o.sync_state === "created" || o.sync_state === "duplicate" || o.source === "server";
    const deliveryState = orderDeliveryState(o);
    const deliveryText = deliveryState === "received" ? "مستلمة كاملة" : deliveryState === "partial" ? "مستلمة جزئياً" : "لم يتم الاستلام";
    const confirmer = orderConfirmerInfo(o);
    const receipts = (Array.isArray(o.receipts) ? o.receipts : []).filter((r) => (r.items || []).length || r.receiver_name);
    const lastReceiver = receipts.length ? receipts[receipts.length - 1].receiver_name : (o.receiver_name || "");
    return [
      index + 1,
      o.reference || (isSent ? "" : "بانتظار الإرسال"),
      o.service_date || "",
      (o.created_at || "").replace("T", " ").slice(0, 16),
      orderCreatorName(o),
      name,
      o.employee_code || "",
      o.person_name || "",
      itemsText,
      Number(orderTotal(o).toFixed(2)),
      isSent ? "مُرسل" : "محلي",
      STATUS_LABELS[o.status] || o.status || "قيد الاعتماد",
      isReviewer ? confirmer.label + ": " + (confirmer.value || "—") : "",
      deliveryText,
      lastReceiver,
      receipts.length ? String(receipts.length) : (deliveryState === "not-received" ? "0" : ""),
    ];
  });

  const orderHeaders = [
    "#", "رقم الطلب", "تاريخ الخدمة", "تاريخ الإنشاء", "أنشأ الطلب", "الموظف",
    "الكود", "الزائر", "الأصناف المطلوبة", "القيمة", "حالة الإرسال",
  ];
  if (isReviewer) orderHeaders.push("الاعتماد (المُعتمد وتاريخه)");
  orderHeaders.push("حالة التسليم", "آخر مستلم", "عدد دفعات الاستلام");

  /* دفعة واحدة لكل مستلم: رقم الطلب + الدفعة + من استلم + متى + ماذا استلم. */
  const receiptRows = [];
  let receiptNo = 0;
  for (const o of orders) {
    const emp = searchEmployee(o.employee_code);
    const name = emp ? emp.name : (o.employee_name || o.employee_code);
    const receipts = (Array.isArray(o.receipts) ? o.receipts : []).filter((r) => (r.items || []).length || r.receiver_name);
    receipts.forEach((receipt, idx) => {
      receiptNo += 1;
      receiptRows.push([
        receiptNo,
        o.reference || o.client_uuid || "",
        name,
        o.employee_code || "",
        `دفعة ${idx + 1}`,
        receipt.receiver_name || "نفس الموظف",
        receipt.receiver_kind === "other" ? "شخص آخر" : "الموظف نفسه",
        (receipt.received_at || "").replace("T", " ").slice(0, 16),
        receipt.recorded_by_name || "",
        (receipt.items || []).map((line) => `${line.item_name || "صنف"} × ${line.quantity}`).join(" | "),
        (receipt.items || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0),
      ]);
    });
  }

  const totals = orders.reduce(
    (acc, o) => {
      acc.total += Number(orderTotal(o) || 0);
      const state = orderDeliveryState(o);
      acc[state] += 1;
      return acc;
    },
    { total: 0, "not-received": 0, partial: 0, received: 0 }
  );
  const currency = settings().currency || "";

  const sections = [
    {
      heading: `قائمة الطلبات (${orders.length})`,
      headers: orderHeaders,
      rows: orderRows,
    },
    {
      heading: `سجل دفعات الاستلام والمستلمين (${receiptNo})`,
      headers: ["#", "رقم الطلب", "الموظف", "الكود", "الدفعة", "المستلم", "صفة المستلم", "تاريخ الاستلام", "رصدها", "الأصناف المستلمة", "عدد القطع"],
      rows: receiptRows,
    },
  ];

  if (isReviewer) {
    const notApprovedRows = orders
      .filter((o) => !o.status || o.status === "pending")
      .map((o, index) => {
        const emp = searchEmployee(o.employee_code);
        const name = emp ? emp.name : (o.employee_name || o.employee_code);
        const isSent = o.sync_state === "created" || o.sync_state === "duplicate" || o.source === "server";
        return [
          index + 1,
          o.reference || o.client_uuid || "",
          o.service_date || "",
          name,
          o.employee_code || "",
          Number(orderTotal(o).toFixed(2)),
          orderCreatorName(o) || "",
          (o.created_at || "").replace("T", " ").slice(0, 16),
          orderDeliveryState(o) === "received" ? "مستلمة كاملة" : orderDeliveryState(o) === "partial" ? "جزئياً" : "لم يتم الاستلام",
          isSent ? "" : "لم يُرسَل للخادم بعد",
        ];
      });
    sections.push({
      heading: `الطلبات غير المعتمدة — بانتظار مراجعة المشرف (${notApprovedRows.length})`,
      headers: ["#", "رقم الطلب", "تاريخ الخدمة", "الموظف", "الكود", "القيمة", "أنشأ الطلب", "تاريخ الإنشاء", "حالة التسليم", "ملاحظة"],
      rows: notApprovedRows,
    });
  }

  const totalsSection = {
    heading: "الإجماليات",
    headers: ["البيان", "القيمة"],
    rows: [
      ["عدد الطلبات", orders.length],
      ["إجمالي القيمة", Number(totals.total.toFixed(2)) + (currency ? " " + currency : "")],
      ["مستلمة كاملة", totals.received],
      ["مستلمة جزئياً", totals.partial],
      ["غير مستلمة", totals["not-received"]],
      ["إجمالي دفعات الاستلام", receiptNo],
    ],
  };
  if (isReviewer) totalsSection.rows.push(["غير معتمدة", orders.filter((o) => !o.status || o.status === "pending").length]);
  sections.push(totalsSection);

  return { role, roleLabel, orders, sections, totalValue: totals.total, currency };
}

/* نص سطر التقارير (URI/Web) — أُعيد استخدامه للتصدير بنفس معايير الفلاتر. */
function ordersExportMeta() {
  const { orders, roleLabel, totalValue, currency } = buildOrdersExportSections();
  const deliveryLabel = ORDER_DELIVERY_LABELS[ordersFilter.delivery] || ordersFilter.delivery;
  const statusLabelOrder = canReviewOrders() ? " · الحالة: " + (ORDER_STATUS_LABELS_ALL[ordersFilter.status] || "الكل") : "";
  return [
    `المستخدم: ${state.session?.full_name || ""} (${roleLabel})`,
    `التاريخ: ${todayIso()} · الفلاتر: حالة التسليم = ${deliveryLabel}${statusLabelOrder}`
      + (ordersFilter.q ? ` · بحث: «${ordersFilter.q}»` : "")
      + (ordersFilter.from || ordersFilter.to ? ` · من ${ordersFilter.from || "—"} إلى ${ordersFilter.to || "—"}` : ""),
    `النتيجة: ${orders.length} طلب · الإجمالي ${Number(totalValue.toFixed(2))} ${currency}`,
  ];
}

/* إعادة ربط واجهة الطلبات بعد كل عرض (فلاتر + بحث + ترقيم + تصدير). */
function bindOrdersPage() {
  $$("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => showOrderDetail(btn.dataset.detail));
  });
  /* الفلاتر: حالة التسليم وحالة الاعتماد */
  $$("[data-odelivery]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ordersFilter.delivery = btn.dataset.odelivery;
      ordersPage = 1;
      render();
    });
  });
  $$("[data-ostatus]").forEach((btn) => {
    btn.addEventListener("click", () => {
      ordersFilter.status = btn.dataset.ostatus;
      ordersPage = 1;
      render();
    });
  });
  const clearBtn = $("#orders-clear-filters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      ordersFilter = { delivery: "all", status: "all", q: "", from: "", to: "" };
      ordersPage = 1;
      render();
    });
  }
  /* بحث نصي: مع تأخير بسيط حتى لا يفقد المؤشر تركيزه بعد كل حرف */
  const qInput = $("#orders-q");
  if (qInput) {
    let timer = null;
    const applyQuery = () => {
      if (qInput.value.trim() === ordersFilter.q.trim()) return;
      ordersFilter.q = qInput.value;
      ordersPage = 1;
      render();
      const again = $("#orders-q");
      if (again) {
        again.focus();
        const end = again.value.length;
        again.setSelectionRange(end, end);
      }
    };
    qInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(applyQuery, 400);
    });
    qInput.addEventListener("search", applyQuery);
  }
  const fromInput = $("#orders-from");
  const toInput = $("#orders-to");
  if (fromInput) {
    fromInput.addEventListener("change", () => {
      ordersFilter.from = fromInput.value;
      ordersPage = 1;
      render();
    });
  }
  if (toInput) {
    toInput.addEventListener("change", () => {
      ordersFilter.to = toInput.value;
      ordersPage = 1;
      render();
    });
  }
  const prevBtn = $("#orders-prev");
  const nextBtn = $("#orders-next");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      ordersPage = Math.max(ordersPage - 1, 1);
      render();
      window.scrollTo({ top: 0 });
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      ordersPage += 1;
      render();
      window.scrollTo({ top: 0 });
    });
  }
  const reloadBtn = $("#btn-reload-orders");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", async () => {
      reloadBtn.disabled = true;
      const res = await fetchServerOrders();
      reloadBtn.disabled = false;
      toast(res.ok ? `تم تحميل ${res.count} طلباً من الخادم.` : (res.error || "تعذر التحميل."), res.ok ? "ok" : "warn");
      render();
    });
  }
  const doExportPdf = () => {
    try {
      const { sections, orders } = buildOrdersExportSections();
      if (!orders.length) {
        toast("لا توجد طلبات مطابقة للتصدير.", "warn");
        return;
      }
      printReportSections(
        "قائمة طلبات المغسلة الكاملة",
        ordersExportMeta(),
        sections,
        ""
      );
      toast("تم إنشاء التقرير للطباعة (PDF).", "ok");
    } catch (err) {
      toast("تعذر إنشاء PDF: " + err.message, "err");
    }
  };
  const doExportXls = () => {
    try {
      const { sections, orders } = buildOrdersExportSections();
      if (!orders.length) {
        toast("لا توجد طلبات مطابقة للتصدير.", "warn");
        return;
      }
      const stamp = todayIso().replace(/-/g, "");
      downloadSectionsXls(
        `laundry-orders-${stamp}.xls`,
        "الطلبات",
        "قائمة طلبات المغسلة الكاملة",
        ordersExportMeta(),
        sections
      );
      toast("تم إنشاء ملف Excel.", "ok");
    } catch (err) {
      toast("تعذر إنشاء ملف Excel: " + err.message, "err");
    }
  };
  const xlsBtn = $("#orders-export-xls");
  if (xlsBtn) xlsBtn.addEventListener("click", doExportXls);
  const pdfBtn = $("#orders-export-pdf");
  if (pdfBtn) pdfBtn.addEventListener("click", doExportPdf);
  const csvBtn = $("#orders-export-csv");
  if (csvBtn) {
    csvBtn.addEventListener("click", () => {
      try {
        const { sections, orders } = buildOrdersExportSections();
        if (!orders.length) {
          toast("لا توجد طلبات مطابقة للتصدير.", "warn");
          return;
        }
        const stamp = todayIso().replace(/-/g, "");
        const main = sections[0];
        downloadCsv(`laundry-orders-${stamp}.csv`, toCsv(main.headers, main.rows));
        toast("تم إنشاء ملف CSV (الطلبات).", "ok");
      } catch (err) {
        toast("تعذر إنشاء CSV: " + err.message, "err");
      }
    });
  }
}

/* ---------- إنشاء الطلب (حفظ) ---------- */

async function saveOrder() {
  if (!draft.employee) {
    toast("اختر موظفاً أولاً.", "err");
    return;
  }
  const lines = Object.entries(draft.items || {}).filter(([, l]) => Number(l.quantity || 0) > 0);
  if (!lines.length) {
    toast("أضف صنفاً واحداً على الأقل بالكمية المناسبة.", "err");
    return;
  }
  if (draft.employee.person_type === "general" && !draft.person_name.trim()) {
    toast("للسجل العام اكتب اسم الزائر الفعلي.", "err");
    return;
  }
  const clientUuid = uuid();
  const items = {};
  for (const [itemId, line] of lines) items[itemId] = line;
  const order = {
    client_uuid: clientUuid,
    employee_id: Number(draft.employee.id) || null,
    employee_code: draft.employee.employee_code,
    employee_name: draft.employee.name,
    person_name: draft.person_name.trim(),
    service_date: draft.service_date,
    notes: draft.notes.trim(),
    items,
    created_at: nowIso(),
    sync_state: "pending",
  };
  saveLocalOrder(order);
  enqueueOrder(order);
  toast("تم حفظ الطلب — انتقل إلى مرحلة التسليم.", "ok");

  if (isOnline()) {
    const res = await syncOrders();
    if (res.pushed) toast(`تم إرسال ${res.pushed} طلب إلى الخادم.`, "ok");
  }
  draft = { employee: null, items: {}, person_name: "", notes: "", service_date: todayIso() };
  // عرض الطلب الجديد دائماً: مسح الفلاتر ثم الانتقال وفتح التفاصيل (مرحلة التسليم).
  ordersFilter = { delivery: "all", status: "all", q: "", from: "", to: "" };
  ordersPage = 1;
  // الطلب ينتهي مرحلة الإنشاء ويدخل مرحلة التسليم/الاستلام: تُعرض قائمة الطلبات مع فتح الطلب الجديد
  // مباشرةً (يعمل دون اتصال — التسليم يُحفظ محلياً ويتزامن لاحقاً).
  setPage("orders");
  showOrderDetail(clientUuid);
}

/* ---------- تصدير تفاصيل طلب واحد (PDF منسق / مشاركة واتساب) ---------- */

/* يُبنى من حالة الطلب الحالية عند كل ضغطة: يظهر تفاصيل ما قبل التسليم وما بعده وتاريخ التغيّر. */
function buildOrderDetailSections(order) {
  const o = getOrderByUuid(order.client_uuid || order.uuid) || order;
  const emp = searchEmployee(o.employee_code);
  const name = emp ? emp.name : (o.employee_name || o.employee_code);
  const isSent = o.sync_state === "created" || o.sync_state === "duplicate" || o.source === "server";
  const deliveryState = orderDeliveryState(o);
  const deliveryText = deliveryState === "received"
    ? "مستلمة كاملة"
    : deliveryState === "partial" ? "مستلمة جزئياً — بانتظار استلام الباقي" : "لم يتم الاستلام بعد";
  const confirmer = orderConfirmerInfo(o);
  const statusText = STATUS_LABELS[o.status] || (!o.status || o.status === "pending" ? "قيد الاعتماد" : o.status);
  const role = currentRole();
  const roleLabel = { admin: "مدير النظام", contractor: "متعهد المغسلة", supervisor: "مشرف السكن", super_admin: "مدير عام" }[role] || role || "";
  const receipts = (Array.isArray(o.receipts) ? o.receipts : []).filter((r) => (r.items || []).length || r.receiver_name);
  const fmt = (v) => String(v || "").replace("T", " ").slice(0, 16);
  const meta = [
    `الطلب: ${o.reference || (isSent ? "" : "محلي · بانتظار الإرسال") || o.client_uuid}`,
    `الموظف: ${name} — الكود ${o.employee_code}${o.person_name ? " · الزائر: " + o.person_name : ""}`,
    `تاريخ الخدمة: ${o.service_date || "-"} · تاريخ الإنشاء: ${fmt(o.created_at)}${orderCreatorName(o) ? " · أنشأ الطلب: " + orderCreatorName(o) : ""}`,
    `حالة المراجعة: ${statusText}${o.status === "approved" ? ` · اعتمده: ${confirmer.value || "-"}` : ""}${o.status === "rejected" ? ` · سبب الرفض: ${o.rejection_reason || "-"}` : ""}`,
    `حالة التسليم: ${deliveryText}${o.delivered_at ? ` · آخر تسليم: ${fmt(o.delivered_at)}` : ""}${receipts.length ? ` · عدد دفعات الاستلام: ${receipts.length}` : ""}`,
    `القيمة الإجمالية: ${money(orderTotal(o))} ${settings().currency || ""}`,
    `المستخدم: ${state.session?.full_name || ""} (${roleLabel}) · تاريخ الإصدار: ${new Date().toLocaleString("ar")}`,
  ];
  const items = Object.entries(o.items || {});
  const itemRows = items.map(([itemId, line], index) => {
    const item = serviceItems().find((i) => String(i.id) === String(itemId));
    const received = Number(line.received_quantity || 0);
    const remaining = Math.max(Number(line.quantity || 0) - received, 0);
    return [
      index + 1,
      line.item_name || item?.name || itemId,
      line.unit || (item ? item.unit : "") || "",
      Number(line.quantity || 0),
      received,
      remaining,
      Number(itemRate(line, itemId)),
      Number((Number(line.quantity || 0) * itemRate(line, itemId)).toFixed(2)),
    ];
  });
  const receiptRows = receipts.map((receipt, index) => {
    const totalQty = (receipt.items || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    return [
      index + 1,
      fmt(receipt.received_at) || "-",
      receipt.receiver_name || "نفس الموظف",
      receipt.receiver_kind === "other" ? "شخص آخر" : "الموظف نفسه",
      receipt.recorded_by_name || "",
      (receipt.items || []).map((line) => `${line.item_name || "صنف"} × ${line.quantity}`).join(" | "),
      Number(totalQty.toFixed(2)),
    ];
  });
  const sections = [
    {
      heading: `أصناف الطلب (${items.length})`,
      headers: ["#", "الصنف", "الوحدة", "الكمية المطلوبة", "الكمية المستلمة", "المتبقي", "سعر الوحدة", "الإجمالي"],
      rows: itemRows,
    },
  ];
  if (receiptRows.length) {
    sections.push({
      heading: `سجل دفعات الاستلام والمستلمين (${receiptRows.length})`,
      headers: ["#", "التاريخ", "المستلم", "صفة المستلم", "رصدها", "الأصناف المستلمة", "عدد القطع"],
      rows: receiptRows,
    });
  }
  return { order: o, meta, sections, deliveryText, statusText, employeeName: name };
}

/* PDF منسق — يُطبَع أو يُحفَظ عبر PrintManager على الهاتف مباشرة من نافذة التفاصيل. */
function printOrderDetail(order) {
  try {
    const { meta, sections } = buildOrderDetailSections(order);
    printReportSections(`تفاصيل الطلب ${order.reference || ""}`.trim(), meta, sections, "");
    toast("تم تجهيز تقرير الطلب (PDF).", "ok");
  } catch (err) {
    toast("تعذر تجهيز PDF: " + err.message, "err");
  }
}

/* مشاركة كامل تفاصيل الطلب على واتساب أو أي تطبيق مشاركة. */
function shareOrderToWhatsApp(order) {
  try {
    const { meta, sections, order: fresh } = buildOrderDetailSections(order);
    const blocks = sections.map((section) => {
      const head = `*${section.heading}*`;
      const body = [section.headers.join(" | ")]
        .concat(section.rows.map((cells) => cells.map((cell) => String(cell ?? "")).join(" | ")));
      return [head, ...body].join("\n");
    });
    const subject = `*تفاصيل الطلب ${fresh.reference || fresh.client_uuid}*`;
    shareText(subject, [subject, ...meta, "", ...blocks].join("\n"));
  } catch (err) {
    toast("تعذر المشاركة: " + err.message, "err");
  }
}

/* ---------- تفاصيل الطلب والإجراءات ---------- */

function orderActionButtons(order) {
  const role = currentRole();
  const reviewable = !order.status || order.status === "pending";
  const remaining = orderRemaining(order);
  const received = orderReceived(order);
  const buttons = [];

  if (canManageOrders() && reviewable && received <= 0.0001) {
    buttons.push('<button class="btn btn-ghost btn-sm" data-act="edit">تعديل</button>');
  }
  if ((role === "admin" || (role === "contractor" && reviewable)) && (!order.server_id || reviewable)) {
    buttons.push('<button class="btn btn-danger btn-sm" data-act="delete">حذف</button>');
  }
  if (canManageOrders() && order.status !== "rejected" && remaining > 0.0001) {
    // التسليم متاح حتى للطلبات المحلية غير المُرسلة بعد — يعمل دون اتصال ويتزامن لاحقاً.
    buttons.push('<button class="btn btn-primary btn-sm" data-act="deliver">تسليم / استلام جزئي</button>');
  }
  if (canReviewOrders() && order.server_id && reviewable && order.fulfillment_status === "delivered" && remaining <= 0.0001) {
    buttons.push('<button class="btn btn-primary btn-sm" data-act="approve">اعتماد الطلب</button>');
  }
  if (canReviewOrders() && order.server_id && reviewable) {
    buttons.push('<button class="btn btn-ghost btn-sm" data-act="reject">إلغاء / رفض</button>');
  }
  if (!buttons.length) return "";
  return `<div class="modal-actions" id="order-actions" style="flex-wrap:wrap">${buttons.join("")}</div>`;
}

function showOrderDetail(clientUuid) {
  const order = getOrderByUuid(clientUuid);
  if (!order) return;
  const emp = searchEmployee(order.employee_code);
  const rows = Object.entries(order.items || {}).map(([itemId, line]) => {
    const item = serviceItems().find((i) => String(i.id) === String(itemId));
    const received = Number(line.received_quantity || 0);
    const remaining = Math.max(Number(line.quantity || 0) - received, 0);
    return `<tr><td>${esc(line.item_name || item?.name || itemId)}</td>
      <td class="num">${esc(line.quantity)}</td>
      <td class="num">${esc(received)}</td>
      <td class="num">${esc(remaining)}</td>
      <td class="num">${money(itemRate(line, itemId))}</td>
      <td class="num">${money(Number(line.quantity || 0) * itemRate(line, itemId))}</td></tr>`;
  }).join("");
  const isSent = order.sync_state === "created" || order.sync_state === "duplicate" || order.source === "server";
  const receivedTotal = orderReceived(order);
  const statusPill = isSent
    ? `<span class="pill pill-synced">مُرسل${order.reference ? " · " + esc(order.reference) : ""}</span>`
    : '<span class="pill pill-local">محلي · بانتظار الإرسال</span>';
  const warnings = (order.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
  const receipts = Array.isArray(order.receipts) ? order.receipts.filter((r) => (r.items || []).length) : [];
  const receiptsBlock = receipts.length ? `
    <p class="small" style="margin-top:10px"><strong>سجل دفعات الاستلام (${receipts.length})</strong></p>
    <ul class="list">${receipts.map((receipt, index) => `
      <li class="list-item" style="padding:8px 0">
        <div class="li-main">
          <div class="li-title">دفعة ${index + 1} — ${esc(receipt.receiver_name || "نفس الموظف")}${receipt.receiver_kind === "other" ? " (شخص آخر)" : ""}</div>
          <div class="li-sub">${esc(receipt.received_at ? String(receipt.received_at).replace("T", " ").slice(0, 16) : "")}${receipt.recorded_by_name ? " · رصدها: " + esc(receipt.recorded_by_name) : ""}</div>
          <div class="li-sub">${(receipt.items || []).map((line) => `${esc(line.item_name || "صنف")} × ${esc(line.quantity)}`).join(" · ")}</div>
          ${receipt._local ? '<div class="li-sub">بانتظار الإرسال إلى الخادم</div>' : ""}
        </div>
      </li>`).join("")}</ul>` : "";
  openModal(`
    <h3>تفاصيل الطلب ${statusPill} ${orderStatusPill(order)} ${orderDeliveryPill(order)}</h3>
    <p class="small">${esc(emp ? emp.name : (order.employee_name || order.employee_code))} — ${esc(order.employee_code)}</p>
    <p class="small muted">${esc(order.service_date)} ${order.person_name ? "· " + esc(order.person_name) : ""}</p>
    ${order.notes ? `<p class="small">${esc(order.notes)}</p>` : ""}
    ${order.rejection_reason ? `<div class="warn-box"><strong>سبب الرفض / الإلغاء:</strong> ${esc(order.rejection_reason)}</div>` : ""}
    ${order.receiver_name && receivedTotal > 0.0001 ? `<p class="small">آخر مستلم: ${esc(order.receiver_name)} ${order.receiver_kind === "other" ? "(شخص آخر)" : ""}</p>` : ""}
    ${receiptsBlock}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>الصنف</th><th>الكمية</th><th>المستلم</th><th>المتبقي</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="small"><strong>القيمة الإجمالية:</strong> ${money(orderTotal(order))} ${esc(settings().currency || "")}</p>
    ${warnings ? `<div class="warn-box"><strong>تنبيهات:</strong><ul>${warnings}</ul></div>` : ""}
    ${orderActionButtons(order)}
    <div class="modal-actions" style="flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" id="detail-export-pdf">تصدير PDF ▾</button>
      <button class="btn btn-ghost btn-sm" id="detail-share-wa">مشاركة واتساب ▾</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-modal-close>إغلاق</button>
    </div>`);
  const closeBtn = $("#modal-box [data-modal-close]");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  const detailPdfBtn = $("#detail-export-pdf");
  if (detailPdfBtn) detailPdfBtn.addEventListener("click", () => printOrderDetail(order));
  const detailShareBtn = $("#detail-share-wa");
  if (detailShareBtn) detailShareBtn.addEventListener("click", () => shareOrderToWhatsApp(order));
  const actions = $("#modal-box #order-actions");
  if (actions) {
    actions.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      runOrderAction(btn.dataset.act, order, btn);
    });
  }
}

function actionFeedback(res, successMessage, offlineMessage) {
  if (res.applied) {
    toast(successMessage, "ok");
  } else if (res.offline) {
    toast(offlineMessage || "تم الحفظ على الجهاز وسيُرسل عند عودة الاتصال.", "warn");
  } else if (res.failed && res.errors && res.errors.length) {
    toast(res.errors[0], "warn");
  } else if (res.failed) {
    toast("تعذر تنفيذ الإجراء. سيُعاد المحاولة عند المزامنة التالية.", "warn");
  } else {
    toast(offlineMessage || "تم الحفظ على الجهاز.", "warn");
  }
}

async function runOrderAction(action, order, btn) {
  if (action === "edit") {
    showEditOrderModal(order);
    return;
  }
  if (action === "deliver") {
    await showDeliverModal(order);
    return;
  }
  if (action === "reject") {
    showRejectOrderModal(order);
    return;
  }
  if (action === "delete") {
    await deleteOrder(order);
    return;
  }
  if (action === "approve") {
    if (btn) btn.disabled = true;
    const queued = queueAction("confirm", order, { decision: "approved" });
    if (!queued) {
      toast("لا يمكن اعتماد طلب لم يُرسل إلى الخادم بعد.", "warn");
      if (btn) btn.disabled = false;
      return;
    }
    const res = await syncActions();
    actionFeedback(res, "تم اعتماد الطلب.", "تم حفظ الاعتماد وسيُرسل عند عودة الاتصال.");
    closeModal();
    render();
  }
}

async function deleteOrder(order) {
  if (!window.confirm("هل تريد حذف الطلب نهائياً؟")) return;
  if (order.server_id) {
    queueAction("delete", order, {}, {});
    const res = await syncActions();
    actionFeedback(res, "تم حذف الطلب.", "تم حذف الطلب من الجهاز وسيُحذف من الخادم عند عودة الاتصال.");
  } else {
    dequeueOrder(order.client_uuid);
    deleteLocalOrder(order.client_uuid);
    toast("تم حذف الطلب المحلي.", "ok");
  }
  closeModal();
  render();
}

/* نافذة تعديل الطلب — للطلبات غير المعتمدة وغير المسلّمة. */
function showEditOrderModal(order) {
  const emp = searchEmployee(order.employee_code);
  const existing = order.items || {};
  const list = serviceItems().filter((item) => item.active !== false || existing[item.id] != null);
  const rows = list.map((item) => {
    const line = existing[item.id] || {};
    return `<div class="item-row">
      <div>
        <div>${esc(item.name)}</div>
        <div class="item-meta">${esc(item.unit)} · ${money(item.rate)} ${esc(settings().currency || "")}</div>
      </div>
      <input type="number" inputmode="decimal" step="0.5" min="0" data-edit-item="${item.id}"
             value="${line.quantity ?? ""}" placeholder="0">
      <span></span>
    </div>`;
  }).join("");
  openModal(`
    <h3>تعديل الطلب</h3>
    <p class="small muted">${esc(emp ? emp.name : order.employee_name || order.employee_code)} — ${esc(order.employee_code)}</p>
    <label class="field"><span>تاريخ الخدمة</span>
      <input type="date" id="edit-service-date" value="${esc(order.service_date || todayIso())}">
    </label>
    <label class="field"><span>اسم الزائر (للسجل العام)</span>
      <input type="text" id="edit-person" value="${esc(order.person_name || "")}">
    </label>
    <label class="field"><span>ملاحظات</span>
      <textarea id="edit-notes">${esc(order.notes || "")}</textarea>
    </label>
    <div class="card" style="box-shadow:none;border:1px solid var(--line);padding:8px">
      <div class="small muted" style="margin-bottom:6px">الكميات</div>
      ${rows || '<p class="small muted">لا توجد خدمات مفعّلة.</p>'}
      <div style="margin-top:8px"><strong>القيمة التقديرية: </strong><strong id="edit-total">${money(orderTotal(order))}</strong></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="edit-save">حفظ التعديل</button>
      <button class="btn btn-ghost" data-modal-close>إلغاء</button>
    </div>`);
  const recalc = () => {
    let total = 0;
    $$("#modal-box [data-edit-item]").forEach((input) => {
      const qty = Number(input.value || 0);
      if (qty <= 0) return;
      const item = serviceItems().find((i) => String(i.id) === String(input.dataset.editItem));
      total += qty * Number(item?.rate || 0);
    });
    const el = $("#edit-total");
    if (el) el.textContent = money(total);
  };
  $$("#modal-box [data-edit-item]").forEach((input) => input.addEventListener("input", recalc));
  $("#modal-box [data-modal-close]").addEventListener("click", closeModal);
  $("#edit-save").addEventListener("click", async () => {
    const serviceDate = $("#edit-service-date").value || todayIso();
    const personName = $("#edit-person").value.trim();
    const notes = $("#edit-notes").value.trim();
    if (emp && emp.person_type === "general" && !personName) {
      toast("للسجل العام اكتب اسم الزائر الفعلي.", "err");
      return;
    }
    const localItems = {};
    const payloadItems = [];
    let total = 0;
    $$("#modal-box [data-edit-item]").forEach((input) => {
      const qty = Number(input.value || 0);
      if (qty <= 0) return;
      const itemId = input.dataset.editItem;
      const item = serviceItems().find((i) => String(i.id) === String(itemId));
      const previous = existing[itemId] || {};
      const rate = Number(previous.unit_price ?? item?.rate ?? 0);
      localItems[itemId] = {
        ...previous,
        quantity: qty,
        unit_price: rate,
        item_name: previous.item_name || item?.name || "",
        received_quantity: 0,
      };
      payloadItems.push({ service_item_id: Number(itemId), quantity: qty });
      total += qty * rate;
    });
    if (!payloadItems.length) {
      toast("أضف صنفاً واحداً على الأقل.", "err");
      return;
    }
    const localPatch = {
      employee_id: Number(order.employee_id || emp?.id) || null,
      employee_code: order.employee_code,
      employee_name: emp ? emp.name : order.employee_name,
      service_date: serviceDate,
      person_name: personName,
      notes,
      items: localItems,
      subtotal: total,
    };
    if (order.server_id) {
      const payload = {
        employee_id: localPatch.employee_id,
        employee_code: order.employee_code,
        service_date: serviceDate,
        person_name: personName,
        notes,
        items: payloadItems,
      };
      queueAction("update", order, payload, localPatch);
      const res = await syncActions();
      actionFeedback(res, "تم تعديل الطلب.", "تم حفظ التعديل على الجهاز وسيُرسل عند عودة الاتصال.");
    } else {
      saveLocalOrder({ ...order, ...localPatch });
      enqueueOrder({ ...order, ...localPatch });
      toast("تم تعديل الطلب المحلي.", "ok");
    }
    closeModal();
    render();
  });
}

/* نافذة التسليم الجزئي مع اختيار المستلم. */
async function showDeliverModal(order) {
  let current = order;
  // بعض الطلبات القديمة قد تفتقد معرّفات أصناف الخادم — نجلبها أولاً حتى لا يفشل التسليم.
  const missingIds = Object.values(current.items || {})
    .some((line) => line.id == null || line.id === "");
  if (missingIds && current.server_id && isOnline()) {
    const fresh = await refreshOrderFromServer(current.server_id, current.client_uuid);
    if (fresh) current = fresh;
  }
  const emp = searchEmployee(current.employee_code);
  const lines = Object.entries(current.items || {}).map(([key, line]) => ({
    key,
    line,
    serviceId: line.service_item_id != null ? line.service_item_id : key,
    remaining: Math.max(Number(line.quantity || 0) - Number(line.received_quantity || 0), 0),
  })).filter((row) => row.remaining > 0.0001);
  if (!lines.length) {
    toast("تم استلام جميع القطع مسبقاً.", "ok");
    return;
  }
  const sameName = emp ? emp.name : (current.employee_name || current.person_name || current.employee_code);
  const previousReceipts = (Array.isArray(current.receipts) ? current.receipts : [])
    .filter((r) => (r.items || []).length || r.receiver_name);
  const lastReceipt = previousReceipts[previousReceipts.length - 1];
  openModal(`
    <h3>تسليم / استلام قطع المغسلة</h3>
    <p class="small muted">حدّد الكميات المستلمة الآن. يمكن استلام الباقي لاحقاً.</p>
    ${previousReceipts.length ? `<p class="small muted" style="border:1px solid var(--line);border-radius:10px;padding:8px;margin-bottom:8px">دفعات استلام مسجَّلة سابقاً: <strong>${previousReceipts.length}</strong>${lastReceipt ? ` · آخر مستلم: ${esc(lastReceipt.receiver_name || "نفس الموظف")}` : ""}</p>` : ""}
    ${lines.map(({ line, remaining, serviceId }) => `<div class="item-row">
      <div>
        <div>${esc(line.item_name || line.name || "صنف")}</div>
        <div class="item-meta">المطلوب ${esc(line.quantity)} · المتبقي ${esc(remaining)}</div>
      </div>
      <input type="number" inputmode="decimal" step="0.5" min="0" max="${remaining}"
             data-deliver-id="${esc(line.id ?? "")}" data-deliver-service="${esc(serviceId)}" value="${remaining}">
      <span></span>
    </div>`).join("")}
    <label class="field" style="margin-top:12px"><span>مستلم الأصناف</span>
      <select id="deliver-receiver-kind">
        <option value="same_employee">نفس الموظف (${esc(sameName)})</option>
        <option value="other">عامل / شخص آخر</option>
      </select>
    </label>
    <label class="field hidden" id="deliver-other-wrap"><span>اسم المستلم الآخر</span>
      <input type="text" id="deliver-receiver-name" placeholder="اكتب اسم المستلم">
    </label>
    <div class="modal-actions">
      <button class="btn btn-primary" id="deliver-save">تأكيد التسليم</button>
      <button class="btn btn-ghost" data-modal-close>إلغاء</button>
    </div>`);
  const kindSelect = $("#deliver-receiver-kind");
  kindSelect.addEventListener("change", () => {
    $("#deliver-other-wrap").classList.toggle("hidden", kindSelect.value !== "other");
  });
  $("#modal-box [data-modal-close]").addEventListener("click", closeModal);
  $("#deliver-save").addEventListener("click", async () => {
    const receiverKind = kindSelect.value;
    const receiverName = receiverKind === "other" ? $("#deliver-receiver-name").value.trim() : sameName;
    if (receiverKind === "other" && !receiverName) {
      toast("اكتب اسم المستلم الآخر.", "err");
      return;
    }
    const pieces = [];
    let invalid = false;
    $$("#modal-box [data-deliver-id]").forEach((input) => {
      const qty = Number(input.value || 0);
      if (qty <= 0) return;
      const rawId = input.dataset.deliverId;
      const serviceId = Number(input.dataset.deliverService);
      const piece = { quantity: qty };
      if (rawId !== "" && Number.isFinite(Number(rawId))) piece.id = Number(rawId);
      if (Number.isFinite(serviceId)) piece.service_item_id = serviceId;
      if (piece.id == null && piece.service_item_id == null) {
        invalid = true;
        return;
      }
      pieces.push(piece);
    });
    if (invalid) {
      toast("تعذر تحديد أحد الأصناف. أعد تحميل الطلب ثم حاول مجدداً.", "err");
      return;
    }
    if (!pieces.length) {
      toast("أدخل كمية مستلمة واحدة على الأقل.", "err");
      return;
    }
    const queued = queueAction("deliver", current, {
      pieces,
      receiver_kind: receiverKind,
      receiver_name: receiverName,
    });
    if (!queued) {
      toast("تعذر تسجيل التسليم على هذا الطلب.", "warn");
      return;
    }
    const res = await syncActions();
    actionFeedback(res, "تم تسجيل التسليم.", "تم حفظ التسليم وسيُرسل عند عودة الاتصال.");
    closeModal();
    render();
  });
}

/* نافذة إلغاء / رفض الطلب مع سبب إلزامي. */
function showRejectOrderModal(order) {
  const isLocal = !order.server_id;
  openModal(`
    <h3>${isLocal ? "إلغاء الطلب المحلي" : "إلغاء / رفض الطلب"}</h3>
    <p class="small muted">${isLocal
      ? "سيُحذف الطلب المحلي غير المرسل نهائياً."
      : "سيُسجَّل الطلب كمرفوض مع سبب واضح."}</p>
    ${isLocal ? "" : `<label class="field"><span>سبب الرفض / الإلغاء (إلزامي)</span>
      <textarea id="reject-reason" placeholder="مثال: الكميات غير مطابقة أو بيانات الموظف غير صحيحة"></textarea>
    </label>`}
    <div class="modal-actions">
      <button class="btn btn-danger" id="reject-save">${isLocal ? "حذف الطلب" : "تأكيد الإلغاء"}</button>
      <button class="btn btn-ghost" data-modal-close>رجوع</button>
    </div>`);
  $("#modal-box [data-modal-close]").addEventListener("click", closeModal);
  $("#reject-save").addEventListener("click", async () => {
    if (isLocal) {
      dequeueOrder(order.client_uuid);
      deleteLocalOrder(order.client_uuid);
      toast("تم حذف الطلب المحلي.", "ok");
      closeModal();
      render();
      return;
    }
    const reason = $("#reject-reason").value.trim();
    if (!reason) {
      toast("اكتب سبب الرفض أولاً.", "err");
      return;
    }
    const queued = queueAction("confirm", order, { decision: "rejected", rejection_reason: reason });
    if (!queued) {
      toast("لا يمكن تنفيذ الإجراء قبل إرسال الطلب.", "warn");
      return;
    }
    const res = await syncActions();
    actionFeedback(res, "تم رفض / إلغاء الطلب.", "تم حفظ الرفض وسيُرسل عند عودة الاتصال.");
    closeModal();
    render();
  });
}

export function setDraftEmployee(emp) {
  draft.employee = emp;
  draft.person_name = "";
}

export { render, setPage, toast, closeModal, esc, money, openModal, currentRole };
