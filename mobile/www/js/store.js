/* مخزن محلي لتطبيق المغسلة — يعمل دون اتصال ويحفظ نسخة البيانات والطلبات غير المُرسلة. */

const KEY_SNAPSHOT = "ln_snap";
const KEY_SESSION = "ln_session";
const KEY_TOKENS = "ln_tokens";
const KEY_QUEUE = "ln_queue";
const KEY_ORDERS = "ln_orders";
const KEY_CONFIG = "ln_config";
const KEY_PIN = "ln_pin";
const KEY_ACTIONS = "ln_actions";
const KEY_IDENTITY = "ln_identity";
const KEY_LOCK = "ln_locked";

/* عنوان الخادم المدمج في نسخة التطبيق — ضع رابط Render هنا قبل البناء ليُضبط تلقائياً.
   يمكن تجاوزه من داخل التطبيق: الإعدادات ← عنوان الخادم. */
export const BUILD_DEFAULT_SERVER = "";

export const state = {
  snapshot: null,
  session: null,
  tokens: null,
  queue: [],
  orders: [],
  actions: [],
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
  state.snapshot = load(KEY_SNAPSHOT, null);
  return state.session;
}

export function storeSession(session, tokens) {
  state.session = session;
  state.tokens = tokens;
  save(KEY_SESSION, session);
  save(KEY_TOKENS, tokens);
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
  const username = (state.session || getIdentity() || {}).username || "";
  state.session = null;
  state.tokens = null;
  localStorage.removeItem(KEY_SESSION);
  localStorage.removeItem(KEY_TOKENS);
  localStorage.removeItem(KEY_IDENTITY);
  localStorage.removeItem(KEY_LOCK);
  if (username) localStorage.removeItem(`${KEY_PIN}:${username}`);
}

/* فتح التطبيق بالرمز المحلي: يعيد الجلسة والرموز المحفوظة ليعمل دون اتصال
   وتتم المزامنة تلقائياً عند عودة الاتصال. */
export function unlockWithLocalPin(username) {
  const identity = getIdentity();
  const stored = load(KEY_SESSION, null);
  const session = stored || identity;
  if (!session) return null;
  state.session = { ...session, username: session.username || username };
  state.tokens = load(KEY_TOKENS, null);
  save(KEY_SESSION, state.session);
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

export async function syncSnapshotFromServer() {
  const res = await apiRequest("/api/sync/snapshot");
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
  const s = state.snapshot;
  return s ? s.service_items || [] : [];
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

/* ---------- طابور المزامنة ---------- */

export function getQueue() {
  return state.queue;
}

export function enqueueOrder(order) {
  state.queue.push({
    client_uuid: order.client_uuid,
    employee_code: order.employee_code,
    person_name: order.person_name || "",
    service_date: order.service_date,
    notes: order.notes || "",
    items: order.items,
    created_at: order.created_at,
    queued_at: new Date().toISOString(),
  });
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
  const orders = await syncOrders();
  const actions = await syncActions();
  const history = await fetchServerOrders();
  return { snapshot: snap, orders, actions, history };
}

/* ---------- سجل الطلبات من الخادم ---------- */

/* تحويل أصناف الخادم (مصفوفة) إلى الصيغة المحلية (كائن مفهرس بمعرّف الصنف). */
function normalizeServerItems(lines) {
  const out = {};
  for (const line of lines || []) {
    out[line.service_item_id] = {
      quantity: Number(line.quantity || 0),
      unit_price: Number(line.unit_price || 0),
      item_name: line.item_name || "",
    };
  }
  return out;
}

function normalizeServerOrder(row) {
  return {
    client_uuid: row.client_uuid || `srv-${row.id}`,
    server_id: row.id,
    reference: row.reference || "",
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
      // الطلب المحلي موجود: نحدّث حالة الخادم مع الحفاظ على الأصناف المحلية.
      state.orders[idx] = {
        ...state.orders[idx],
        server_id: incoming.server_id,
        reference: incoming.reference,
        status: incoming.status,
        fulfillment_status: incoming.fulfillment_status,
        delivered_at: incoming.delivered_at,
        confirmed_at: incoming.confirmed_at,
        rejection_reason: incoming.rejection_reason,
        subtotal: incoming.subtotal,
        sync_state: state.orders[idx].sync_state === "pending" ? "pending" : "synced",
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

/* ---------- طابور الإجراءات (تسليم/اعتماد) دون اتصال ---------- */

export function pendingActions() {
  return state.actions;
}

export function pendingActionCount() {
  return state.actions.length;
}

export function queueAction(type, order, payload = {}) {
  if (!order || !order.server_id) return null;
  const action = {
    action_id: uuid(),
    type,
    order_id: order.server_id,
    client_uuid: order.client_uuid || "",
    payload,
    created_at: new Date().toISOString(),
  };
  state.actions.push(action);
  save(KEY_ACTIONS, state.actions);
  return action;
}

function applyActionLocally(action) {
  const order = state.orders.find(
    (o) => (action.client_uuid && o.client_uuid === action.client_uuid) || o.server_id === action.order_id
  );
  if (!order) return;
  if (action.type === "deliver") {
    order.fulfillment_status = "delivered";
    order.delivered_at = new Date().toISOString();
  } else {
    order.status = action.payload.decision || "approved";
    order.confirmed_at = new Date().toISOString();
    if (action.payload.rejection_reason) order.rejection_reason = action.payload.rejection_reason;
  }
  saveLocalOrder(order);
}

export async function syncActions() {
  if (!state.actions.length) return { applied: 0, failed: 0 };
  if (!isOnline()) return { applied: 0, failed: 0, error: "لا يوجد اتصال بالإنترنت." };
  let applied = 0;
  let failed = 0;
  const remaining = [];
  for (const action of state.actions) {
    const path = action.type === "deliver"
      ? `/api/orders/${action.order_id}/deliver`
      : `/api/orders/${action.order_id}/confirm`;
    const res = await apiRequest(path, { method: "POST", body: action.payload });
    if (res.ok) {
      applied += 1;
      applyActionLocally(action);
    } else {
      failed += 1;
      action.last_error = res.data?.error || res.error || `status=${res.status}`;
      remaining.push(action);
    }
  }
  state.actions = remaining;
  save(KEY_ACTIONS, state.actions);
  return { applied, failed };
}

export function autoSync() {
  if (!isOnline() || !isOnlineSession()) return;
  if (state.queue.length === 0 && state.actions.length === 0 && state.snapshot) return;
  syncEverything();
}
