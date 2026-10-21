/* اختبار منطق تطبيق الجوال دون متصفح: يحاكي localStorage/fetch ويتحقق من
   الدخول، تحميل النسخة، إنشاء طلب، ومزامنة الطابور. */

import fs from "node:fs";

const BASE = "http://127.0.0.1:5505";

/* ---------- محاكاة بيئة المتصفح ---------- */
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
globalThis.window = { location: { origin: BASE, protocol: "http:", hostname: "127.0.0.1", port: "5505" } };
// Node 24 provides native webcrypto (randomUUID + subtle) — لا حاجة لاستبداله.
globalThis.document = {
  addEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, remove() {}, appendChild() {} }),
  body: { appendChild() {} },
};

const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url, method: opts.method || "GET" });
  return realFetch(url, opts);
};

let pass = 0, fail = 0;
function check(name, condition, extra = "") {
  if (condition) { pass++; console.log(`  [OK] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name} ${extra}`); }
}

/* ---------- الاختبارات ---------- */
const storeMod = await import("../www/js/store.js");
const { shiftWarnings, employeeCycle } = await import("../www/js/shift.js");

console.log("\n== 0) سلامة وحدات ES ==");
// فحص ثابت: كل اسم مستورد يجب أن يكون مُصدَّراً فعلياً في الوحدة المصدر.
const jsDir = new URL("../www/js/", import.meta.url);
const files = ["store.js", "shift.js", "app.js", "bootstrap.js"];
for (const file of files) {
  const src = fs.readFileSync(new URL(file, jsDir), "utf8");
  const importRe = /import\s*\{([^}]+)\}\s*from\s*"\.\/([\w.]+)"/g;
  let m;
  while ((m = importRe.exec(src))) {
    const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const targetPath = new URL(m[2], jsDir);
    const target = fs.readFileSync(targetPath, "utf8");
    for (const name of names) {
      const exported =
        new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(target) ||
        new RegExp(`export\\s+(const|let|var|class)\\s+${name}\\b`).test(target) ||
        new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`).test(target);
      check(`${file} يستورد ${name} من ${m[2]}`, exported, "غير مُصدَّر");
    }
  }
}
// فحص فعلي: تحميل وحدة app.js كاملة (رصد أخطاء التصدير أثناء الربط).
try {
  const appMod = await import("../www/js/app.js");
  check("وحدة app.js تُحمَّل دون أخطاء", typeof appMod.render === "function" && typeof appMod.esc === "function");
} catch (err) {
  check("وحدة app.js تُحمَّل دون أخطاء", false, String(err.message));
}

console.log("\n== 1) الدخول عبر الخادم ==");
const login = await storeMod.tryOnlineLogin("admin", "Admin@12345");
check("تسجيل الدخول نجح", login.ok === true, JSON.stringify(login));
check("تم تخزين الجلسة", storeMod.hasSession() === true);
check("تم تخزين الرموز", !!storeMod.state.tokens?.access_token);

console.log("\n== 2) كلمة مرور خاطئة ==");
const bad = await storeMod.tryOnlineLogin("admin", "wrong-password");
check("رُفضت كلمة المرور الخاطئة", bad.ok === false && bad.code === "unauthorized", JSON.stringify(bad));

console.log("\n== 3) تحميل النسخة المحلية (snapshot) ==");
const snap = await storeMod.syncSnapshotFromServer();
check("نجح تحميل النسخة", snap.ok === true, JSON.stringify(snap.error));
check("عدد الموظفين > 700", (snap.counts?.employees || 0) > 700, String(snap.counts?.employees));
check("عدد الأصناف = 7", snap.counts?.service_items === 7, String(snap.counts?.service_items));
check("البحث عن موظف بالاسم", storeMod.findEmployeesByName("20848").length > 0);

console.log("\n== 4) إنشاء طلب محلي ثم مزامنته ==");
const emp = storeMod.searchEmployee("20848");
check("وُجد الموظف 20848", !!emp, JSON.stringify(emp));
const items = storeMod.serviceItems();
const blanket = items.find((i) => i.code === "BLANKET");
const pillow = items.find((i) => i.code === "PILLOW_CASE");
check("وُجد صنف البطانية", !!blanket);
check("وُجد صنف المخدات", !!pillow);

const clientUuid = "test-" + Date.now();
const order = {
  client_uuid: clientUuid,
  employee_code: emp.employee_code,
  person_name: "",
  service_date: "2026-10-15",
  notes: "اختبار التطبيق",
  items: {
    [blanket.id]: { quantity: 3, unit_price: Number(blanket.rate), item_name: blanket.name },
    [pillow.id]: { quantity: 5, unit_price: Number(pillow.rate), item_name: pillow.name },
  },
  created_at: new Date().toISOString(),
  sync_state: "pending",
};
storeMod.saveLocalOrder(order);
const queued = storeMod.enqueueOrder(order);
check("أُضيف الطلب للطابور", queued === 1 && storeMod.pendingCount() === 1, String(queued));

const sync1 = await storeMod.syncOrders();
check("أُرسل الطلب للخادم", sync1.pushed === 1 && sync1.failed === 0, JSON.stringify(sync1));
check("أُفرغ الطابور", storeMod.pendingCount() === 0);
const synced = storeMod.getOrderByUuid(clientUuid);
check("الطلب يحمل مرجع الخادم", !!synced?.reference, JSON.stringify(synced?.reference));

console.log("\n== 5) تكرار المزامنة لا ي��شئ طلباً مكرراً ==");
storeMod.enqueueOrder(order);
const sync2 = await storeMod.syncOrders();
check("تم اكتشاف التكرار", sync2.pushed === 1, JSON.stringify(sync2));
const dupeCheck = await storeMod.apiRequest(`/api/orders?q=${encodeURIComponent(synced.reference)}`);
const refs = (dupeCheck.data?.orders || []).map((o) => o.reference).filter((r) => r === synced.reference);
check("طلب واحد فقط في الخادم بنفس المرجع", refs.length === 1, `refs=${refs.length}`);

console.log("\n== 6) منطق الدوام يطابق الخادم ==");
const cycle = employeeCycle(emp, "2026-10-15");
check("يوم الدورة محسوب", cycle.known === true && cycle.cycle_day > 0, JSON.stringify(cycle));
const warnings = shiftWarnings(emp, "2026-10-15");
check("التنبيهات مصفوفة", Array.isArray(warnings));

console.log("\n== 7) رمز الدخول المحلي ==");
await storeMod.setLocalPin("1234", "admin");
check("الرمز محفوظ", storeMod.hasLocalPin("admin") === true);
check("الرمز الصحيح يُقبل", (await storeMod.verifyLocalPin("1234", "admin")) === true);
check("الرمز الخاطئ يُرفض", (await storeMod.verifyLocalPin("9999", "admin")) === false);

console.log("\n== 8) الصلاحيات ==");
const supLogin = await storeMod.tryOnlineLogin("supervisor", "Housing@12345");
check("دخول المشرف", supLogin.ok === true, JSON.stringify(supLogin));
const supOrders = await storeMod.apiRequest("/api/orders?limit=1");
check("المشرف يقرأ الطلبات", supOrders.status === 200, String(supOrders.status));
const supUsers = await storeMod.apiRequest("/api/users");
check("المشرف لا يصل لإدارة المستخدمين (403/404)", supUsers.status === 403 || supUsers.status === 404, String(supUsers.status));

console.log("\n== 9) سجل الطلبات من الخادم ==");
await storeMod.tryOnlineLogin("admin", "Admin@12345");
const history = await storeMod.fetchServerOrders({ limit: 50 });
check("تحميل سجل الخادم", history.ok === true, JSON.stringify(history));
const merged = storeMod.getLocalOrders().find((o) => o.reference === synced.reference);
check("الطلب المُرسل موجود في السجل", !!merged, String(merged?.reference));
check("أصناف الخادم حُوّلت لكائن مفهرس", !!merged && Object.keys(merged.items || {}).length > 0, JSON.stringify(merged?.items));
check("حالة المراجعة وصلت", !!merged && ["pending", "approved", "rejected"].includes(merged.status), String(merged?.status));

console.log("\n== 10) طابور الإجراءات (تسليم/اعتماد) ==");
const target = storeMod.getLocalOrders().find((o) => o.status === "pending" && o.server_id);
check("يوجد طلب قابل للتنفيذ", !!target, String(target?.reference));
if (target) {
  storeMod.queueAction("deliver", target, {});
  check("الإجراء حُفظ في الطابور", storeMod.pendingActionCount() === 1, String(storeMod.pendingActionCount()));
  const act = await storeMod.syncActions();
  check("تم تنفيذ الإجراء على الخادم", act.applied === 1, JSON.stringify(act));
  check("الطابور أصبح فارغاً", storeMod.pendingActionCount() === 0, String(storeMod.pendingActionCount()));
  const after = storeMod.getLocalOrders().find((o) => o.server_id === target.server_id);
  check("حالة التسليم تحدّثت محلياً", after?.fulfillment_status === "delivered", String(after?.fulfillment_status));

  storeMod.queueAction("confirm", target, { decision: "approved" });
  const act2 = await storeMod.syncActions();
  check("تم الاعتماد على الخادم", act2.applied === 1, JSON.stringify(act2));
  const after2 = storeMod.getLocalOrders().find((o) => o.server_id === target.server_id);
  check("حالة المراجعة حدّثت محلياً", after2?.status === "approved", String(after2?.status));
}

console.log("\n== 11) قفل الرمز المحلي ==");
check("الجلسة مفتوحة بعد الدخول", storeMod.hasSession() === true);
// عند كل إقلاع للتطبيق ومع وجود رمز محلي يُقفل التطبيق حتى إدخال الرمز.
storeMod.setLocked(true);
check("الجلسة مقفلة عند الإقلاع مع رمز محلي", storeMod.isLocked() === true, String(storeMod.isLocked()));
check("لا جلسة مفتوحة أثناء القفل", storeMod.hasSession() === false);
storeMod.setLocked(false);
check("فتح القفل يعيد الجلسة", storeMod.hasSession() === true);
storeMod.clearSession();
check("تسجيل الخروج يمسح الرموز", storeMod.hasSession() === false);
check("تسجيل الخروج يحفظ الهوية للفتح دون اتصال", !!storeMod.getIdentity()?.username, JSON.stringify(storeMod.getIdentity()));
check("الجلسة مقفلة بعد الخروج", storeMod.isLocked() === true);
check("الرمز المحلي يبقى متاحاً بعد الخروج", storeMod.hasLocalPin("admin") === true);

console.log(`\n=== النتيجة: ${pass} ناجح / ${fail} فاشل ===`);
process.exit(fail ? 1 : 0);
