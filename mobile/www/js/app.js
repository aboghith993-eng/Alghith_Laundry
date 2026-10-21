/* تطبيق المغسلة للجوال — واجهة تعمل دون اتصال مع مزامنة تلقائية. */

import {
  state, loadSession, hasSession, clearSession, tryOnlineLogin, verifyLocalPin, hasLocalPin,
  setLocalPin, isOnline, setOnline, backendBaseUrl, saveConfig, getConfig,
  syncSnapshotFromServer, syncOrders, syncEverything, enqueueOrder, dequeueOrder,
  getQueue, pendingCount, getLocalOrders, saveLocalOrder, getOrderByUuid, searchEmployee,
  findEmployeesByName, serviceItems, settings, uuid, autoSync, snapshotMeta,
  queueAction, syncActions, pendingActionCount, isLocked, setLocked, getIdentity,
  fetchServerOrders,
} from "./store.js";

import { shiftWarnings, employeeCycle, todayIso, nowIso, formatDate } from "./shift.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ROLE_LABELS = { admin: "مدير النظام", contractor: "متعهد المغسلة", supervisor: "مشرف السكن" };
const STATUS_LABELS = { pending: "بانتظار التأكيد", approved: "معتمد", rejected: "مرفوض" };

let currentPage = "home";
let draft = { employee: null, items: {}, person_name: "", notes: "", service_date: todayIso() };

/* ---------- أدوات واجهة ---------- */

function toast(message, kind = "") {
  const area = $("#toast-area");
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => el.remove(), 3600);
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

function setPage(page) {
  currentPage = page;
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.page === page));
  const titles = {
    home: "الرئيسية", new: "طلب جديد", orders: "الطلبات",
    reports: "التقارير", settings: "الإعدادات",
  };
  $("#page-title").textContent = titles[page] || "";
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  const container = $("#page-container");
  const view = VIEWS[currentPage];
  container.innerHTML = view ? view() : "";
  if (currentPage === "new") bindNewOrderPage();
  if (currentPage === "orders") bindOrdersPage();
  if (currentPage === "settings") bindSettingsPage();
  updateSyncBadge();
}

function updateSyncBadge() {
  const badge = $("#sync-badge");
  const pending = pendingCount();
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
  $("#offline-banner").classList.toggle("hidden", isOnline());
}

/* ---------- الشاشات ---------- */

const VIEWS = {};

VIEWS.home = () => {
  const snap = snapshotMeta();
  const local = getLocalOrders();
  const pendingLocal = local.filter((o) => o.sync_state !== "created" && o.sync_state !== "duplicate");
  const user = state.session || {};
  const count = snap?.counts?.employees || 0;
  return `
    <div class="card">
      <h2 class="card-title">مرحباً ${esc(user.full_name || user.username || "")}</h2>
      <p class="muted small">الدور: ${esc(ROLE_LABELS[user.role] || user.role || "-")}</p>
      <div class="grid-4" style="margin-top:12px">
        <div class="stat"><div class="value">${count}</div><div class="label">موظف مسجّل</div></div>
        <div class="stat"><div class="value">${serviceItems().length}</div><div class="label">صنف خدمة</div></div>
        <div class="stat"><div class="value">${pendingLocal.length}</div><div class="label">طلب محلي</div></div>
        <div class="stat"><div class="value">${pendingCount()}</div><div class="label">بانتظار الإرسال</div></div>
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
        <button class="btn btn-ghost" data-go="settings">⚙ إعدادات الخادم</button>
      </div>
    </div>`;
};

