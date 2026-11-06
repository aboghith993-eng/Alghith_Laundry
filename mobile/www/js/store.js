/* مخزن محلي لتطبيق المغسلة — يعمل دون اتصال ويحفظ نسخة البيانات والطلبات غير المُرسلة. */

const KEY_SNAPSHOT = "ln_snap";
const KEY_SESSION = "ln_session";
const KEY_TOKENS = "ln_tokens";
const KEY_QUEUE = "ln_queue";
const KEY_ORDERS = "ln_orders";
const KEY_CONFIG = "ln_config";
const KEY_PIN = "ln_pin";
const KEY_ACTIONS = "ln_actions";
const KEY_SERVICE_ACTIONS = "ln_service_actions";
const KEY_IDENTITY = "ln_identity";
const KEY_LOCK = "ln_locked";

/* عنوان الخادم المدمج في نسخة التطبيق */
export const BUILD_DEFAULT_SERVER = "https://alghith-laundry.onrender.com";

export const state = {
  snapshot: null,
  session: null,
  tokens: null,
  queue: [],
  orders: [],
  actions: [],
  serviceActions: [],
  config: { server_url: "" },
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncing: false,
  lastError: "",
};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* التخزين ممتلئ أو معطّل */
  }
}

export function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

/* ---------- الجلسة والرموز ---------- */

export function loadSession() {
  state.session = load(KEY_SESSION, null);
  state.tokens = load(KEY_TOKENS, null);
  state.config = { server_url: "", ...load(KEY_CONFIG, {}) };
  state.queue = load(KEY_QUEUE, []);
  state.orders = load(KEY_ORDERS, []);
  state.actions = load(KEY_ACTIONS, []);
  state.serviceActions = load(KEY_SERVICE_ACTIONS, []);
  state.snapshot = load(KEY_SNAPSHOT, null);
  return state.session;
}

export function storeSession(session, tokens) {
  state.session = session;
  state.tokens = tokens;
  save(KEY_SESSION, session);
  save(KEY_TOKENS, tokens);
  const username = String(
    session?.username || (getIdentity() || {}).username || ""
  ).toLowerCase();
  if (username) {
    // نسخة جلسة ورموز لكل مستخدم حتى يعمل الدخول بالرمز المحلي لأي حساب على نفس الجهاز.
    save(`${KEY_SESSION}:${username}`, session);
    save(`${KEY_TOKENS}:${username}`, tokens);
  }
  storeIdentity(session);
  setLocked(false);
}

/* ---------- هوية المستخدم والقفل المحلي ---------- */

export function storeIdentity(user) {
  if (!user) return null;
  const identity = {
    username: user.username || "",
    role: user.role || "",
    full_name: user.full_name || user.name || "",
  };
  save(KEY_IDENTITY, identity);
  return identity;
}

export function getIdentity() {
  return load(KEY_IDENTITY, null);
}

export function isLocked() {
  return !!load(KEY_LOCK, false);
}

export function setLocked(value) {
  if (value) save(KEY_LOCK, true);
  else localStorage.removeItem(KEY_LOCK);
}

/* قفل التطبيق: يوقف الجلسة في الذاكرة ويُبقي الرموز المحفوظة ليُستأنف المزامنة
   تلقائياً فور عودة الاتصال. لا يُخرج المستخدم من الحساب. */
export function lockApp() {
  state.session = null;
  state.tokens = null;
  setLocked(true);
}

/* خروج كامل: يمسح الجلسة والرموز والهوية والرمز المحلي. */
export function clearSession() {
  if (state.session) storeIdentity(state.session);
  state.session = null;
  state.tokens = null;
  localStorage.removeItem(KEY_SESSION);
  localStorage.removeItem(KEY_TOKENS);
  setLocked(true);
}

/* خروج كامل يزيل كل شيء بما فيه الهوية والرمز المحلي. */
export function fullSignOut() {
  const username = String(
    (state.session || getIdentity() || {}).username || ""
  ).toLowerCase();
  state.session = null;
  state.tokens = null;
  localStorage.removeItem(KEY_SESSION);
  localStorage.removeItem(KEY_TOKENS);
  localStorage.removeItem(KEY_IDENTITY);
  localStorage.removeItem(KEY_LOCK);
  if (username) {
    localStorage.removeItem(`${KEY_PIN}:${username}`);
    localStorage.removeItem(`${KEY_SESSION}:${username}`);
    localStorage.removeItem(`${KEY_TOKENS}:${username}`);
  }
}

/* فتح التطبيق بالرمز المحلي: يعيد الجلسة والرموز المحفوظة ليعمل دون اتصال
   وتتم المزامنة تلقائياً عند عودة الاتصال. */
export function unlockWithLocalPin(username) {
  const key = String(username || "").toLowerCase();
  let session = load(`${KEY_SESSION}:${key}`, null);
  let tokens = load(`${KEY_TOKENS}:${key}`, null);
  if (!session) {
    // نسخ قديمة: تُفحص الجلسة العامة ثم الهوية المحلية.
    const identity = getIdentity();
    session = load(KEY_SESSION, null) || identity;
  }
  if (!session) return null;
  state.session = { ...session, username: session.username || username };
  state.tokens = tokens || load(KEY_TOKENS, null);
  save(KEY_SESSION, state.session);
  if (state.tokens) save(KEY_TOKENS, state.tokens);
  setLocked(false);
  return state.session;
}

export function hasSession() {
  return !!state.session && !isLocked();
}

export function getConfig() {
  state.config = { server_url: "", ...load(KEY_CONFIG, {}) };
  return state.config;
}

