/* منطق الإقلاع: تسجيل الدخول، الجلسة المحلية، المزامنة التلقائية، وربط الأحداث العامة. */

import {
  state, loadSession, hasSession, clearSession, fullSignOut, lockApp, tryOnlineLogin,
  verifyLocalPin, hasLocalPin, unlockWithLocalPin, isOnline, setOnline, saveConfig,
  syncEverything, pendingCount, snapshotMeta, autoSync, searchEmployee,
  isLocked, setLocked, getIdentity, hasServerUrl, backendBaseUrl, testServerConnection,
  isOnlineSession,
} from "./store.js";

import { render, setPage, setDraftEmployee, toast, esc } from "./app.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function showLogin() {
  $("#screen-login").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
  const lastUser = localStorage.getItem("ln_last_user") || "";
  $("#login-username").value = lastUser;
  const pinUser = $("#pin-username");
  if (pinUser) pinUser.value = lastUser;
  const cfg = localStorage.getItem("ln_config");
  if (cfg) {
    try {
      const server = JSON.parse(cfg).server_url || "";
      if (server) $("#login-server").value = server;
    } catch { /* ignore */ }
  }
  if (lastUser && hasLocalPin(lastUser)) $("#pin-form").classList.remove("hidden");
  updateOfflineHint();
  updateServerStatus();
  $("#login-submit").disabled = false;
  $("#login-submit").textContent = "تسجيل الدخول";
}

/* تلميح وضع عدم الاتصال. */
function updateOfflineHint() {
  const hint = $("#login-offline-hint");
  if (!hint) return;
  const lastUser = localStorage.getItem("ln_last_user") || "";
  const parts = [];
  if (!hasServerUrl()) {
    parts.push("اضبط عنوان الخادم أولاً (مطلوب في تطبيق الهاتف).");
  } else if (!isOnline()) {
    parts.push("أنت غير متصل بالإنترنت.");
  }
  if (lastUser && hasLocalPin(lastUser)) {
    parts.push("لديك رمز دخول محلي على هذا الجهاز — استخدمه للدخول الآن دون اتصال.");
  } else {
    parts.push("للمتابعة دون اتصال لأوّل مرة: سجّل الدخول مرة واحدة وأنشئ رمزاً محلياً من الإعدادات.");
  }
  hint.textContent = parts.join(" ");
}

/* عرض حالة الاتصال بالخادم. */
function updateServerStatus(text = "", kind = "") {
  const el = $("#login-server-status");
  if (!el) return;
  el.textContent = text;
  el.className = `small ${kind}`;
}

async function checkServer(showSuccess = true) {
  const status = $("#login-server-status");
  if (status) status.textContent = "جارٍ الفحص...";
  const res = await testServerConnection();
  if (res.ok) {
    updateServerStatus(`متصل ✓ ${res.base}`, "muted");
    if (showSuccess) toast("الاتصال بالخادم يعمل بشكل صحيح.", "ok");
  } else {
    const messages = {
      no_server: "لم يتم ضبط عنوان الخادم.",
      timeout: "انتهت مهلة الاتصال بالخادم.",
      unreachable: "تعذر الوصول إلى الخادم. تحقق من العنوان والاتصال.",
    };
    updateServerStatus(messages[res.code] || res.error || "تعذر الاتصال.", "muted");
  }
  return res;
}

function showApp() {
  $("#screen-login").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
}

async function doLogin(event) {
  event.preventDefault();
  const username = $("#login-username").value.trim();
  const password = $("#login-password").value;
  const server = $("#login-server").value.trim();
  const errorBox = $("#login-error");

  if (server) saveConfig({ server_url: server });
  if (!username || !password) {
    errorBox.textContent = "أدخل اسم المستخدم وكلمة المرور.";
    errorBox.classList.remove("hidden");
    return;
  }
  if (!hasServerUrl()) {
    errorBox.textContent = "اضبط عنوان الخادم أولاً — بدونه لا يمكن تسجيل الدخول أو المزامنة.";
    errorBox.classList.remove("hidden");
    return;
  }

  const btn = $("#login-submit");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> جارٍ الدخول...';
  errorBox.classList.add("hidden");

  const result = await tryOnlineLogin(username, password);
  if (result.ok) {
    localStorage.setItem("ln_last_user", username);
    $("#login-password").value = "";
    showApp();
    await afterLogin();
    return;
  }

  btn.disabled = false;
  btn.textContent = "تسجيل الدخول";
  if (result.code === "unauthorized") {
    errorBox.textContent = "اسم المستخدم أو كلمة المرور غير صحيحة.";
  } else if (result.code === "no_server") {
    errorBox.textContent = "لم يتم ضبط عنوان الخادم. اكتب عنوان النظام ثم أعد المحاولة.";
  } else if (result.code === "timeout") {
    errorBox.textContent = "الخادم لا يستجيب. تحقّق من العنوان، أو استخدم الرمز المحلي إن وُجد.";
  } else {
    errorBox.textContent = "تعذر الوصول إلى الخادم. تحقّق من العنوان والاتصال، أو استخدم الرمز المحلي.";
  }
  errorBox.classList.remove("hidden");
  if (hasLocalPin(username)) $("#pin-form").classList.remove("hidden");
  updateOfflineHint();
}