VIEWS.orders = () => {
  const local = getLocalOrders();
  const items = local.slice(0, 120);
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
  if (!items.length) {
    return `${header}
      <div class="empty"><div class="big">≡</div><p>لا توجد طلبات محفوظة على هذا الجهاز بعد.</p>
      <button class="btn btn-primary" data-go="new">إنشاء طلب جديد</button></div>`;
  }
  return `${header}
    <ul class="list" id="orders-list">
      ${items.map((o) => {
        const emp = searchEmployee(o.employee_code);
        const name = emp ? emp.name : (o.employee_name || o.employee_code);
        const isSent = o.sync_state === "created" || o.sync_state === "duplicate" || o.source === "server";
        const statePill = isSent
          ? `<span class="pill pill-synced">مُرسل${o.reference ? " · " + esc(o.reference) : ""}</span>`
          : `<span class="pill pill-local">محلي</span>`;
        const reviewPill = o.status && o.status !== "pending"
          ? `<span class="pill">${esc(STATUS_LABELS[o.status] || o.status)}</span>`
          : "";
        const deliveredPill = o.fulfillment_status === "delivered"
          ? `<span class="pill pill-synced">تم التسليم</span>`
          : "";
        const total = Object.values(o.items || {}).reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_price || 0), 0);
        return `<li class="list-item" data-uuid="${esc(o.client_uuid)}">
          <div class="li-main">
            <div class="li-title">${esc(name)} ${statePill} ${reviewPill} ${deliveredPill}</div>
            <div class="li-sub">${esc(o.employee_code)} · ${esc(o.service_date)} · ${esc(o.person_name || "")}</div>
            <div class="li-sub">${money(total)} ${esc(settings().currency || "")}</div>
          </div>
          <button class="btn btn-sm btn-ghost" data-detail="${esc(o.client_uuid)}">تفاصيل</button>
        </li>`;
      }).join("")}
    </ul>`;
};

VIEWS.reports = () => {
  const local = getLocalOrders();
  const byEmployee = new Map();
  const byService = new Map();
  for (const order of local) {
    const emp = searchEmployee(order.employee_code);
    const serviceType = (emp && emp.service_type) || "غير محدد";
    const empKey = order.employee_code;
    const empRow = byEmployee.get(empKey) || { code: order.employee_code, name: emp ? emp.name : order.employee_code, service: serviceType, items: {}, total: 0 };
    const svcRow = byService.get(serviceType) || { label: serviceType, items: {}, total: 0 };
    for (const [itemId, line] of Object.entries(order.items || {})) {
      const qty = Number(line.quantity || 0);
      const item = serviceItems().find((i) => String(i.id) === String(itemId));
      const name = item ? item.name : `صنف ${itemId}`;
      empRow.items[name] = (empRow.items[name] || 0) + qty;
      svcRow.items[name] = (svcRow.items[name] || 0) + qty;
      empRow.total += qty;
      svcRow.total += qty;
    }
    byEmployee.set(empKey, empRow);
    byService.set(serviceType, svcRow);
  }
  const itemNames = [...new Set([...byEmployee.values(), ...byService.values()].flatMap((r) => Object.keys(r.items)))].sort();
  if (!byEmployee.size) {
    return `<div class="empty"><div class="big">▤</div><p>لا توجد بيانات كافية لعرض التقرير على هذا الجهاز.<br>أنشئ طلبات أوزامن البيانات من الخادم أولاً.</p></div>`;
  }
  const header = `<tr><th>الاسم</th><th>نوع الخدمة</th>${itemNames.map((n) => `<th>${esc(n)}</th>`).join("")}<th>الإجمالي</th></tr>`;
  const empRows = [...byEmployee.values()].map((r) => `<tr>
      <td>${esc(r.name)}<div class="small muted">${esc(r.code)}</div></td>
      <td><span class="pill pill-service">${esc(r.service)}</span></td>
      ${itemNames.map((n) => `<td class="num">${r.items[n] || "—"}</td>`).join("")}
      <td class="num"><strong>${r.total}</strong></td></tr>`).join("");
  const svcRows = [...byService.values()].map((r) => `<tr>
      <td><span class="pill pill-service">${esc(r.label)}</span></td>
      <td>—</td>
      ${itemNames.map((n) => `<td class="num">${r.items[n] || "—"}</td>`).join("")}
      <td class="num"><strong>${r.total}</strong></td></tr>`).join("");
  return `
    <div class="card">
      <h3 class="card-title">ملخص كميات الغسيل لكل موظف</h3>
      <div class="table-wrap"><table class="data"><thead>${header}</thead><tbody>${empRows}</tbody></table></div>
    </div>
    <div class="card">
      <h3 class="card-title">ملخص الكميات حسب نوع الخدمة</h3>
      <div class="table-wrap"><table class="data"><thead><tr><th>نوع الخدمة</th><th>—</th>${itemNames.map((n) => `<th>${esc(n)}</th>`).join("")}<th>الإجمالي</th></tr></thead><tbody>${svcRows}</tbody></table></div>
    </div>
    <p class="small muted center">التقرير مبني على الطلبات المحفوظة على هذا الجهاز. زامن الطلبات لرؤية الأرقام الكاملة.</p>`;
};

