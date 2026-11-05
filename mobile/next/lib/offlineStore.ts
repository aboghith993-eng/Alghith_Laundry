/* مخزن محلي لتطبيق المغسلة — يعمل دون اتصال ويحفظ نسخة البيانات والطلبات والعمليات غير المُرسلة. */

import type {
  AppConfig,
  CreatePayload,
  DeliveryPiece,
  Employee,
  LocalOrder,
  Operation,
  OrderInput,
  OrderLine,
  ServerOrder,
  ServerOrderItem,
  ServiceItem,
  ServiceOp,
  ServicePayload,
  SessionUser,
  Snapshot,
  SyncInfo,
  Tokens,
  UserRole,
} from "./types";
import { nowIso, todayIso } from "./shift";
import { num } from "./format";

const KEY_SNAPSHOT = "ln_snap";
const KEY_SESSION = "ln_session";
const KEY_TOKENS = "ln_tokens";
const KEY_QUEUE = "ln_queue";
const KEY_OPS = "ln_ops";
const KEY_ORDERS = "ln_orders";
const KEY_CONFIG = "ln_config";
const KEY_PIN = "ln_pin";
const KEY_ACTIONS = "ln_actions";
const KEY_IDENTITY = "ln_identity";
const KEY_LOCK = "ln_locked";
const KEY_LAST_SYNC = "ln_last_sync";
const KEY_SERVICES = "ln_services";
const KEY_SERVICE_OPS = "ln_svc_ops";

/** الخادم الافتراضي المدمج في نسخة التطبيق. */
export const BUILD_DEFAULT_SERVER = "https://alghith-laundry.onrender.com";

export type StoreState = {
  ready: boolean;
  session: SessionUser | null;
  tokens: Tokens | null;
  snapshot: Snapshot | null;
  orders: LocalOrder[];
  queue: CreatePayload[];
  ops: Operation[];
  services: ServiceItem[];
  serviceOps: ServiceOp[];
  config: AppConfig;
  online: boolean;
  syncing: boolean;
  lastError: string;
  lastSync: string;
};

export const state: StoreState = {
  ready: false,
  session: null,
  tokens: null,
  snapshot: null,
  orders: [],
  queue: [],
  ops: [],
  services: [],
  serviceOps: [],
  config: { server_url: "" },
  online: typeof navigator !== "undefined" ? navigator.onLine : true,
  syncing: false,
  lastError: "",
  lastSync: "",
};

let initialized = false;
const listeners = new Set<() => void>();

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* التخزين ممتلئ أو معطّل */
  }
}

function remove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------------------------------------------------------------------------
   التهيئة
   --------------------------------------------------------------------------- */

export function initStore(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  state.session = load<SessionUser | null>(KEY_SESSION, null);
  state.tokens = load<Tokens | null>(KEY_TOKENS, null);
  state.config = { server_url: "", ...load<AppConfig>(KEY_CONFIG, {}) };
  state.queue = load<CreatePayload[]>(KEY_QUEUE, []);
  state.snapshot = load<Snapshot | null>(KEY_SNAPSHOT, null);
  state.orders = load<LocalOrder[]>(KEY_ORDERS, []).map(normalizeLocalOrder);
  state.ops = load<Operation[]>(KEY_OPS, []);
  state.serviceOps = load<ServiceOp[]>(KEY_SERVICE_OPS, []);
  const cachedServices = load<ServiceItem[] | null>(KEY_SERVICES, null);
  state.services = cachedServices || state.snapshot?.service_items || [];
  state.lastSync = load<string>(KEY_LAST_SYNC, "");
  state.online = typeof navigator === "undefined" ? true : navigator.onLine;

  // ترحيل طابور الإجراءات القديم (تسليم/اعتماد) إلى الطابور الموحّد.
  const legacy = load<Array<Record<string, unknown>>>(KEY_ACTIONS, []);
  if (Array.isArray(legacy) && legacy.length) {
    for (const action of legacy) {
      const type = action.type === "deliver" ? "deliver" : "confirm";
      state.ops.push({
        id: String(action.action_id || uuid()),
        type,
        client_uuid: String(action.client_uuid || ""),
        order_id: Number(action.order_id) || null,
        payload: (action.payload as Record<string, unknown>) || {},
        created_at: String(action.created_at || nowIso()),
      });
    }
    remove(KEY_ACTIONS);
  }
  // ترحيل الطلبات التي كانت تُعلَّم "synced" من نسخ سابقة.
  state.orders = state.orders.map((o) =>
    o.sync_state === "synced" ? { ...o, source: o.source || "server" } : o,
  );

  save(KEY_OPS, state.ops);
  state.ready = true;
  notify();
}

/* ---------------------------------------------------------------------------
   الجلسة والهوية والقفل
   --------------------------------------------------------------------------- */

export function getIdentity(): Partial<SessionUser> | null {
  return load<Partial<SessionUser> | null>(KEY_IDENTITY, null);
}

function storeIdentity(user: SessionUser | null): void {
  if (!user) return;
  save(KEY_IDENTITY, {
    id: user.id,
    username: user.username || "",
    role: user.role || "",
    full_name: user.full_name || user.name || "",
  });
}

export function storeSession(session: SessionUser, tokens: Tokens): void {
  state.session = session;
  state.tokens = tokens;
  save(KEY_SESSION, session);
  save(KEY_TOKENS, tokens);
  storeIdentity(session);
  setLocked(false);
  notify();
}

export function hasSession(): boolean {
  return !!state.session && !isLocked();
}

export function isLocked(): boolean {
  return !!load<boolean>(KEY_LOCK, false);
}

export function setLocked(value: boolean): void {
  if (value) save(KEY_LOCK, true);
  else remove(KEY_LOCK);
}

/** قفل التطبيق: يوقف الجلسة في الذاكرة ويُبقي الرموز المحفوظة للمزامنة لاحقاً. */
export function lockApp(): void {
  state.session = null;
  state.tokens = null;
  setLocked(true);
  notify();
}

/** فتح التطبيق بالرمز المحلي أو بالجلسة المحفوظة. */
export function unlockLocal(username?: string): SessionUser | null {
  const stored = load<SessionUser | null>(KEY_SESSION, null);
  const identity = getIdentity();
  const session = stored || (identity ? ({ ...identity } as SessionUser) : null);
  if (!session) return null;
  state.session = { ...session, username: session.username || username || "" };
  state.tokens = load<Tokens | null>(KEY_TOKENS, null);
  save(KEY_SESSION, state.session);
  setLocked(false);
  notify();
  return state.session;
}

/** خروج كامل يمسح الجلسة والرموز والهوية والرمز المحلي. */
export function fullSignOut(): void {
  const username = (state.session || getIdentity() || {}).username || "";
  state.session = null;
  state.tokens = null;
  remove(KEY_SESSION);
  remove(KEY_TOKENS);
  remove(KEY_IDENTITY);
  remove(KEY_LOCK);
  if (username) remove(`${KEY_PIN}:${username}`);
  notify();
}