async function doPinLogin(event) {
  if (event) event.preventDefault();
  const username = $("#login-username").value.trim() || (getIdentity() || {}).username || "";
  const pin = $("#login-pin").value;
  const errorBox = $("#login-error");
  if (!username) {
    errorBox.textContent = "اكتب اسم المستخدم أولاً.";
    errorBox.classList.remove("hidden");
    return;
  }
  if (!hasLocalPin(username)) {
    errorBox.textContent = "لا يوجد رمز محلي محفوظ لهذا المستخدم على هذا الجهاز.";
    errorBox.classList.remove("hidden");
    return;
  }
  const ok = await verifyLocalPin(pin, username);
  if (!ok) {
    errorBox.textContent = "الرمز المحلي غير صحيح.";
    errorBox.classList.remove("hidden");
    return;
  }
  const session = unlockWithLocalPin(username);
  if (session) {
    localStorage.setItem("ln_last_user", username);
    $("#login-pin").value = "";
    errorBox.classList.add("hidden");
    showApp();
    setPage("home");
    toast("تم الفتح بالرمز المحلي (دون اتصال). ستتم المزامنة تلقائياً عند عودة الاتصال.", "warn");
    // إن توفّرت الرموز فالمو gloves الجلسة صالحة للمزامنة — نبدأها فوراً.
    if (isOnlineSession() && isOnline()) syncEverything().then(() => render());
    return;
  }
  errorBox.textContent = "لا توجد بيانات محفوظة لهذا المستخدم على هذا الجهاز.";
  errorBox.classList.remove("hidden");
}

async function afterLogin() {
  const res = await syncEverything();
  if (res.snapshot?.ok) {
    toast("تم تحميل بيانات الموظفين والأصناف.", "ok");
  } else if (res.snapshot?.error) {
    toast(res.snapshot.error, "warn");
  }
  if (res.orders && res.orders.pushed) {
    toast(`تم إرسال ${res.orders.pushed} طلباً محفوظاً مسبقاً.`, "ok");
  }
  setPage("home");
}

function bindGlobal() {
  $("#login-form").addEventListener("submit", doLogin);
  $("#pin-form").addEventListener("submit", doPinLogin);

  const testBtn = $("#btn-test-server");
  if (testBtn) {
    testBtn.addEventListener("click", () => {
      const server = $("#login-server").value.trim();
      if (server) saveConfig({ server_url: server });
      checkServer(true);
    });
  }

  $("#login-server").addEventListener("change", () => {
    const server = $("#login-server").value.trim();
    if (server) saveConfig({ server_url: server });
    updateServerStatus();
  });

  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setPage(tab.dataset.page));
  });

  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) {
      setPage(go.dataset.go);
      return;
    }
    const code = e.target.closest("[data-code]");
    if (code) {
      const emp = searchEmployee(code.dataset.code);
      if (emp) {
        setDraftEmployee(emp);
        setPage("new");
      }
      return;
    }
    if (e.target.closest("#home-sync, #btn-sync")) {
      const btn = e.target.closest("#home-sync, #btn-sync");
      btn.disabled = true;
      syncEverything().then((res) => {
        btn.disabled = false;
        if (res.snapshot?.ok) toast("تم تحديث البيانات.", "ok");
        else toast(res.snapshot?.error || "تعذر التحديث.", "err");
        render();
      });
      return;
    }
    if (e.target.closest("#btn-logout")) {
      // قفل التطبيق — يبقى الرموز للمزامنة لاحقاً عند عودة الاتصال أو بالرمز المحلي.
      lockApp();
      clearSession();
      localStorage.removeItem("ln_queue");
      localStorage.removeItem("ln_orders");
      // لا نحذف الجلسة/الرموز هنا؛ lockApp يحافظ عليها.
      // إعادة تحميل لفرض شاشة الدخول مع خيار الرمز المحلي.
      location.reload();
    }
  });

  window.addEventListener("online", () => {
    setOnline(true);
    render();
    syncEverything().then(() => render());
  });
  window.addEventListener("offline", () => {
    setOnline(false);
    render();
  });

  setInterval(() => {
    if (isOnline() && hasSession()) {
      autoSync().then(() => render());
    }
  }, 45000);
}

loadSession();
bindGlobal();
updateOfflineHint();
updateServerStatus();

/* عند وجود رمز محلي محفوظ نطلب إدخاله عند كل فتح للتطبيق. */
const lastUserStart = localStorage.getItem("ln_last_user") || "";
const needsPin = !!(lastUserStart && hasLocalPin(lastUserStart));

if (needsPin) {
  // القفل عند الإقلاع — الدخول فقط بالرمز المحلي أو ببيانات محلية محفوظة.
  setLocked(true);
  showLogin();
  if (lastUserStart) {
    $("#login-username").value = lastUserStart;
    if ($("#pin-username")) $("#pin-username").value = lastUserStart;
  }
  $("#pin-form").classList.remove("hidden");
  $("#login-error").textContent = "أدخل الرمز المحلي لفتح التطبيق.";
  $("#login-error").classList.remove("hidden");
} else if (isOnlineSession() && !isLocked()) {
  showApp();
  setPage("home");
  if (isOnline()) syncEverything().then(() => render());
} else if (isOnlineSession()) {
  showLogin();
  if (lastUserStart) $("#login-username").value = lastUserStart;
  $("#login-error").textContent = "جلسة موجودة — سجّل الدخول مجدداً أو استخدم الرمز المحلي.";
  $("#login-error").classList.remove("hidden");
} else {
  showLogin();
  if (lastUserStart && hasLocalPin(lastUserStart)) $("#pin-form").classList.remove("hidden");
}