VIEWS.settings = () => {
  const cfg = getConfig();
  const user = state.session || {};
  const snap = snapshotMeta();
  return `
    <div class="card">
      <h3 class="card-title">حساب المستخدم</h3>
      <p class="small">${esc(user.full_name || user.username || "-")} — ${esc(ROLE_LABELS[user.role] || user.role || "-")}</p>
    </div>
    <div class="card">
      <h3 class="card-title">عنوان الخادم</h3>
      <label class="field">
        <span>رابط الخادم</span>
        <input type="url" id="cfg-server" value="${esc(cfg.server_url || "")}" placeholder="https://laundry-app.onrender.com" dir="ltr">
      </label>
      <p class="small muted">اتركه فارغاً لاستخدام العنوان الحالي. عند النشر على Render ضع رابط التطبيق هنا.</p>
      <button class="btn btn-accent btn-block" id="cfg-save">حفظ الإعدادات</button>
    </div>
    <div class="card">
      <h3 class="card-title">الرمز المحلي</h3>
      <p class="small muted">اضبط رمزاًnumeric سريعاً لفتح التطبيق دون اتصال (يُحفظ مشفّراً على الجهاز فقط).</p>
      <label class="field">
        <span>الرمز المحلي (4 أرقام على الأقل)</span>
        <input type="password" id="cfg-pin" inputmode="numeric" placeholder="••••">
      </label>
      <button class="btn btn-ghost btn-block" id="cfg-pin-save">حفظ الرمز المحلي</button>
    </div>
    <div class="card">
      <h3 class="card-title">المزامنة</h3>
      <p class="small muted">${snap ? "آخر تحديث: " + esc(snap.built_at || "-") : "لم تُحمَّل نسخة محلية بعد."}</p>
      <p class="small muted">طلبات في انتظار الإرسال: <strong>${pendingCount()}</strong></p>
      <button class="btn btn-primary btn-block" id="cfg-sync">مزامنة الآن</button>
    </div>
    <div class="card">
      <button class="btn btn-danger btn-block" id="cfg-logout">تسجيل الخروج</button>
    </div>`;
};

VIEWS.new = () => {
  const emp = draft.employee;
  const items = serviceItems();
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
      ${items.map((item) => {
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
      }).join("")}
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
    total += qty * Number(item?.rate || 0);
  }
  return total;
}

/* ---------- الربط ---------- */

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
        list.innerHTML = `<li class="result-item"><span class="name muted">لا يوجد موظف مطابق</span></li>`;
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
  if (personInput) {
    personInput.addEventListener("input", () => { draft.person_name = personInput.value; });
  }
  const notesInput = $("#order-notes");
  if (notesInput) {
    notesInput.addEventListener("input", () => { draft.notes = notesInput.value; });
  }

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

function bindOrdersPage() {
  $$("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => showOrderDetail(btn.dataset.detail));
  });
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
  const pinBtn = $("#cfg-pin-save");
  if (pinBtn) {
    pinBtn.addEventListener("click", async () => {
      const pin = $("#cfg-pin").value.trim();
      if (pin.length < 4) {
        toast("الرمز المحلي يجب أن يكون 4 أرقام على الأقل.", "err");
        return;
      }
      await setLocalPin(pin, state.session.username);
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
      showLogin();
    });
  }
}

/* ---------- إنشاء الطلب ---------- */

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
    employee_code: draft.employee.employee_code,
    person_name: draft.person_name.trim(),
    service_date: draft.service_date,
    notes: draft.notes.trim(),
    items,
    created_at: nowIso(),
    sync_state: "pending",
  };
  saveLocalOrder(order);
  enqueueOrder(order);
  toast("تم حفظ الطلب على الجهاز.", "ok");

  if (isOnline()) {
    const res = await syncOrders();
    if (res.pushed) toast(`تم إرسال ${res.pushed} طلب إلى الخادم.`, "ok");
  }
  draft = { employee: null, items: {}, person_name: "", notes: "", service_date: todayIso() };
  setPage("orders");
}

function currentRole() {
  return (state.session && state.session.role) || (getIdentity() || {}).role || "";
}

/* أزرار الإجراءات المتاحة للطلب بحسب الدور والحالة. */
function orderActionButtons(order) {
  const role = currentRole();
  if (!order.server_id || order.status !== "pending") return "";
  const delivered = order.fulfillment_status === "delivered";
  const buttons = [];
  if ((role === "admin" || role === "contractor") && !delivered) {
    buttons.push('<button class="btn btn-primary btn-sm" data-act="deliver">تسجيل التسليم</button>');
  }
  if (role === "admin" || role === "supervisor") {
    if (delivered) {
      buttons.push('<button class="btn btn-primary btn-sm" data-act="approve">اعتماد الطلب</button>');
    }
    buttons.push('<button class="btn btn-ghost btn-sm" data-act="reject">رفض</button>');
  }
  if (!buttons.length) return "";
  return `<div class="modal-actions" id="order-actions">${buttons.join("")}</div>`;
}