/* ---------------------------------------------------------------------------
   PIN محلي (فتح سريع دون اتصال)
   --------------------------------------------------------------------------- */

async function sha256Hex(text: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${text}::${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function setLocalPin(pin: string, username: string): Promise<void> {
  const salt = uuid().slice(0, 8);
  save(`${KEY_PIN}:${username}`, { salt, hash: await sha256Hex(pin, salt) });
}

export async function verifyLocalPin(pin: string, username: string): Promise<boolean> {
  const rec = load<{ salt: string; hash: string } | null>(`${KEY_PIN}:${username}`, null);
  if (!rec) return false;
  return (await sha256Hex(pin, rec.salt)) === rec.hash;
}

export function hasLocalPin(username: string): boolean {
  return !!load<unknown>(`${KEY_PIN}:${username}`, null);
}

/* ---------------------------------------------------------------------------
   إعدادات الخادم والاتصال
   --------------------------------------------------------------------------- */

export function getConfig(): AppConfig {
  state.config = { server_url: "", ...load<AppConfig>(KEY_CONFIG, {}) };
  return state.config;
}

export function saveConfig(patch: AppConfig): AppConfig {
  state.config = { ...state.config, ...patch };
  save(KEY_CONFIG, state.config);
  notify();
  return state.config;
}

export function normalizeBaseUrl(url?: string): string {
  const trimmed = (url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

export function backendBaseUrl(): string {
  const cfg = getConfig();
  const raw = (cfg.server_url || "").trim();
  if (raw) return normalizeBaseUrl(raw);
  if (typeof window === "undefined") return "";
  if (BUILD_DEFAULT_SERVER) return normalizeBaseUrl(BUILD_DEFAULT_SERVER);
  return window.location.origin;
}

export function isOnline(): boolean {
  return state.online;
}

export function setOnline(value: boolean): void {
  const changed = state.online !== !!value;
  state.online = !!value;
  if (changed) notify();
}

export function isOnlineSession(): boolean {
  return !!(state.session && state.tokens && state.tokens.access_token);
}

/* ---------------------------------------------------------------------------
   طلبات HTTP
   --------------------------------------------------------------------------- */

type ApiResult<T = unknown> = {
  status: number;
  ok: boolean;
  data: T | null;
  code: string;
  error?: string;
};

async function rawRequest<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    auth?: boolean;
    timeoutMs?: number;
  } = {},
): Promise<ApiResult<T>> {
  const base = backendBaseUrl();
  if (!base) {
    return {
      status: 0,
      ok: false,
      data: null,
      code: "no_server",
      error: "لم يتم ضبط عنوان الخادم بعد.",
    };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false && state.tokens?.access_token) {
    headers.Authorization = `Bearer ${state.tokens.access_token}`;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45000);
  try {
    const res = await fetch(`${base}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      status: res.status,
      ok: res.ok,
      data: data as T,
      code: res.ok ? "ok" : `http_${res.status}`,
    };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
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

async function refreshTokens(): Promise<boolean> {
  const refresh = state.tokens?.refresh_token;
  if (!refresh) return false;
  const res = await rawRequest<{
    access_token?: string;
    refresh_token?: string;
    user?: SessionUser;
  }>("/api/auth/refresh", { method: "POST", body: { refresh_token: refresh }, auth: false });
  if (res.ok && res.data?.access_token) {
    state.tokens = {
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token || refresh,
    };
    save(KEY_TOKENS, state.tokens);
    if (res.data.user) {
      state.session = res.data.user;
      save(KEY_SESSION, state.session);
    }
    notify();
    return true;
  }
  return false;
}

export async function apiRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  let res = await rawRequest<T>(path, options);
  if ((res.status === 401 || res.status === 403) && options.auth !== false) {
    if (await refreshTokens()) {
      res = await rawRequest<T>(path, options);
    }
  }
  return res;
}

/* ---------------------------------------------------------------------------
   تسجيل الدخول
   --------------------------------------------------------------------------- */

export async function tryOnlineLogin(
  username: string,
  password: string,
): Promise<{ ok: boolean; user?: SessionUser; code?: string; detail?: string }> {
  const res = await rawRequest<{
    access_token?: string;
    refresh_token?: string;
    user?: SessionUser;
    error?: string;
  }>("/api/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
  if (res.ok && res.data?.user && res.data.access_token) {
    storeSession(res.data.user, {
      access_token: res.data.access_token,
      refresh_token: res.data.refresh_token,
    });
    return { ok: true, user: res.data.user };
  }
  if (res.status === 401) return { ok: false, code: "unauthorized" };
  const data = res.data as { error?: string } | null;
  return {
    ok: false,
    code: res.code || "unreachable",
    detail: data?.error || res.error || `status=${res.status}`,
  };
}

export async function testServerConnection(): Promise<{
  ok: boolean;
  base?: string;
  code?: string;
  error?: string;
}> {
  const base = backendBaseUrl();
  if (!base) return { ok: false, code: "no_server", error: "لم يتم ضبط عنوان الخادم بعد." };
  const res = await rawRequest("/api/mobile/ping", { auth: false, timeoutMs: 12000 });
  if (res.ok) return { ok: true, base };
  return { ok: false, code: res.code, base, error: res.error || `status=${res.status}` };
}

/* ---------------------------------------------------------------------------
   تحويل بيانات الخادم
   --------------------------------------------------------------------------- */

function serverItemToLine(line: ServerOrderItem): OrderLine {
  const quantity = num(line.quantity);
  const unitPrice = num(line.unit_price);
  return {
    item_id: Number(line.id) || null,
    service_item_id: Number(line.service_item_id) || undefined,
    item_name: line.item_name || "",
    unit: line.unit || "",
    quantity,
    unit_price: unitPrice,
    line_total: line.line_total !== undefined ? num(line.line_total) : quantity * unitPrice,
    received_quantity: num(line.received_quantity),
  };
}

function normalizeLocalOrder(raw: LocalOrder): LocalOrder {
  const items: Record<string, OrderLine> = {};
  for (const [key, line] of Object.entries(raw.items || {})) {
    items[key] = {
      item_id: line.item_id ?? null,
      service_item_id: Number(line.service_item_id || key) || undefined,
      item_name: line.item_name || "",
      unit: line.unit || "",
      quantity: num(line.quantity),
      unit_price: num(line.unit_price),
      line_total:
        line.line_total !== undefined
          ? num(line.line_total)
          : num(line.quantity) * num(line.unit_price),
      received_quantity: num(line.received_quantity),
    };
  }
  const subtotal =
    raw.subtotal !== undefined && raw.subtotal !== null
      ? num(raw.subtotal)
      : Object.values(items).reduce((sum, l) => sum + num(l.line_total), 0);
  return {
    ...raw,
    items,
    subtotal,
    status: raw.status || "pending",
    fulfillment_status: raw.fulfillment_status || "received",
    person_name: raw.person_name || "",
    notes: raw.notes || "",
  };
}

export function fromServerOrder(row: ServerOrder): LocalOrder {
  const items: Record<string, OrderLine> = {};
  for (const line of row.items || []) {
    const key = String(line.service_item_id);
    items[key] = serverItemToLine(line);
  }
  const subtotal =
    row.subtotal !== undefined && row.subtotal !== null
      ? num(row.subtotal)
      : Object.values(items).reduce((sum, l) => sum + num(l.line_total), 0);
  return {
    client_uuid: row.client_uuid || `srv-${row.id}`,
    server_id: row.id,
    reference: row.reference || "",
    employee_id: row.employee_id ?? null,
    employee_code: row.employee_code || "",
    employee_name: row.employee_name || "",
    person_name: row.person_name || "",
    service_date: row.service_date || "",
    notes: row.notes || "",
    items,
    subtotal,
    status: row.status || "pending",
    fulfillment_status: row.fulfillment_status || "received",
    delivered_at: row.delivered_at || "",
    confirmed_at: row.confirmed_at || "",
    received_at: row.received_at || "",
    rejection_reason: row.rejection_reason || "",
    receiver_kind: row.receiver_kind || "",
    receiver_name: row.receiver_name || "",
    creator_name: row.creator_name || "",
    confirmer_name: row.confirmer_name || "",
    deliverer_name: row.deliverer_name || "",
    created_at: row.created_at || "",
    sync_state: "synced",
    source: "server",
  };
}

function hasPendingFor(uuidValue: string): boolean {
  return (
    state.queue.some((q) => q.client_uuid === uuidValue) ||
    state.ops.some((o) => o.client_uuid === uuidValue)
  );
}

function mergeServerOrders(list: ServerOrder[]): number {
  const deletes = new Set(
    state.ops.filter((o) => o.type === "delete").map((o) => o.client_uuid),
  );
  for (const incoming of list) {
    const uuidValue = incoming.client_uuid || `srv-${incoming.id}`;
    if (deletes.has(uuidValue)) continue;
    const idx = state.orders.findIndex(
      (o) => o.client_uuid === uuidValue || (o.server_id && o.server_id === incoming.id),
    );
    const fresh = fromServerOrder(incoming);
    if (idx < 0) {
      state.orders.push(fresh);
      continue;
    }
    const local = state.orders[idx];
    if (hasPendingFor(local.client_uuid)) {
      // لا نطمس تعديلات محلية غير مزامنة — نحدّث بيانات التعريف فقط.
      local.server_id = fresh.server_id;
      local.reference = fresh.reference || local.reference;
      local.employee_name = fresh.employee_name || local.employee_name;
      local.creator_name = fresh.creator_name || local.creator_name;
    } else {
      state.orders[idx] = {
        ...fresh,
        client_uuid: local.client_uuid,
        warnings: local.warnings,
        sync_state: local.sync_state === "error" ? "error" : "synced",
        source: local.source === "local" ? local.source : "server",
      } as LocalOrder;
    }
  }
  state.orders.sort((a, b) => orderSortKey(b).localeCompare(orderSortKey(a)));
  save(KEY_ORDERS, state.orders);
  return state.orders.length;
}

function orderSortKey(o: LocalOrder): string {
  return `${o.service_date || ""}|${String(o.server_id || "").padStart(8, "0")}|${o.created_at || ""}`;
}

/* ---------------------------------------------------------------------------
   النسخة المحلية والطلبات من الخادم
   --------------------------------------------------------------------------- */

export function getSnapshot(): Snapshot | null {
  return state.snapshot;
}

export function snapshotMeta(): { built_at?: string; counts?: Record<string, number> } | null {
  const s = state.snapshot;
  return s ? { built_at: s.built_at, counts: s.counts } : null;
}

export function employees(): Employee[] {
  return state.snapshot?.employees || [];
}

export function serviceItems(): ServiceItem[] {
  return state.services;
}

export function activeServiceItems(): ServiceItem[] {
  return state.services.filter((item) => item.active !== false);
}

export function allServiceItems(): ServiceItem[] {
  return state.services;
}

/* ---------------------------------------------------------------------------
   الخدمات والأسعار — تُدار من مدير النظام وتعمل دون اتصال
   --------------------------------------------------------------------------- */

function persistServices(): void {
  save(KEY_SERVICES, state.services);
}

function persistServiceOps(): void {
  save(KEY_SERVICE_OPS, state.serviceOps);
}

function mergeServicesFromSnapshot(serverList: ServiceItem[]): void {
  const pending = new Set(
    state.serviceOps.map((op) => Number(op.service_id || 0)).filter((id) => id > 0),
  );
  const tempItems = state.services.filter(
    (item) =>
      Number(item.id) < 0 && state.serviceOps.some((op) => Number(op.temp_id) === Number(item.id)),
  );
  const merged = serverList.map((item) => {
    if (pending.has(Number(item.id))) {
      const local = state.services.find((l) => Number(l.id) === Number(item.id));
      return local || item;
    }
    return item;
  });
  state.services = [...merged, ...tempItems];
  persistServices();
}

function serviceCodeFromName(name: string): string {
  const ascii = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || `SVC_${Date.now().toString(36).toUpperCase()}`;
}

export function createService(
  input: ServicePayload,
): { ok: boolean; service?: ServiceItem; error?: string } {
  const name = (input.name || "").trim();
  const code = (input.code || serviceCodeFromName(name)).trim().toUpperCase().replace(/\s+/g, "_");
  const unit = (input.unit || "قطعة").trim() || "قطعة";
  const rate = num(input.rate);
  if (!name) return { ok: false, error: "اكتب اسم الخدمة." };
  if (!code) return { ok: false, error: "اكتب رمز الخدمة." };
  if (rate < 0) return { ok: false, error: "السعر يجب أن يكون رقماً غير سالب." };
  if (state.services.some((s) => (s.code || "").toUpperCase() === code)) {
    return { ok: false, error: "رمز الخدمة مستخدم بالفعل." };
  }
  const tempId = -(Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000));
  const service: ServiceItem = { id: tempId, code, name, unit, rate, active: true };
  state.services.push(service);
  state.serviceOps.push({
    id: uuid(),
    type: "upsert",
    temp_id: tempId,
    service_id: null,
    payload: { code, name, unit, rate, active: true },
    created_at: nowIso(),
  });
  persistServices();
  persistServiceOps();
  notify();
  void flush();
  return { ok: true, service };
}

export function updateService(
  serviceId: number,
  patch: Partial<ServicePayload>,
): { ok: boolean; service?: ServiceItem; error?: string } {
  const service = state.services.find((s) => Number(s.id) === Number(serviceId));
  if (!service) return { ok: false, error: "الخدمة غير موجودة." };
  const name = patch.name !== undefined ? patch.name.trim() : service.name;
  const unit = patch.unit !== undefined ? patch.unit.trim() || "قطعة" : service.unit;
  const rate = patch.rate !== undefined ? num(patch.rate) : num(service.rate);
  const code =
    patch.code !== undefined
      ? patch.code.trim().toUpperCase().replace(/\s+/g, "_")
      : (service.code || "");
  const active = patch.active !== undefined ? !!patch.active : service.active !== false;
  if (!name) return { ok: false, error: "اكتب اسم الخدمة." };
  if (rate < 0) return { ok: false, error: "السعر يجب أن يكون رقماً غير سالب." };
  if (
    code &&
    state.services.some(
      (s) => Number(s.id) !== Number(serviceId) && (s.code || "").toUpperCase() === code,
    )
  ) {
    return { ok: false, error: "رمز الخدمة مستخدم بالفعل." };
  }
  Object.assign(service, { name, unit, rate, code, active });

  const payload: ServicePayload = { code, name, unit, rate, active };
  if (Number(serviceId) < 0) {
    const op = state.serviceOps.find((o) => Number(o.temp_id) === Number(serviceId));
    if (op) op.payload = payload;
  } else {
    state.serviceOps = state.serviceOps.filter(
      (o) => !(o.type === "upsert" && Number(o.service_id) === Number(serviceId)),
    );
    state.serviceOps.push({
      id: uuid(),
      type: "upsert",
      service_id: Number(serviceId),
      payload,
      created_at: nowIso(),
    });
  }
  persistServices();
  persistServiceOps();
  notify();
  void flush();
  return { ok: true, service };
}

export function toggleService(serviceId: number): { ok: boolean; error?: string } {
  const service = state.services.find((s) => Number(s.id) === Number(serviceId));
  if (!service) return { ok: false, error: "الخدمة غير موجودة." };
  const res = updateService(serviceId, { active: service.active === false });
  return { ok: res.ok, error: res.error };
}

export function deleteService(serviceId: number): { ok: boolean; error?: string } {
  const service = state.services.find((s) => Number(s.id) === Number(serviceId));
  if (!service) return { ok: false, error: "الخدمة غير موجودة." };
  if (Number(serviceId) < 0) {
    state.services = state.services.filter((s) => Number(s.id) !== Number(serviceId));
    state.serviceOps = state.serviceOps.filter((o) => Number(o.temp_id) !== Number(serviceId));
  } else {
    service.active = false;
    state.serviceOps = state.serviceOps.filter(
      (o) => !(o.type === "upsert" && Number(o.service_id) === Number(serviceId)),
    );
    if (!state.serviceOps.some((o) => o.type === "delete" && Number(o.service_id) === Number(serviceId))) {
      state.serviceOps.push({
        id: uuid(),
        type: "delete",
        service_id: Number(serviceId),
        payload: {
          code: service.code,
          name: service.name,
          unit: service.unit,
          rate: num(service.rate),
          active: false,
        },
        created_at: nowIso(),
      });
    }
  }
  persistServices();
  persistServiceOps();
  notify();
  void flush();
  return { ok: true };
}

/** استبدال معرّف خدمة مؤقت بمعرّف الخادم في كل الطلبات والطوابير. */
function remapServiceId(oldId: number, newId: number): void {
  for (const service of state.services) {
    if (Number(service.id) === Number(oldId)) service.id = newId;
  }
  for (const order of state.orders) {
    let changed = false;
    const items: Record<string, OrderLine> = {};
    for (const [key, line] of Object.entries(order.items)) {
      if (Number(line.service_item_id) === Number(oldId)) {
        line.service_item_id = newId;
        items[String(newId)] = line;
        changed = true;
      } else {
        items[key] = line;
      }
    }
    if (changed) order.items = items;
  }
  for (const payload of state.queue) {
    for (const line of payload.items) {
      if (Number(line.service_item_id) === Number(oldId)) line.service_item_id = newId;
    }
  }
  for (const op of state.ops) {
    const items = op.payload?.items;
    if (Array.isArray(items)) {
      for (const line of items as Array<{ service_item_id?: number }>) {
        if (Number(line.service_item_id) === Number(oldId)) line.service_item_id = newId;
      }
    }
  }
  persistOrders();
  persistQueue();
  persistOps();
}

export async function syncServices(): Promise<{ applied: number; failed: number }> {
  if (!state.serviceOps.length || !isOnlineSession()) return { applied: 0, failed: 0 };
  let applied = 0;
  let failed = 0;
  const keep: ServiceOp[] = [];

  for (const op of state.serviceOps) {
    try {
      if (op.type === "upsert" && op.temp_id) {
        const res = await apiRequest<{
          ok: boolean;
          service_item?: ServiceItem;
          error?: string;
        }>("/api/service-items", { method: "POST", body: op.payload });
        if (res.ok) {
          let created = res.data?.service_item || null;
          if (!created) {
            const list = await apiRequest<{ ok: boolean; service_items: ServiceItem[] }>(
              "/api/service-items",
            );
            if (list.ok && Array.isArray(list.data?.service_items)) {
              created =
                list.data.service_items.find(
                  (s) =>
                    (s.code || "").toUpperCase() === (op.payload.code || "").toUpperCase(),
                ) || null;
            }
          }
          if (created) {
            remapServiceId(Number(op.temp_id), Number(created.id));
            const local = state.services.find((s) => Number(s.id) === Number(created.id));
            if (local) Object.assign(local, created);
          }
          applied += 1;
        } else {
          op.attempts = (op.attempts || 0) + 1;
          op.last_error =
            (res.data as { error?: string } | null)?.error ||
            res.error ||
            `تعذر حفظ الخدمة (${res.status}).`;
          keep.push(op);
          failed += 1;
        }
        continue;
      }

      if (op.type === "upsert" && op.service_id) {
        const res = await apiRequest<{
          ok: boolean;
          service_item?: ServiceItem;
          error?: string;
        }>(`/api/service-items/${op.service_id}`, { method: "PUT", body: op.payload });
        if (res.ok) {
          const local = state.services.find((s) => Number(s.id) === Number(op.service_id));
          if (local && res.data?.service_item) Object.assign(local, res.data.service_item);
          applied += 1;
        } else {
          op.attempts = (op.attempts || 0) + 1;
          op.last_error =
            (res.data as { error?: string } | null)?.error ||
            res.error ||
            `تعذر حفظ السعر (${res.status}).`;
          keep.push(op);
          failed += 1;
        }
        continue;
      }

      if (op.type === "delete" && op.service_id) {
        const res = await apiRequest(`/api/service-items/${op.service_id}`, { method: "DELETE" });
        if (res.ok || res.status === 404) {
          const local = state.services.find((s) => Number(s.id) === Number(op.service_id));
          if (local) local.active = false;
          applied += 1;
        } else {
          op.attempts = (op.attempts || 0) + 1;
          op.last_error =
            (res.data as { error?: string } | null)?.error ||
            res.error ||
            `تعذر حذف الخدمة (${res.status}).`;
          keep.push(op);
          failed += 1;
        }
      }
    } catch (err) {
      op.attempts = (op.attempts || 0) + 1;
      op.last_error = err instanceof Error ? err.message : "خطأ غير متوقع.";
      keep.push(op);
      failed += 1;
    }
  }

  state.serviceOps = keep;
  persistServices();
  persistServiceOps();
  notify();
  return { applied, failed };
}

export function pendingServiceCount(): number {
  return state.serviceOps.length;
}

export function settings(): Record<string, string> {
  return state.snapshot?.settings || {};
}

export function currency(): string {
  return settings().currency || "ر.ي";
}

export function searchEmployee(code: string): Employee | null {
  const wanted = (code || "").trim();
  if (!wanted) return null;
  return employees().find((e) => e.employee_code === wanted) || null;
}

export function findEmployees(text: string, limit = 40): Employee[] {
  const q = (text || "").trim().toLowerCase();
  if (!q) return [];
  return employees()
    .filter(
      (e) =>
        (e.name || "").toLowerCase().includes(q) ||
        (e.employee_code || "").toLowerCase().includes(q) ||
        (e.company || "").toLowerCase().includes(q),
    )
    .slice(0, limit);
}

export async function refreshSnapshot(): Promise<{ ok: boolean; error?: string }> {
  const res = await apiRequest<Snapshot>("/api/mobile/snapshot");
  if (res.ok && res.data && Array.isArray(res.data.employees)) {
    state.snapshot = res.data;
    save(KEY_SNAPSHOT, res.data);
    mergeServicesFromSnapshot(res.data.service_items || []);
    if (Array.isArray(res.data.orders)) mergeServerOrders(res.data.orders);
    notify();
    return { ok: true };
  }
  if (res.status === 403) {
    return { ok: false, error: "هذا الحساب غير مرتبط بشركة، ولا تظهر له بيانات المغسلة." };
  }
  if (res.status === 401) return { ok: false, error: "انتهت الجلسة. سجّل الدخول مجدداً." };
  return { ok: false, error: res.error || `تعذر تحميل البيانات (${res.status}).` };
}

export async function fetchServerOrders(params: {
  from?: string;
  to?: string;
  status?: string;
  q?: string;
  limit?: number;
} = {}): Promise<{ ok: boolean; count?: number; error?: string }> {
  const query = new URLSearchParams();
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.status) query.set("status", params.status);
  if (params.q) query.set("q", params.q);
  query.set("limit", String(params.limit || 500));
  const res = await apiRequest<{ ok: boolean; orders: ServerOrder[] }>(
    `/api/orders?${query.toString()}`,
  );
  if (res.ok && res.data && Array.isArray(res.data.orders)) {
    mergeServerOrders(res.data.orders);
    return { ok: true, count: res.data.orders.length };
  }
  if (res.status === 401) return { ok: false, error: "انتهت الجلسة. سجّل الدخول مجدداً." };
  return { ok: false, error: res.error || `تعذر تحميل الطلبات (${res.status}).` };
}

/** جلب طلب واحد وتحديث معرّفات بنوده محلياً — ضروري لتسجيل التسليم الجزئي. */
export async function fetchOrderDetail(orderId: number): Promise<boolean> {
  const res = await apiRequest<{ ok: boolean; order?: ServerOrder }>(`/api/orders/${orderId}`);
  if (!res.ok || !res.data?.order) return false;
  const row = res.data.order;
  mergeServerOrders([row]);
  const local = state.orders.find(
    (order) => Number(order.server_id) === Number(orderId) || order.client_uuid === row.client_uuid,
  );
  if (local && Array.isArray(row.items)) {
    const used = new Set<number>();
    const pool = row.items;
    for (const line of Object.values(local.items)) {
      if (line.item_id) continue;
      const match = pool.find(
        (item) =>
          !used.has(Number(item.id)) &&
          Number(item.service_item_id) === Number(line.service_item_id),
      );
      if (match) {
        used.add(Number(match.id));
        line.item_id = Number(match.id);
        line.received_quantity = num(match.received_quantity);
      }
    }
    local.subtotal = num(row.subtotal);
    persistOrders();
    notify();
  }
  return true;
}

/* ---------------------------------------------------------------------------
   الطلبات المحلية
   --------------------------------------------------------------------------- */

export function getLocalOrders(): LocalOrder[] {
  return state.orders;
}

export function getOrder(uuidValue: string): LocalOrder | null {
  return state.orders.find((o) => o.client_uuid === uuidValue) || null;
}

function persistOrders(): void {
  save(KEY_ORDERS, state.orders);
}

function persistQueue(): void {
  save(KEY_QUEUE, state.queue);
}

function persistOps(): void {
  save(KEY_OPS, state.ops);
}

function sortOrders(): void {
  state.orders.sort((a, b) => orderSortKey(b).localeCompare(orderSortKey(a)));
}

function localItems(input: Record<string, OrderLine>): Record<string, OrderLine> {
  const items: Record<string, OrderLine> = {};
  for (const [key, line] of Object.entries(input)) {
    const quantity = num(line.quantity);
    if (quantity <= 0) continue;
    const unitPrice = num(line.unit_price);
    items[key] = {
      ...line,
      quantity,
      unit_price: unitPrice,
      line_total: line.line_total !== undefined ? num(line.line_total) : quantity * unitPrice,
      received_quantity: num(line.received_quantity),
    };
  }
  return items;
}

function itemsSubtotal(items: Record<string, OrderLine>): number {
  return Object.values(items).reduce((sum, line) => sum + num(line.line_total), 0);
}

function buildCreatePayload(order: LocalOrder): CreatePayload {
  return {
    client_uuid: order.client_uuid,
    employee_id: order.employee_id ?? null,
    employee_code: order.employee_code,
    person_name: order.person_name || "",
    service_date: order.service_date,
    notes: order.notes || "",
    items: Object.values(order.items).map((line) => ({
      service_item_id: Number(line.service_item_id),
      quantity: num(line.quantity),
    })),
    created_at: order.created_at || nowIso(),
  };
}

export function createOrder(input: OrderInput): { ok: boolean; order?: LocalOrder; error?: string } {
  if (!input.employee) return { ok: false, error: "اختر موظفاً أولاً." };
  const items = localItems(input.items);
  if (!Object.keys(items).length) {
    return { ok: false, error: "أضف صنفاً واحداً على الأقل بالكمية المناسبة." };
  }
  if (input.employee.person_type === "general" && !input.person_name.trim()) {
    return { ok: false, error: "للسجل العام اكتب اسم الزائر الفعلي." };
  }
  const order: LocalOrder = {
    client_uuid: uuid(),
    server_id: null,
    reference: null,
    employee_id: Number(input.employee.id) || null,
    employee_code: input.employee.employee_code,
    employee_name: input.employee.name,
    person_name: input.person_name.trim(),
    service_date: input.service_date || todayIso(),
    notes: input.notes.trim(),
    items,
    subtotal: itemsSubtotal(items),
    status: "pending",
    fulfillment_status: "received",
    created_at: nowIso(),
    sync_state: "pending",
    source: "local",
  };
  state.orders.unshift(order);
  state.queue.push(buildCreatePayload(order));
  sortOrders();
  persistOrders();
  persistQueue();
  notify();
  void flush();
  return { ok: true, order };
}

export function updateOrder(
  uuidValue: string,
  input: OrderInput,
): { ok: boolean; order?: LocalOrder; error?: string } {
  const order = getOrder(uuidValue);
  if (!order) return { ok: false, error: "الطلب غير موجود على هذا الجهاز." };
  if (order.status !== "pending") return { ok: false, error: "لا يمكن تعديل طلب تمت مراجعته." };
  const received = Object.values(order.items).reduce(
    (sum, line) => sum + num(line.received_quantity),
    0,
  );
  if (received > 0) return { ok: false, error: "لا يمكن تعديل طلب بدأ تسليمه." };
  const items = localItems(input.items);
  if (!Object.keys(items).length) {
    return { ok: false, error: "أضف صنفاً واحداً على الأقل بالكمية المناسبة." };
  }
  if (input.employee.person_type === "general" && !input.person_name.trim()) {
    return { ok: false, error: "للسجل العام اكتب اسم الزائر الفعلي." };
  }

  order.employee_id = Number(input.employee.id) || null;
  order.employee_code = input.employee.employee_code;
  order.employee_name = input.employee.name;
  order.person_name = input.person_name.trim();
  order.service_date = input.service_date || todayIso();
  order.notes = input.notes.trim();
  order.items = items;
  order.subtotal = itemsSubtotal(items);
  order.warnings = undefined;

  const payload = {
    employee_id: order.employee_id,
    employee_code: order.employee_code,
    person_name: order.person_name,
    service_date: order.service_date,
    notes: order.notes,
    items: Object.values(order.items).map((line) => ({
      service_item_id: Number(line.service_item_id),
      quantity: num(line.quantity),
    })),
  };

  if (!order.server_id) {
    // لم يُنشأ على الخادم بعد: نُحدّث حمولة الإنشاء مباشرة.
    const idx = state.queue.findIndex((q) => q.client_uuid === uuidValue);
    const create = buildCreatePayload(order);
    if (idx >= 0) state.queue[idx] = create;
    else state.queue.push(create);
    order.sync_state = "pending";
  } else {
    state.ops = state.ops.filter((o) => !(o.client_uuid === uuidValue && o.type === "update"));
    state.ops.push({
      id: uuid(),
      type: "update",
      client_uuid: uuidValue,
      order_id: order.server_id,
      payload,
      created_at: nowIso(),
    });
  }

  persistOrders();
  persistQueue();
  persistOps();
  notify();
  void flush();
  return { ok: true, order };
}

export function deleteOrder(uuidValue: string): { ok: boolean; error?: string } {
  const order = getOrder(uuidValue);
  if (!order) return { ok: false, error: "الطلب غير موجود." };
  state.orders = state.orders.filter((o) => o.client_uuid !== uuidValue);
  state.queue = state.queue.filter((q) => q.client_uuid !== uuidValue);
  state.ops = state.ops.filter((o) => o.client_uuid !== uuidValue);
  if (order.server_id) {
    state.ops.push({
      id: uuid(),
      type: "delete",
      client_uuid: uuidValue,
      order_id: order.server_id,
      payload: { reference: order.reference || "" },
      created_at: nowIso(),
    });
  }
  persistOrders();
  persistQueue();
  persistOps();
  notify();
  void flush();
  return { ok: true };
}

/** إلغاء الطلب = رفض مع سبب (قيد حالة قاعدة البيانات يسمح بالرفض فقط). */
export function cancelOrder(
  uuidValue: string,
  reason: string,
): { ok: boolean; error?: string } {
  const order = getOrder(uuidValue);
  if (!order) return { ok: false, error: "الطلب غير موجود." };
  if (order.status !== "pending") return { ok: false, error: "هذا الطلب تمت مراجعته مسبقاً." };
  const text = reason.trim() || "أُلغي من تطبيق الجوال.";

  order.status = "rejected";
  order.rejection_reason = text;
  order.confirmed_at = nowIso();

  if (!order.server_id) {
    // لم يُرسل بعد: يكفي إيقافه محلياً وحذفه من طابور الإنشاء.
    state.queue = state.queue.filter((q) => q.client_uuid !== uuidValue);
    state.ops = state.ops.filter((o) => o.client_uuid !== uuidValue);
  } else {
    state.ops = state.ops.filter(
      (o) => !(o.client_uuid === uuidValue && (o.type === "confirm" || o.type === "deliver")),
    );
    state.ops.push({
      id: uuid(),
      type: "confirm",
      client_uuid: uuidValue,
      order_id: order.server_id,
      payload: { decision: "rejected", rejection_reason: text },
      created_at: nowIso(),
    });
  }
  persistOrders();
  persistQueue();
  persistOps();
  notify();
  void flush();
  return { ok: true };
}

export function orderRemaining(order: LocalOrder): number {
  return Object.values(order.items).reduce(
    (sum, line) => sum + Math.max(num(line.quantity) - num(line.received_quantity), 0),
    0,
  );
}

export function hasReceipts(order: LocalOrder): boolean {
  return Object.values(order.items).some((line) => num(line.received_quantity) > 0);
}

/** تسليم جزئي لمستلم محدد (نفس الموظف أو عامل آخر بنص حر). */
export async function deliverOrder(
  uuidValue: string,
  pieces: DeliveryPiece[],
  receiver: { kind: "same_employee" | "other"; name?: string },
): Promise<{ ok: boolean; error?: string }> {
  let order = getOrder(uuidValue);
  if (!order) return { ok: false, error: "الطلب غير موجود." };
  if (!order.server_id) {
    return { ok: false, error: "يجب مزامنة الطلب أولاً قبل تسجيل التسليم." };
  }
  if (order.status === "rejected") {
    return { ok: false, error: "لا يمكن تسجيل استلام لطلب ملغى." };
  }
  if (receiver.kind === "other" && !(receiver.name || "").trim()) {
    return { ok: false, error: "اكتب اسم مستلم الأصناف الآخر." };
  }

  // إن كانت معرّفات بنود الخادم غير محمّلة بعد، نجلب الطلب مرة واحدة.
  const needsItems = Object.values(order.items).some((line) => !line.item_id);
  if (needsItems && isOnlineSession()) {
    await fetchOrderDetail(Number(order.server_id));
    order = getOrder(uuidValue) || order;
  }
  if (Object.values(order.items).some((line) => !line.item_id)) {
    return {
      ok: false,
      error: "لم تُحمّل تفاصيل بنود الطلب من الخادم بعد. اتصل بالإنترنت وحدّث الطلب ثم أعد المحاولة.",
    };
  }

  const lineById = new Map<number, OrderLine>();
  for (const line of Object.values(order.items)) {
    if (line.item_id) lineById.set(Number(line.item_id), line);
  }
  const cleanPieces: DeliveryPiece[] = [];
  for (const piece of pieces) {
    const qty = num(piece.quantity);
    if (qty <= 0) continue;
    const line = lineById.get(Number(piece.id));
    if (!line) continue;
    const remaining = Math.max(num(line.quantity) - num(line.received_quantity), 0);
    const take = Math.min(qty, remaining);
    if (take <= 0) continue;
    line.received_quantity = num(line.received_quantity) + take;
    cleanPieces.push({ id: Number(piece.id), quantity: take });
  }
  if (!cleanPieces.length) return { ok: false, error: "أدخل كمية مستلمة أكبر من صفر." };

  const remainingAfter = orderRemaining(order);
  if (remainingAfter <= 0) {
    order.fulfillment_status = "delivered";
    order.delivered_at = order.delivered_at || nowIso();
  }
  order.receiver_kind = receiver.kind;
  order.receiver_name =
    receiver.kind === "other"
      ? (receiver.name || "").trim()
      : order.person_name || order.employee_name || "";
  order.received_at = nowIso();

  state.ops.push({
    id: uuid(),
    type: "deliver",
    client_uuid: uuidValue,
    order_id: order.server_id,
    payload: {
      pieces: cleanPieces,
      receiver_kind: receiver.kind,
      receiver_name: order.receiver_name,
    },
    created_at: nowIso(),
  });
  persistOrders();
  persistOps();
  notify();
  void flush();
  return { ok: true };
}

/** اعتماد طلب تم تسليمه (أو رفضه) — يُنفَّذ محلياً ويُزامن لاحقاً. */
export function confirmOrder(
  uuidValue: string,
  decision: "approved" | "rejected",
  reason = "",
): { ok: boolean; error?: string } {
  const order = getOrder(uuidValue);
  if (!order) return { ok: false, error: "الطلب غير موجود." };
  if (!order.server_id) return { ok: false, error: "يجب مزامنة الطلب أولاً." };
  if (order.status !== "pending") return { ok: false, error: "هذا الطلب تمت مراجعته مسبقاً." };
  if (decision === "approved" && order.fulfillment_status !== "delivered") {
    return { ok: false, error: "لا يمكن الاعتماد قبل تسليم جميع القطع." };
  }
  if (decision === "rejected" && !reason.trim()) {
    return { ok: false, error: "اكتب سبب الإلغاء / الرفض." };
  }
  order.status = decision;
  order.confirmed_at = nowIso();
  if (decision === "rejected") order.rejection_reason = reason.trim();
  state.ops = state.ops.filter(
    (o) => !(o.client_uuid === uuidValue && o.type === "confirm"),
  );
  state.ops.push({
    id: uuid(),
    type: "confirm",
    client_uuid: uuidValue,
    order_id: order.server_id,
    payload: { decision, rejection_reason: decision === "rejected" ? reason.trim() : "" },
    created_at: nowIso(),
  });
  persistOrders();
  persistOps();
  notify();
  void flush();
  return { ok: true };
}

/* ---------------------------------------------------------------------------
   المزامنة
   --------------------------------------------------------------------------- */

export function pendingCount(): number {
  return state.queue.length + state.ops.length;
}

export function pendingActionCount(): number {
  return state.ops.length;
}

export function pendingCreateCount(): number {
  return state.queue.length;
}

export function setLastError(message: string): void {
  state.lastError = message;
  notify();
}

async function flushCreates(): Promise<{ pushed: number; failed: number }> {
  if (!state.queue.length) return { pushed: 0, failed: 0 };
  const batch = state.queue.slice(0, 50);
  const res = await apiRequest<{
    ok: boolean;
    results: Array<{
      client_uuid: string;
      status: string;
      order_id?: number;
      reference?: string;
      subtotal?: number;
      warnings?: string[];
      error?: string;
    }>;
  }>("/api/sync/orders", { method: "POST", body: { orders: batch } });

  if (!res.ok || !res.data?.results) {
    state.lastError = res.error || `فشلت مزامنة الطلبات (${res.status}).`;
    return { pushed: 0, failed: batch.length };
  }

  let pushed = 0;
  let failed = 0;
  for (const result of res.data.results) {
    const order = getOrder(result.client_uuid);
    if (!order) continue;
    if (result.status === "created" || result.status === "duplicate") {
      order.server_id = result.order_id || null;
      order.reference = result.reference || order.reference;
      order.sync_state = result.status === "created" ? "created" : "duplicate";
      order.source = "local";
      order.warnings = result.warnings || [];
      state.queue = state.queue.filter((q) => q.client_uuid !== result.client_uuid);
      pushed += 1;
    } else {
      order.sync_state = "error";
      order.last_error = result.error || "تعذر حفظ الطلب على الخادم.";
      failed += 1;
    }
  }
  persistOrders();
  persistQueue();
  notify();
  return { pushed, failed };
}

async function deleteOnServer(orderId: number): Promise<boolean> {
  const res = await apiRequest(`/api/orders/${orderId}`, { method: "DELETE" });
  return res.ok || res.status === 404;
}

/** بديل احتياطي للخوادم القديمة التي لا تدعم تعديل الطلب: حذف ثم إعادة إنشاء بنفس المعرّف. */
async function updateFallback(
  order: LocalOrder,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const deleted = await deleteOnServer(Number(order.server_id));
  if (!deleted) return { ok: false, error: "تعذر تجهيز الطلب للتعديل على الخادم." };
  order.server_id = null;
  const res = await apiRequest<{
    ok: boolean;
    status: string;
    order_id?: number;
    reference?: string;
    subtotal?: number;
    error?: string;
  }>("/api/orders", {
    method: "POST",
    body: { ...payload, client_uuid: order.client_uuid },
  });
  if (res.ok && res.data && (res.data.status === "created" || res.data.status === "duplicate")) {
    order.server_id = res.data.order_id || null;
    order.reference = res.data.reference || order.reference;
    order.sync_state = "created";
    persistOrders();
    return { ok: true };
  }
  return { ok: false, error: (res.data as { error?: string })?.error || "تعذر حفظ التعديل." };
}

async function flushOps(): Promise<{ applied: number; failed: number }> {
  if (!state.ops.length) return { applied: 0, failed: 0 };
  let applied = 0;
  let failed = 0;
  const keep: Operation[] = [];

  for (const op of state.ops) {
    const order = getOrder(op.client_uuid);
    const orderId = Number(op.order_id || order?.server_id || 0);

    // تعديل/حذف طلب لم يُنشأ على الخادم بعد.
    if (!orderId) {
      if (op.type === "update" && order) {
        const idx = state.queue.findIndex((q) => q.client_uuid === op.client_uuid);
        const create = buildCreatePayload(order);
        if (idx >= 0) state.queue[idx] = create;
        else state.queue.push(create);
        continue;
      }
      if (op.type === "delete") continue;
      op.attempts = (op.attempts || 0) + 1;
      op.last_error = "بانتظار مزامنة إنشاء الطلب.";
      keep.push(op);
      failed += 1;
      continue;
    }

    try {
      if (op.type === "delete") {
        const ok = await deleteOnServer(orderId);
        if (ok) {
          state.orders = state.orders.filter((o) => o.client_uuid !== op.client_uuid);
          persistOrders();
          applied += 1;
        } else {
          op.attempts = (op.attempts || 0) + 1;
          op.last_error = "تعذر حذف الطلب على الخادم.";
          keep.push(op);
          failed += 1;
        }
        continue;
      }

      if (op.type === "update") {
        let res = await apiRequest<{ ok: boolean; order?: ServerOrder; error?: string }>(
          `/api/orders/${orderId}`,
          { method: "PUT", body: op.payload },
        );
        if (res.status === 404 || res.status === 405) {
          if (order) {
            const fallback = await updateFallback(order, op.payload);
            if (fallback.ok) {
              if (order) {
                order.subtotal = itemsSubtotal(order.items);
                order.sync_state = "created";
              }
              persistOrders();
              applied += 1;
              continue;
            }
            res = {
              status: 0,
              ok: false,
              data: { ok: false, error: fallback.error },
              code: "fallback_failed",
            } as typeof res;
          }
        }
        if (res.ok) {
          if (res.data?.order && order) {
            const fresh = fromServerOrder(res.data.order);
            order.items = fresh.items;
            order.subtotal = fresh.subtotal;
            order.reference = fresh.reference || order.reference;
            order.status = fresh.status;
            order.fulfillment_status = fresh.fulfillment_status;
          } else if (order) {
            order.subtotal = itemsSubtotal(order.items);
          }
          persistOrders();
          applied += 1;
        } else {
          op.attempts = (op.attempts || 0) + 1;
          op.last_error =
            (res.data as { error?: string } | null)?.error ||
            res.error ||
            `تعذر حفظ التعديل (${res.status}).`;
          keep.push(op);
          failed += 1;
        }
        continue;
      }

      if (op.type === "deliver") {
        const res = await apiRequest<{
          ok: boolean;
          items?: Array<{ id: number; quantity: number; received_quantity: number }>;
          fulfillment_status?: string;
          remaining?: number;
          message?: string;
          error?: string;
        }>(`/api/orders/${orderId}/deliver`, { method: "POST", body: op.payload });
        if (res.ok) {
          if (order && Array.isArray(res.data?.items)) {
            const byId = new Map<number, OrderLine>();
            for (const line of Object.values(order.items)) {
              if (line.item_id) byId.set(Number(line.item_id), line);
            }
            for (const item of res.data.items) {
              const line = byId.get(Number(item.id));
              if (line) line.received_quantity = num(item.received_quantity);
            }
            order.fulfillment_status = res.data.fulfillment_status || "delivered";
            if (num(res.data.remaining) <= 0) {
              order.fulfillment_status = "delivered";
              order.delivered_at = order.delivered_at || nowIso();
            }
            persistOrders();
          }
          applied += 1;
        } else {
          op.attempts = (op.attempts || 0) + 1;
          op.last_error =
            (res.data as { error?: string } | null)?.error ||
            res.error ||
            `تعذر تسجيل التسليم (${res.status}).`;
          keep.push(op);
          failed += 1;
        }
        continue;
      }

      // confirm
      const res = await apiRequest<{ ok: boolean; error?: string }>(
        `/api/orders/${orderId}/confirm`,
        { method: "POST", body: op.payload },
      );
      if (res.ok) {
        if (order) {
          order.status = String(op.payload.decision || "approved");
          order.confirmed_at = nowIso();
          if (op.payload.rejection_reason) {
            order.rejection_reason = String(op.payload.rejection_reason);
          }
          persistOrders();
        }
        applied += 1;
      } else {
        op.attempts = (op.attempts || 0) + 1;
        op.last_error =
          (res.data as { error?: string } | null)?.error ||
          res.error ||
          `تعذر تنفيذ الإجراء (${res.status}).`;
        keep.push(op);
        failed += 1;
      }
    } catch (err) {
      op.attempts = (op.attempts || 0) + 1;
      op.last_error = err instanceof Error ? err.message : "خطأ غير متوقع.";
      keep.push(op);
      failed += 1;
    }
  }

  state.ops = keep;
  persistOps();
  return { applied, failed };
}

/** مزامنة شاملة: إنشاء الطلبات ← تنفيذ الإجراءات ← تحديث السجلات والنسخة المحلية. */
export async function syncEverything(): Promise<{
  snapshot: { ok: boolean; error?: string };
  orders: { pushed: number; failed: number };
  actions: { applied: number; failed: number };
  history: { ok: boolean; count?: number; error?: string };
}> {
  const empty = {
    snapshot: { ok: false, error: "لا يوجد اتصال بالإنترنت." },
    orders: { pushed: 0, failed: 0 },
    actions: { applied: 0, failed: 0 },
    history: { ok: false, error: "لا يوجد اتصال بالإنترنت." },
  };
  if (!isOnlineSession()) {
    return {
      ...empty,
      snapshot: { ok: false, error: "سجّل الدخول مرة واحدة على الأقل للمزامنة." },
    };
  }
  if (state.syncing) {
    return { ...empty, snapshot: { ok: true }, orders: { pushed: 0, failed: 0 }, actions: { applied: 0, failed: 0 } };
  }

  state.syncing = true;
  state.lastError = "";
  notify();
  let result: Awaited<ReturnType<typeof syncEverything>>;
  try {
    await syncServices();
    const creates = await flushCreates();
    const actions = await flushOps();
    const history = await fetchServerOrders({ limit: 500 });
    const snapshot = await refreshSnapshot();
    result = {
      snapshot,
      orders: creates,
      actions,
      history,
    };
    if (!snapshot.ok && snapshot.error) state.lastError = snapshot.error;
    else if (history.error) state.lastError = history.error;
  } finally {
    state.syncing = false;
    state.lastSync = nowIso();
    save(KEY_LAST_SYNC, state.lastSync);
    notify();
  }
  return result;
}

/** مزامنة سريعة بعد أي إجراء محلي. */
export async function flush(): Promise<void> {
  if (!isOnline() || !isOnlineSession() || state.syncing) return;
  try {
    state.syncing = true;
    notify();
    await syncServices();
    const creates = await flushCreates();
    await flushOps();
    // تحديث السجلات بعد الإنشاء لتحميل معرّفات البنود اللازمة للتسليم الجزئي.
    if (creates.pushed > 0) await fetchServerOrders({ limit: 100 });
  } finally {
    state.syncing = false;
    state.lastSync = nowIso();
    save(KEY_LAST_SYNC, state.lastSync);
    notify();
  }
}

/** مزامنة تلقائية دورية — تُستدعى من مزوّد التطبيق. */
export function autoSync(): void {
  if (!isOnline() || !isOnlineSession()) return;
  if (state.syncing) return;
  void syncEverything();
}

export function userRole(): UserRole {
  return (state.session?.role as UserRole) || (getIdentity()?.role as UserRole) || "";
}
