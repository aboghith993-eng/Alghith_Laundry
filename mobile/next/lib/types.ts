/* أنواع البيانات المشتركة لتطبيق المغسلة */

export type UserRole = "admin" | "contractor" | "supervisor" | "super" | string;

export type SessionUser = {
  id?: number | string;
  username: string;
  full_name?: string;
  name?: string;
  role?: UserRole;
  company_id?: number | null;
  company?: string | null;
};

export type Tokens = {
  access_token: string;
  refresh_token?: string;
};

export type Employee = {
  id: number;
  employee_code: string;
  name: string;
  company?: string;
  department?: string;
  job_title?: string;
  person_type?: string;
  service_type?: string;
  shift_system?: string;
  shift_description?: string;
  work_days?: number;
  rest_days?: number;
  cycle_start?: string;
  cycle_anchor?: string;
  cycle_day?: number;
  status_label?: string;
  departure_time?: string;
  housing_location?: string;
  gender?: string;
  transport_class?: string;
  active?: boolean;
};

export type ServiceItem = {
  id: number;
  code?: string;
  name: string;
  unit: string;
  rate: number;
  active?: boolean;
};

export type ServerOrderItem = {
  id: number;
  order_id?: number;
  service_item_id: number;
  item_name: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  line_total?: number;
  received_quantity?: number;
};

export type ServerOrder = {
  id: number;
  reference?: string;
  client_uuid?: string;
  employee_id?: number;
  employee_code?: string;
  employee_name?: string;
  person_name?: string;
  service_date?: string;
  notes?: string;
  status?: string;
  fulfillment_status?: string;
  subtotal?: number;
  delivered_at?: string;
  confirmed_at?: string;
  rejection_reason?: string;
  received_at?: string;
  receiver_kind?: string;
  receiver_name?: string;
  creator_name?: string;
  confirmer_name?: string;
  deliverer_name?: string;
  created_at?: string;
  items?: ServerOrderItem[];
  company?: string;
  department?: string;
  service_type?: string;
};

export type Snapshot = {
  ok?: boolean;
  version?: number;
  built_at?: string;
  employees: Employee[];
  service_items: ServiceItem[];
  users?: Array<{ id: number; username: string; full_name?: string; role?: string }>;
  orders?: ServerOrder[];
  settings?: Record<string, string>;
  company?: Record<string, unknown> | null;
  counts?: Record<string, number>;
};

/** بند طلب محفوظ محلياً — يبقى متوافقاً مع الصيغة القديمة (كائن مفهرس بمعرّف الصنف). */
export type OrderLine = {
  item_id?: number | null;
  service_item_id?: number;
  item_name: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  line_total?: number;
  received_quantity?: number;
};

export type SyncState = "pending" | "created" | "duplicate" | "error" | "synced";

export type LocalOrder = {
  client_uuid: string;
  server_id?: number | null;
  reference?: string | null;
  employee_id?: number | null;
  employee_code: string;
  employee_name?: string;
  person_name?: string;
  service_date: string;
  notes?: string;
  items: Record<string, OrderLine>;
  subtotal?: number;
  status?: "pending" | "approved" | "rejected" | string;
  fulfillment_status?: "received" | "delivered" | string;
  delivered_at?: string;
  confirmed_at?: string;
  received_at?: string;
  rejection_reason?: string;
  receiver_kind?: string;
  receiver_name?: string;
  creator_name?: string;
  confirmer_name?: string;
  deliverer_name?: string;
  created_at?: string;
  sync_state?: SyncState;
  source?: "local" | "server";
  warnings?: string[];
  last_error?: string;
};

export type CreatePayload = {
  client_uuid: string;
  employee_id: number | null;
  employee_code: string;
  person_name: string;
  service_date: string;
  notes: string;
  items: Array<{ service_item_id: number; quantity: number }>;
  created_at?: string;
};

export type UpdatePayload = {
  employee_id: number | null;
  employee_code?: string;
  person_name: string;
  service_date: string;
  notes: string;
  items: Array<{ service_item_id: number; quantity: number }>;
};

export type DeliveryPiece = { id: number; quantity: number };

export type OperationType = "update" | "delete" | "deliver" | "confirm";

export type Operation = {
  id: string;
  type: OperationType;
  client_uuid: string;
  order_id?: number | null;
  payload: Record<string, unknown>;
  created_at: string;
  attempts?: number;
  last_error?: string;
};

/** عملية خدمة/سعر — تعمل دون اتصال وتُزامن تلقائياً. */
export type ServicePayload = {
  code?: string;
  name: string;
  unit: string;
  rate: number;
  active?: boolean;
};

export type ServiceOp = {
  id: string;
  type: "upsert" | "delete";
  temp_id?: number | null;
  service_id?: number | null;
  payload: ServicePayload;
  created_at: string;
  attempts?: number;
  last_error?: string;
};

export type AppConfig = {
  server_url?: string;
};

export type SyncInfo = {
  ok: boolean;
  pushed?: number;
  applied?: number;
  failed?: number;
  error?: string;
};

export type OrderInput = {
  employee: Employee;
  person_name: string;
  service_date: string;
  notes: string;
  items: Record<string, OrderLine>;
};

export const ROLE_LABELS: Record<string, string> = {
  admin: "مدير النظام",
  contractor: "متعهد المغسلة",
  supervisor: "مشرف السكن",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "بانتظار التأكيد",
  approved: "معتمد",
  rejected: "ملغى / مرفوض",
};