function showOrderDetail(clientUuid) {
  const order = getOrderByUuid(clientUuid);
  if (!order) return;
  const emp = searchEmployee(order.employee_code);
  const rows = Object.entries(order.items || {}).map(([itemId, line]) => {
    const item = serviceItems().find((i) => String(i.id) === String(itemId));
    return `<tr><td>${esc(line.item_name || item?.name || itemId)}</td>
      <td class="num">${esc(line.quantity)}</td>
      <td class="num">${money(Number(line.unit_price || 0))}</td>
      <td class="num">${money(Number(line.quantity || 0) * Number(line.unit_price || 0))}</td></tr>`;
  }).join("");
  const isSent = order.sync_state === "created" || order.sync_state === "duplicate" || order.source === "server";
  const statusPill = isSent
    ? `<span class="pill pill-synced">مُرسل${order.reference ? " · " + esc(order.reference) : ""}</span>`
    : `<span class="pill pill-local">محلي · بانتظار الإرسال</span>`;
  const reviewPill = order.status && order.status !== "pending"
    ? `<span class="pill">${esc(STATUS_LABELS[order.status] || order.status)}</span>`
    : "";
  const fulfillmentPill = order.fulfillment_status === "delivered"
    ? `<span class="pill pill-synced">تم التسليم</span>`
    : "";
  const warnings = (order.warnings || []).map((w) => `<li>${esc(w)}</li>`).join("");
  openModal(`
    <h3>تفاصيل الطلب ${statusPill} ${reviewPill} ${fulfillmentPill}</h3>
    <p class="small">${esc(emp ? emp.name : (order.employee_name || order.employee_code))} — ${esc(order.employee_code)}</p>
    <p class="small muted">${esc(order.service_date)} ${order.person_name ? "· " + esc(order.person_name) : ""}</p>
    ${order.notes ? `<p class="small">${esc(order.notes)}</p>` : ""}
    <div class="table-wrap"><table class="data">
      <thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${warnings ? `<div class="warn-box"><strong>تنبيهات:</strong><ul>${warnings}</ul></div>` : ""}
    ${orderActionButtons(order)}
    <div class="modal-actions">
      <button class="btn btn-ghost" data-modal-close>إغلاق</button>
    </div>`);
  const closeBtn = $("#modal-box [data-modal-close]");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  const actions = $("#modal-box #order-actions");
  if (actions) {
    actions.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      runOrderAction(btn.dataset.act, order, btn);
    });
  }
}

/* تنفيذ إجراء (تسليم/اعتماد/رفض) — يُنفَّذ فوراً عند الاتصال، ويُحفظ في الطابور عند الانقطاع. */
async function runOrderAction(action, order, btn) {
  if (btn) btn.disabled = true;
  const payload = action === "reject" ? { decision: "rejected", rejection_reason: "رُفض من تطبيق الجوال." } : { decision: "approved" };
  const type = action === "deliver" ? "deliver" : "confirm";
  const queued = queueAction(type, order, action === "deliver" ? {} : payload);
  if (!queued) {
    toast("لا يمكن تنفيذ الإجراء قبل إرجاع الطلب إلى الخادم.", "warn");
    if (btn) btn.disabled = false;
    return;
  }
  const res = await syncActions();
  if (res.applied) {
    toast(
      action === "deliver" ? "تم تسجيل التسليم." : action === "approve" ? "تم اعتماد الطلب." : "تم رفض الطلب.",
      "ok"
    );
    closeModal();
    render();
    return;
  }
  if (res.failed) {
    toast("تعذّر تنفيذ الإجراء. سيُرسل تلقائياً عند عودة الاتصال.", "warn");
    closeModal();
    render();
    return;
  }
  toast("لا يوجد اتصال. حُفظ الإجراء وسيُرسل لاحقاً.", "warn");
  if (btn) btn.disabled = false;
}

export function setDraftEmployee(emp) {
  draft.employee = emp;
  draft.person_name = "";
}

export { render, setPage, toast, closeModal, esc, money, openModal, currentRole };