export function saveConfig(patch) {
  state.config = { ...state.config, ...patch };
  save(KEY_CONFIG, state.config);
  return state.config;
}

/* ---------- PIN محلي (فتح سريع دون اتصال) ---------- */

async function sha256Hex(text, salt) {
  const bytes = new TextEncoder().encode(text + "::" + salt);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function setLocalPin(pin, username) {
  const salt = uuid().slice(0, 8);
  save(`${KEY_PIN}:${username}`, { salt, hash: await sha256Hex(pin, salt) });
}

export async function verifyLocalPin(pin, username) {
  const rec = load(`${KEY_PIN}:${username}`, null);
  if (!rec) return false;
  return (await sha256Hex(pin, rec.salt)) === rec.hash;
}

export function hasLocalPin(username) {
  return !!load(`${KEY_PIN}:${username}`, null);
}

/* ---------- عنوان الخادم ---------- */

export function isNativePlatform() {
  if (typeof window === "undefined") return false;
  const cap = window.Capacitor;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
    if (typeof cap.getPlatform === "function" && cap.getPlatform() !== "web") return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function normalizeBaseUrl(url) {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // عناوين الشبكة المحلية تعمل عبر http فقط، فنبقيها كما هي.
  if (/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function backendBaseUrl() {
  const cfg = getConfig();
  const raw = (cfg.server_url || "").trim();
  if (raw) return normalizeBaseUrl(raw);
  if (typeof window === "undefined") return "";
  // في تطبيق Capacitor origin هو https://localhost — لا يصلح كخادم خلفي.
  if (isNativePlatform()) return BUILD_DEFAULT_SERVER ? normalizeBaseUrl(BUILD_DEFAULT_SERVER) : "";
  return window.location.origin;
}

/* هل يوجد عنوان خادم يمكن الاتصال به؟ */
export function hasServerUrl() {
  const cfg = getConfig();
  if ((cfg.server_url || "").trim()) return true;
  return !!BUILD_DEFAULT_SERVER;
}

/* هل الجلسة تحمل رموزاً صالحة (أي يمكنها المزامنة)؟ */
export function isOnlineSession() {
  return !!(state.session && state.tokens && state.tokens.access_token);
}

/* ---------- الطلبات ---------- */

export function isOnline() {
  return state.online;
}

export function setOnline(value) {
  state.online = !!value;
}

async function rawRequest(path, { method = "GET", body, timeoutMs = 45000, auth = true } = {}) {
  const base = backendBaseUrl();
  if (!base) {
    return { status: 0, ok: false, data: null, code: "no_server", error: "لم يتم ضبط عنوان الخادم بعد." };
  }
  const headers = { "Content-Type": "application/json" };
  if (auth && state.tokens && state.tokens.access_token) {
    headers.Authorization = `Bearer ${state.tokens.access_token}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, ok: res.ok, data, code: res.ok ? "ok" : `http_${res.status}` };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      status: 0,
      ok: false,
      data: null,
      code: aborted ? "timeout" : "unreachable",
      error: aborted ? "انتهت مهلة الاتصال بالخادم." : "تعذر الوصول إلى الخادم.",
    };
  } finally {
    clearTimeout(timer);
  }
}

async function refreshTokens() {
  const refresh = state.tokens && state.tokens.refresh_token;
  if (!refresh) return false;
  const res = await rawRequest("/api/auth/refresh", {
    method: "POST",
    body: { refresh_token: refresh },
    auth: false,
  });
  if (res.ok && res.data && res.data.access_token) {
    state.tokens = {
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token || refresh,
    };
    save(KEY_TOKENS, state.tokens);
    if (res.data.user) {
      state.session = res.data.user;
      save(KEY_SESSION, state.session);
    }
    return true;
  }
  return false;
}

export async function apiRequest(path, options = {}) {
  let res = await rawRequest(path, options);
  if ((res.status === 401 || res.status === 403) && options.auth !== false) {
    if (await refreshTokens()) {
      res = await rawRequest(path, options);
    }
  }
  return res;
}

/* ---------- تسجيل الدخول ---------- */

export async function tryOnlineLogin(username, password) {
  const res = await rawRequest("/api/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  if (res.ok && res.data && res.data.user) {
    storeSession(res.data.user, {
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token,
    });
    return { ok: true, user: res.data.user };
  }
  if (res.status === 401) return { ok: false, code: "unauthorized" };
  return { ok: false, code: res.code || "unreachable", detail: res.error || `status=${res.status}` };
}

/* فحص الاتصال بالخادم — يُستخدم في شاشة الدخول والإعدادات. */
export async function testServerConnection() {
  const base = backendBaseUrl();
  if (!base) {
    return { ok: false, code: "no_server", error: "لم يتم ضبط عنوان الخادم بعد." };
  }
  const res = await rawRequest("/api/mobile/ping", { auth: false, timeoutMs: 12000 });
  if (res.ok) return { ok: true, base, latency: Date.now() };
  return { ok: false, code: res.code, base, error: res.error || `status=${res.status}` };
}

/* ---------- النسخة المحلية (snapshot) ---------- */

export function getSnapshot() {
  return state.snapshot;
}

export function storeSnapshot(data) {
  state.snapshot = data;
  save(KEY_SNAPSHOT, data);
  return data;
}

export function snapshotMeta() {
  const s = state.snapshot;
  return s ? { built_at: s.built_at, counts: s.counts } : null;
}

/* ---------- المستخدمون (مدير النظام) ---------- */

export function snapshotUsers() {
  const list = state.snapshot && Array.isArray(state.snapshot.users) ? state.snapshot.users : [];
  return list.slice();
}

function storeUsers(users) {
  if (!state.snapshot) return;
  state.snapshot.users = users;
  persistSnapshot();
}

export async function fetchUsers() {
  if (!isOnline()) {
    return { ok: false, code: "offline", error: "إدارة المستخدمين تتطلب اتصالاً بالإنترنت." };
  }
  const res = await apiRequest("/api/users");
  if (res.ok && res.data && Array.isArray(res.data.users)) {
    const users = res.data.users.map((u) => ({ ...u, active: !!u.active }));
    storeUsers(users);
    return { ok: true, users };
  }
  return { ok: false, error: res.data?.error || res.error || `تعذر تحميل المستخدمين (${res.status}).` };
}

async function userMutation(path, options) {
  if (!isOnline()) {
    return { ok: false, code: "offline", error: "إدارة المستخدمين تتطلب اتصالاً بالإنترنت." };
  }
  const res = await apiRequest(path, options);
  if (res.ok) {
    await fetchUsers();
    return { ok: true, message: (res.data && res.data.message) || "تم الحفظ." };
  }
  return { ok: false, error: res.data?.error || res.error || `تعذر تنفيذ العملية (${res.status}).` };
}

export function createUser(payload) {
  return userMutation("/api/users", { method: "POST", body: payload });
}

export function updateUser(id, payload) {
  return userMutation(`/api/users/${id}`, { method: "PUT", body: payload });
}

export function toggleUser(id) {
  return userMutation(`/api/users/${id}/toggle`, { method: "POST", body: {} });
}

export function deleteUser(id) {
  return userMutation(`/api/users/${id}`, { method: "DELETE" });
}

export function resetUserPassword(id, password) {
  return userMutation(`/api/users/${id}/reset`, { method: "POST", body: { password } });
}

export async function syncSnapshotFromServer() {
  const res = await apiRequest("/api/mobile/snapshot", { auth: true });
  if (!res.ok) {
    const alt = await apiRequest("/api/sync/snapshot", { auth: true });
    if (alt.ok && alt.data && Array.isArray(alt.data.employees)) {
      storeSnapshot(alt.data);
      return { ok: true, built_at: alt.data.built_at, counts: alt.data.counts };
    }
  }
  if (res.ok && res.data && Array.isArray(res.data.employees)) {
    storeSnapshot(res.data);
    return { ok: true, built_at: res.data.built_at, counts: res.data.counts };
  }
  if (res.status === 401) return { ok: false, error: "انتهت الجلسة. سجّل الدخول مجدداً." };
  return { ok: false, error: res.error || `تعذر تحميل البيانات (${res.status}).` };
}

export function searchEmployee(code) {
  const s = state.snapshot;
  if (!s) return null;
  const wanted = (code || "").trim();
  if (!wanted) return null;
  return s.employees.find((e) => e.employee_code === wanted) || null;
}

export function findEmployeesByName(text) {
  const s = state.snapshot;
  if (!s || !text) return [];
  const q = text.trim();
  return s.employees
    .filter((e) => e.name.includes(q) || e.employee_code.includes(q))
    .slice(0, 40);
}

export function serviceItems() {
  const base = (state.snapshot && Array.isArray(state.snapshot.service_items)
    ? state.snapshot.service_items
    : []).map((item) => ({ ...item }));
  let items = base;
  for (const action of state.serviceActions || []) {
    if (action.type === "service_create") {
      items = [
        ...items,
        {
          id: action.temp_id,
          code: action.payload.code,
          name: action.payload.name,
          unit: action.payload.unit || "قطعة",
          rate: Number(action.payload.rate || 0),
          active: true,
          _local: true,
        },
      ];
    } else if (action.type === "service_update") {
      items = items.map((item) => (String(item.id) === String(action.item_id)
        ? { ...item, ...action.payload, active: action.payload.active ?? item.active ?? true, _local: true }
        : item));
    } else if (action.type === "service_toggle") {
      items = items.map((item) => (String(item.id) === String(action.item_id)
        ? { ...item, active: !!action.payload.active, _local: true }
        : item));
    } else if (action.type === "service_delete") {
      items = items.filter((item) => String(item.id) !== String(action.item_id));
    }
  }
  return items;
}

/* الأصناف المفعّلة فقط — تُستخدم في شاشة إنشاء طلب جديد. */
export function activeServiceItems() {
  return serviceItems().filter((item) => item.active !== false);
}

export function settings() {
  const s = state.snapshot;
  return (s && s.settings) || {};
}

/* ---------- الطلبات المحلية ---------- */

export function getLocalOrders() {
  return state.orders;
}

export function saveLocalOrder(order) {
  const idx = state.orders.findIndex((o) => o.client_uuid === order.client_uuid);
  if (idx >= 0) state.orders[idx] = { ...state.orders[idx], ...order };
  else state.orders.unshift(order);
  save(KEY_ORDERS, state.orders);
  return order;
}

export function getOrderByUuid(clientUuid) {
  return state.orders.find((o) => o.client_uuid === clientUuid) || null;
}

/* حذف طلب من الجهاز (يُستخدم للطلبات المحلية أو بعد حذفها من الخادم). */
export function deleteLocalOrder(clientUuid) {
  state.orders = state.orders.filter((o) => o.client_uuid !== clientUuid);
  save(KEY_ORDERS, state.orders);
  state.actions = state.actions.filter((a) => a.client_uuid !== clientUuid);
  save(KEY_ACTIONS, state.actions);
  return state.orders.length;
}

/* ---------- طابور المزامنة ---------- */

export function getQueue() {
  return state.queue;
}

export function enqueueOrder(order) {
  const entry = {
    client_uuid: order.client_uuid,
    employee_id: order.employee_id || null,
    employee_code: order.employee_code,
    person_name: order.person_name || "",
    service_date: order.service_date,
    notes: order.notes || "",
    items: order.items,
    created_at: order.created_at,
    queued_at: new Date().toISOString(),
  };
  const idx = state.queue.findIndex((o) => o.client_uuid === order.client_uuid);
  if (idx >= 0) state.queue[idx] = entry;
  else state.queue.push(entry);
  save(KEY_QUEUE, state.queue);
  return state.queue.length;
}

export function dequeueOrder(clientUuid) {
  state.queue = state.queue.filter((o) => o.client_uuid !== clientUuid);
  save(KEY_QUEUE, state.queue);
}

export function pendingCount() {
  return state.queue.length;
}

export function updateOrderFromServer(clientUuid, result) {
  const local = getOrderByUuid(clientUuid);
  if (!local) return;
  local.server_id = result.order_id || null;
  local.reference = result.reference || null;
  local.sync_state = result.status;
  local.warnings = result.warnings || [];
  local.last_error = result.error || "";
  saveLocalOrder(local);
}

export async function syncOrders() {
  if (state.syncing) return { pushed: 0, failed: 0, skipped: true };
  if (!state.queue.length) return { pushed: 0, failed: 0 };
  if (!isOnline()) return { pushed: 0, failed: 0, error: "لا يوجد اتصال بالإنترنت." };
  state.syncing = true;
  const batch = state.queue.slice(0, 50).map((o) => ({
    client_uuid: o.client_uuid,
    employee_id: o.employee_id || null,
    employee_code: o.employee_code,
    person_name: o.person_name || "",
    service_date: o.service_date,
    notes: o.notes || "",
    created_at: o.created_at,
    // الخادم يتوقّع مصفوفة أصناف، بينما نخزّنها محلياً ككائن مفهرس.
    items: Object.entries(o.items || {}).map(([itemId, line]) => ({
      service_item_id: Number(itemId),
      quantity: Number(line.quantity || 0),
    })),
  }));
  const res = await apiRequest("/api/sync/orders", { method: "POST", body: { orders: batch } });
  let pushed = 0;
  let failed = 0;
  if (res.ok && res.data && Array.isArray(res.data.results)) {
    for (const result of res.data.results) {
      updateOrderFromServer(result.client_uuid, result);
      if (result.status === "created" || result.status === "duplicate") {
        dequeueOrder(result.client_uuid);
        pushed += 1;
        // الخادم يعيد رقم الطلب فقط — نجلب تفاصيل الأصناف لتصبح معرّفاتها جاهزة للتسليم الجزئي.
        if (result.order_id) {
          await refreshOrderFromServer(result.order_id, result.client_uuid);
        }
      } else {
        failed += 1;
      }
    }
  } else {
    state.lastError = res.error || `فشلت المزامنة (${res.status}).`;
    failed = batch.length;
  }
  state.syncing = false;
  return { pushed, failed, error: state.lastError };
}

export async function syncEverything() {
  const snap = await syncSnapshotFromServer();
  // الخدمات والإجراءات أولاً (لتحويل المعرّفات المؤقتة) ثم دفع الطلبات الجديدة.
  const actions = await syncActions();
  const orders = await syncOrders();
  const history = await fetchServerOrders();
  return { snapshot: snap, orders, actions, history };
}

/* ---------- سجل الطلبات من الخادم ---------- */

/* تحويل أصناف الخادم (مصفوفة) إلى الصيغة المحلية (كائن مفهرس بمعرّف الصنف). */
function normalizeServerItems(lines) {
  const out = {};
  for (const line of lines || []) {
    out[line.service_item_id] = {
      id: line.id,
      service_item_id: line.service_item_id,
      quantity: Number(line.quantity || 0),
      unit_price: Number(line.unit_price || 0),
      item_name: line.item_name || "",
      unit: line.unit || "",
      received_quantity: Number(line.received_quantity || 0),
    };
  }
  return out;
}

/* ---------- سجل دفعات الاستلام (قد يتعدى مستلم واحد على دفعات متعددة) ---------- */

function normalizeServerReceipt(rows) {
  if (!rows || typeof rows !== "object") return null;
  return {
    id: rows.id != null ? rows.id : "",
    receiver_kind: rows.receiver_kind || "",
    receiver_name: rows.receiver_name || "",
    received_at: rows.received_at || "",
    recorded_by_name: rows.recorded_by_name || "",
    items: (Array.isArray(rows.items) ? rows.items : []).map((line) => ({
      item_name: line.item_name || "",
      unit: line.unit || "",
      quantity: Number(line.quantity || 0),
    })),
    _local: false,
  };
}

function receiptSignature(receipt) {
  return `${receipt.receiver_kind || ""}|${receipt.receiver_name || ""}|`
    + (Array.isArray(receipt.items) ? receipt.items : [])
      .map((line) => `${line.item_name}×${Number(line.quantity || 0)}`)
      .sort()
      .join(",");
}

/* دمج سجل الخادم مع الدفعات المحلية التي لم تُرسل بعد (دون تكرار). */
function mergeServerReceipts(localReceipts, serverReceipts) {
  const server = (Array.isArray(serverReceipts) ? serverReceipts : [])
    .map(normalizeServerReceipt)
    .filter(Boolean);
  if (!server.length) return localReceipts || [];
  const signatures = new Set(server.map(receiptSignature));
  const pending = (localReceipts || []).filter((receipt) => (
    (receipt._local || receipt.id == null || receipt.id === "")
    && !signatures.has(receiptSignature(receipt))
  ));
  return [...server, ...pending];
}

function normalizeServerOrder(row) {
  return {
    client_uuid: row.client_uuid || `srv-${row.id}`,
    server_id: row.id,
    reference: row.reference || "",
    employee_id: row.employee_id || null,
    employee_code: row.employee_code || "",
    employee_name: row.employee_name || "",
    person_name: row.person_name || "",
    service_date: row.service_date || "",
    notes: row.notes || "",
    items: normalizeServerItems(row.items),
    subtotal: Number(row.subtotal || 0),
    status: row.status || "pending",
    fulfillment_status: row.fulfillment_status || "pending",
    delivered_at: row.delivered_at || "",
    confirmed_at: row.confirmed_at || "",
    rejection_reason: row.rejection_reason || "",
    receiver_kind: row.receiver_kind || "",
    receiver_name: row.receiver_name || "",
    receipts: Array.isArray(row.receipts) ? row.receipts.map(normalizeServerReceipt).filter(Boolean) : [],
    creator_name: row.creator_name || "",
    confirmer_name: row.confirmer_name || "",
    deliverer_name: row.deliverer_name || "",
    created_at: row.created_at || "",
    sync_state: "synced",
    source: "server",
  };
}

function mergeServerOrders(list) {
  for (const incoming of list) {
    const idx = state.orders.findIndex((o) => o.client_uuid === incoming.client_uuid);
    if (idx >= 0) {
      // الطلب المحلي موجود: نحدّث حالة الخادم مع الحفاظ على تفاصيل الأصناف المحلية
      // وندمج الكميات المستلمة القادمة من الخادم (للتسليم الجزئي).
      const local = state.orders[idx];
      const mergedItems = { ...(local.items || {}) };
      for (const [itemId, line] of Object.entries(incoming.items || {})) {
        const existing = mergedItems[itemId];
        mergedItems[itemId] = existing
          ? {
            ...existing,
            id: line.id ?? existing.id,
            received_quantity: line.received_quantity ?? existing.received_quantity ?? 0,
            item_name: existing.item_name || line.item_name || "",
            unit: existing.unit || line.unit || "",
          }
          : line;
      }
      state.orders[idx] = {
        ...local,
        ...incoming,
        items: mergedItems,
        receipts: mergeServerReceipts(local.receipts || [], incoming.receipts),
        sync_state: local.sync_state === "pending" ? "pending" : "synced",
      };
    } else {
      state.orders.unshift(incoming);
    }
  }
  save(KEY_ORDERS, state.orders);
  return state.orders.length;
}

export async function fetchServerOrders(params = {}) {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.status) query.set("status", params.status);
  if (params.q) query.set("q", params.q);
  query.set("limit", String(params.limit || 200));
  const res = await apiRequest(`/api/orders?${query.toString()}`);
  if (res.ok && res.data && Array.isArray(res.data.orders)) {
    const list = res.data.orders.map(normalizeServerOrder);
    const total = mergeServerOrders(list);
    return { ok: true, count: list.length, total };
  }
  if (res.status === 401) return { ok: false, error: "انتهت الجلسة. سجّل الدخول مجدداً." };
  return { ok: false, error: res.error || `تعذر تحميل الطلبات (${res.status}).` };
}

/* ---------- طابور الإجراءات (تسليم/اعتماد/تعديل/حذف/خدمات) دون اتصال ---------- */

export function pendingActions() {
  return state.actions;
}

export function pendingServiceActions() {
  return state.serviceActions;
}

export function pendingActionCount() {
  return state.actions.length + (state.serviceActions || []).length;
}

export function pendingServiceCount() {
  return (state.serviceActions || []).length;
}

function nextTempServiceId() {
  let candidate = -1;
  const used = new Set(serviceItems().map((item) => String(item.id)));
  for (const action of state.serviceActions || []) {
    if (action.temp_id != null) used.add(String(action.temp_id));
  }
  while (used.has(String(candidate))) candidate -= 1;
  return candidate;
}

/* إضافة/تعديل/تعطيل/حذف خدمة وسعر — تُطبَّق محلياً فوراً وتُزامن لاحقاً. */
export function queueServiceAction(type, payload = {}, itemId = null) {
  const action = {
    action_id: uuid(),
    type,
    item_id: itemId == null ? null : itemId,
    payload: { ...payload },
    created_at: new Date().toISOString(),
  };
  if (type === "service_create") {
    action.temp_id = nextTempServiceId();
    action.item_id = action.temp_id;
  }
  state.serviceActions.push(action);
  save(KEY_SERVICE_ACTIONS, state.serviceActions);
  return action;
}

function snapshotOrderForAction(order) {
  return {
    status: order.status,
    fulfillment_status: order.fulfillment_status,
    delivered_at: order.delivered_at,
    confirmed_at: order.confirmed_at,
    rejection_reason: order.rejection_reason,
    receiver_kind: order.receiver_kind,
    receiver_name: order.receiver_name,
    subtotal: order.subtotal,
    notes: order.notes,
    person_name: order.person_name,
    service_date: order.service_date,
    employee_id: order.employee_id,
    employee_code: order.employee_code,
    employee_name: order.employee_name,
    items: JSON.parse(JSON.stringify(order.items || {})),
    receipts: JSON.parse(JSON.stringify(order.receipts || [])),
  };
}

export function queueAction(type, order, payload = {}, localPatch = {}) {
  if (!order) return null;
  // التسليم للمستلم مسموح وهو طلب محلي لم يُرسل بعد (متعهد المغسلة ينشئ الطلب ويستلمه دون اتصال)؛
  // إلا التسليم فبقية إجراءات الطلب تتطلب أن يكون مرسلاً إلى الخادم.
  const requiresServer = type !== "deliver";
  if (requiresServer && !order.server_id) return null;
  const action = {
    action_id: uuid(),
    type,
    order_id: order.server_id || null,
    client_uuid: order.client_uuid || "",
    payload,
    localPatch,
    before: snapshotOrderForAction(order),
    created_at: new Date().toISOString(),
  };
  state.actions.push(action);
  save(KEY_ACTIONS, state.actions);
  if (type === "delete") {
    // حذف متفائل: يختفي الطلب من الواجهة فوراً، ويبقى الإجراء في الطابور للإرسال.
    state.orders = state.orders.filter((o) => o.client_uuid !== order.client_uuid);
    save(KEY_ORDERS, state.orders);
  } else {
    applyActionLocally(action);
  }
  return action;
}

function findOrderForAction(action) {
  return state.orders.find(
    (o) => (action.client_uuid && o.client_uuid === action.client_uuid) || o.server_id === action.order_id
  );
}

function applyActionLocally(action) {
  const order = findOrderForAction(action);
  if (!order) return;
  if (action.type === "deliver") {
    const pieces = Array.isArray(action.payload.pieces) ? action.payload.pieces : [];
    const items = { ...(order.items || {}) };
    const receiptLines = [];
    let matched = 0;
    if (pieces.length) {
      for (const piece of pieces) {
        const entry = Object.entries(items).find(([key, line]) => (
          (line.id != null && piece.id != null && String(line.id) === String(piece.id))
          || (piece.service_item_id != null && String(key) === String(piece.service_item_id))
          || (piece.id != null && String(key) === String(piece.id))
        ));
        if (!entry) continue;
        const [key, line] = entry;
        matched += 1;
        const qty = Math.min(
          Number(line.quantity || 0) - Number(line.received_quantity || 0),
          Number(piece.quantity || 0)
        );
        if (qty <= 0) continue;
        items[key] = {
          ...line,
          received_quantity: Math.min(
            Number(line.quantity || 0),
            Number(line.received_quantity || 0) + Number(piece.quantity || 0)
          ),
        };
        // تدوين كل دفعة استلام باسم مستلمها — قد يكون هناك أكثر من مستلم لنفس الطلب.
        receiptLines.push({
          item_name: line.item_name || line.name || "",
          unit: line.unit || "",
          quantity: qty,
        });
      }
      // لا نُطبّق مستلماً أو حالة تسليم إن لم تتطابق أي قطعة — حتى لا تظهر بيانات وهمية.
      if (!matched) return;
    } else {
      for (const [key, line] of Object.entries(items)) {
        const remainingNow = Math.max(Number(line.quantity || 0) - Number(line.received_quantity || 0), 0);
        if (remainingNow > 0.0001) {
          receiptLines.push({
            item_name: line.item_name || line.name || "",
            unit: line.unit || "",
            quantity: remainingNow,
          });
        }
        items[key] = { ...line, received_quantity: Number(line.quantity || 0) };
      }
      if (!matched && !receiptLines.length) return;
    }
    order.items = items;
    order.fulfillment_status = "delivered";
    order.delivered_at = order.delivered_at || new Date().toISOString();
    order.receiver_kind = action.payload.receiver_kind || "same_employee";
    order.receiver_name = action.payload.receiver_name || order.receiver_name || "";
    order.receipts = [
      ...(order.receipts || []),
      {
        id: `local-${uuid()}`,
        receiver_kind: order.receiver_kind,
        receiver_name: order.receiver_name,
        received_at: new Date().toISOString(),
        recorded_by_name: "",
        items: receiptLines,
        _local: true,
      },
    ];
  } else if (action.type === "confirm") {
    order.status = action.payload.decision || "approved";
    order.confirmed_at = new Date().toISOString();
    if (action.payload.rejection_reason) order.rejection_reason = action.payload.rejection_reason;
    else if (action.payload.decision === "approved") order.rejection_reason = "";
  } else if (action.type === "update") {
    Object.assign(order, action.localPatch || {});
  }
  saveLocalOrder(order);
}

function revertActionLocally(action) {
  if (!action.before) return;
  const order = findOrderForAction(action);
  if (!order) return;
  const snapshot = action.before;
  order.status = snapshot.status;
  order.fulfillment_status = snapshot.fulfillment_status;
  order.delivered_at = snapshot.delivered_at;
  order.confirmed_at = snapshot.confirmed_at;
  order.rejection_reason = snapshot.rejection_reason;
  order.receiver_kind = snapshot.receiver_kind;
  order.receiver_name = snapshot.receiver_name;
  order.subtotal = snapshot.subtotal;
  order.notes = snapshot.notes;
  order.person_name = snapshot.person_name;
  order.service_date = snapshot.service_date;
  order.employee_id = snapshot.employee_id;
  order.employee_code = snapshot.employee_code;
  order.employee_name = snapshot.employee_name;
  order.items = JSON.parse(JSON.stringify(snapshot.items || {}));
  order.receipts = JSON.parse(JSON.stringify(snapshot.receipts || []));
  saveLocalOrder(order);
}

/* جلب أحدث نسخة للطلب من الخادم ودمجها محلياً (لتصحيح المعرّفات والكميات المستلمة). */
export async function refreshOrderFromServer(orderId, clientUuid = "") {
  if (!orderId) return null;
  const res = await apiRequest(`/api/orders/${orderId}`);
  if (!res.ok || !res.data?.order) return null;
  const incoming = normalizeServerOrder(res.data.order);
  const idx = state.orders.findIndex((o) => (
    (clientUuid && o.client_uuid === clientUuid)
    || o.server_id === orderId
    || o.client_uuid === incoming.client_uuid
  ));
  if (idx >= 0) {
    const local = state.orders[idx];
    state.orders[idx] = {
      ...local,
      ...incoming,
      client_uuid: local.client_uuid,
      receipts: mergeServerReceipts(local.receipts || [], incoming.receipts),
      sync_state: local.sync_state === "pending" ? "pending" : "synced",
    };
    save(KEY_ORDERS, state.orders);
    return state.orders[idx];
  }
  state.orders.unshift(incoming);
  save(KEY_ORDERS, state.orders);
  return incoming;
}

/* تحديث الطلب المحلي من استجابة الخادم (بعد التعديل). */
function replaceLocalOrderFromServer(clientUuid, row) {
  if (!row) return;
  const incoming = normalizeServerOrder(row);
  const idx = state.orders.findIndex((o) => o.client_uuid === clientUuid);
  if (idx >= 0) {
    const local = state.orders[idx];
    state.orders[idx] = {
      ...local,
      ...incoming,
      client_uuid: local.client_uuid,
      receipts: mergeServerReceipts(local.receipts || [], incoming.receipts),
      sync_state: "synced",
    };
    save(KEY_ORDERS, state.orders);
  }
}

function updateLocalItemsFromServer(order, serverItems) {
  if (!order || !Array.isArray(serverItems)) return;
  const items = { ...(order.items || {}) };
  for (const line of serverItems) {
    const entry = Object.entries(items).find(([key, local]) => (
      (line.id != null && local.id != null && String(local.id) === String(line.id))
      || (line.service_item_id != null && String(key) === String(line.service_item_id))
    ));
    if (entry) {
      const [key, local] = entry;
      items[key] = {
        ...local,
        id: line.id ?? local.id,
        received_quantity: Number(line.received_quantity || 0),
      };
    }
  }
  order.items = items;
  saveLocalOrder(order);
}

function persistSnapshot() {
  if (state.snapshot) save(KEY_SNAPSHOT, state.snapshot);
}

function upsertSnapshotService(serverItem) {
  if (!serverItem || !state.snapshot) return;
  const list = Array.isArray(state.snapshot.service_items) ? state.snapshot.service_items : [];
  const idx = list.findIndex((item) => String(item.id) === String(serverItem.id));
  if (idx >= 0) list[idx] = serverItem;
  else list.push(serverItem);
  state.snapshot.service_items = list;
  persistSnapshot();
}

function setSnapshotServiceActive(itemId, active) {
  if (!state.snapshot || !Array.isArray(state.snapshot.service_items)) return;
  state.snapshot.service_items = state.snapshot.service_items.map((item) => (
    String(item.id) === String(itemId) ? { ...item, active: !!active } : item
  ));
  persistSnapshot();
}

function removeSnapshotService(itemId) {
  if (!state.snapshot || !Array.isArray(state.snapshot.service_items)) return;
  state.snapshot.service_items = state.snapshot.service_items.filter(
    (item) => String(item.id) !== String(itemId)
  );
  persistSnapshot();
}

/* استبدال المعرّف المؤقت للخدمة بمعرّف الخادم في كل البيانات المحلية والطوابير. */
function mapTempService(tempId, serverItem) {
  if (!serverItem) return;
  if (state.snapshot && Array.isArray(state.snapshot.service_items)) {
    state.snapshot.service_items = state.snapshot.service_items.filter(
      (item) => String(item.id) !== String(tempId)
    );
    upsertSnapshotService(serverItem);
  }
  for (const order of state.orders) {
    if (order.items && order.items[tempId] != null) {
      order.items[serverItem.id] = { ...order.items[tempId], service_item_id: serverItem.id };
      delete order.items[tempId];
    }
  }
  save(KEY_ORDERS, state.orders);
  for (const queued of state.queue) {
    if (queued.items && queued.items[tempId] != null) {
      queued.items[serverItem.id] = { ...queued.items[tempId], service_item_id: serverItem.id };
      delete queued.items[tempId];
    }
  }
  save(KEY_QUEUE, state.queue);
  for (const action of state.serviceActions) {
    if (String(action.item_id) === String(tempId)) action.item_id = serverItem.id;
  }
  for (const action of state.actions) {
    if (action.payload && Array.isArray(action.payload.items)) {
      action.payload.items = action.payload.items.map((line) => (
        String(line.service_item_id) === String(tempId)
          ? { ...line, service_item_id: serverItem.id }
          : line
      ));
    }
    if (action.localPatch && action.localPatch.items && action.localPatch.items[tempId] != null) {
      action.localPatch.items[serverItem.id] = {
        ...action.localPatch.items[tempId],
        service_item_id: serverItem.id,
      };
      delete action.localPatch.items[tempId];
    }
  }
  save(KEY_ACTIONS, state.actions);
  save(KEY_SERVICE_ACTIONS, state.serviceActions);
}

function isClientError(status) {
  return status >= 400 && status < 500 && status !== 401 && status !== 403;
}

export async function syncActions() {
  const hasService = (state.serviceActions || []).length > 0;
  const hasOrder = state.actions.length > 0;
  if (!hasService && !hasOrder) return { applied: 0, failed: 0 };
  if (!isOnline()) return { applied: 0, failed: 0, offline: true };

  let applied = 0;
  let failed = 0;
  const errors = [];

  /* الخدمات أولاً حتى تتوفر معرّفات الخادم قبل إرسال الطلبات التي تستخدمها. */
  if (hasService) {
    const remainingService = [];
    for (const action of state.serviceActions.slice()) {
      let res;
      if (action.type === "service_create") {
        res = await apiRequest("/api/service-items", {
          method: "POST",
          body: {
            code: action.payload.code,
            name: action.payload.name,
            unit: action.payload.unit,
            rate: action.payload.rate,
          },
        });
      } else {
        const itemId = action.item_id;
        if (itemId == null || Number(itemId) < 0) {
          remainingService.push(action);
          continue;
        }
        if (action.type === "service_update") {
          res = await apiRequest(`/api/service-items/${itemId}`, { method: "PUT", body: action.payload });
        } else if (action.type === "service_toggle") {
          res = await apiRequest(`/api/service-items/${itemId}/toggle`, { method: "POST", body: {} });
        } else if (action.type === "service_delete") {
          res = await apiRequest(`/api/service-items/${itemId}`, { method: "DELETE" });
        } else {
          remainingService.push(action);
          continue;
        }
      }
      if (res.ok) {
        applied += 1;
        if (action.type === "service_create") {
          mapTempService(action.temp_id, res.data?.service_item);
        } else if (action.type === "service_update") {
          upsertSnapshotService(res.data?.service_item);
        } else if (action.type === "service_toggle") {
          setSnapshotServiceActive(action.item_id, action.payload.active);
        } else if (action.type === "service_delete") {
          removeSnapshotService(action.item_id);
        }
      } else if (isClientError(res.status) && !(action.type === "service_delete" && res.status === 404)) {
        failed += 1;
        errors.push(res.data?.error || res.error || `تعذر تنفيذ إجراء على الخدمة (${res.status}).`);
      } else {
        if (action.type === "service_delete" && res.status === 404) {
          applied += 1;
          removeSnapshotService(action.item_id);
        } else {
          failed += 1;
          action.last_error = res.data?.error || res.error || `status=${res.status}`;
          remainingService.push(action);
        }
      }
    }
    state.serviceActions = remainingService;
    save(KEY_SERVICE_ACTIONS, state.serviceActions);
  }

  if (hasOrder) {
    // إجراءات تسليم مسجّلة دون اتصال على طلبات لم يُرسلها الجهاز بعد:
    // نمرّر (push) هذه الطلبات أولاً حتى نحصل على معرّفها من الخادم، ثم ننفّذ التسليم.
    const unresolvedDeliveries = state.actions.some((a) => a.type === "deliver" && !a.order_id && a.client_uuid);
    if (unresolvedDeliveries && isOnline() && state.queue.length) {
      await syncOrders();
      for (const action of state.actions) {
        if (action.type !== "deliver" || action.order_id) continue;
        const local = findOrderForAction(action);
        if (local && local.server_id) action.order_id = local.server_id;
      }
      save(KEY_ACTIONS, state.actions);
    }
    const remaining = [];
    for (const action of state.actions.slice()) {
      let res;
      if (action.type === "deliver") {
        if (!action.order_id) {
          // ما زال الطلب غير مُرسل (خدمة أخرى أو فشل الإرسال) — نتركه للدورة القادمة.
          action.last_error = "بانتظار إرسال الطلب إلى الخادم أولاً.";
          remaining.push(action);
          continue;
        }
        res = await apiRequest(`/api/orders/${action.order_id}/deliver`, { method: "POST", body: action.payload });
      } else if (action.type === "confirm") {
        res = await apiRequest(`/api/orders/${action.order_id}/confirm`, { method: "POST", body: action.payload });
      } else if (action.type === "update") {
        res = await apiRequest(`/api/orders/${action.order_id}`, { method: "PUT", body: action.payload });
      } else if (action.type === "delete") {
        res = await apiRequest(`/api/orders/${action.order_id}`, { method: "DELETE" });
      } else {
        remaining.push(action);
        continue;
      }
      if (res.ok || (action.type === "delete" && res.status === 404)) {
        applied += 1;
        const order = findOrderForAction(action);
        if (action.type === "deliver") {
          updateLocalItemsFromServer(order, res.data?.items);
          // نعتمد نسخة الخادم (الكميات والمستلم) لضمان دقة الحالة بعد التسليم الجزئي.
          await refreshOrderFromServer(action.order_id, action.client_uuid);
        } else if (action.type === "update" && res.data?.order) {
          replaceLocalOrderFromServer(action.client_uuid, res.data.order);
        }
      } else if (isClientError(res.status)) {
        failed += 1;
        errors.push(res.data?.error || res.error || `تعذر تنفيذ الإجراء (${res.status}).`);
        // رفض الخادم الإجراء: نتراجع عن التحديث المتفائل ونعيد الحالة الحقيقية من الخادم.
        revertActionLocally(action);
        if (action.type !== "delete") {
          await refreshOrderFromServer(action.order_id, action.client_uuid);
        }
      } else {
        failed += 1;
        action.last_error = res.data?.error || res.error || `status=${res.status}`;
        remaining.push(action);
      }
    }
    state.actions = remaining;
    save(KEY_ACTIONS, state.actions);
  }

  return { applied, failed, errors };
}

export async function autoSync() {
  if (!isOnline() || !isOnlineSession()) return null;
  if (state.queue.length === 0 && state.actions.length === 0
      && (state.serviceActions || []).length === 0 && state.snapshot) {
    // إصلاح تلقائي للطلبات القديمة التي حُفظت بلا معرّفات أصناف من الخادم.
    const needsItemIds = state.orders.some((o) => o.server_id
      && Object.values(o.items || {}).some((line) => line.id == null || line.id === ""));
    if (needsItemIds) return { history: await fetchServerOrders() };
    return null;
  }
  return syncEverything();
}
