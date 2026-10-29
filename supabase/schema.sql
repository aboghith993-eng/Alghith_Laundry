-- نظام مغسلة الشركة: مخطط PostgreSQL لـ Supabase.
-- التطبيق ينشئ الجداول والترحيلات تلقائياً عند أول تشغيل على Render،
-- لذلك تنفيذ هذا الملف اختياري ويستخدم للتوثيق أو الإنشاء اليدوي.
-- حساب المدير الأول ينشئه التطبيق من متغير INITIAL_ADMIN_PASSWORD.

CREATE TABLE IF NOT EXISTS companies (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('super_admin','admin','contractor','supervisor')),
    active SMALLINT NOT NULL DEFAULT 1,
    company_id BIGINT REFERENCES companies(id),
    system_admin SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    employee_code TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    person_type TEXT NOT NULL DEFAULT 'company' CHECK (person_type IN ('company','general')),
    active SMALLINT NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    service_type TEXT NOT NULL DEFAULT '',
    shift_system TEXT NOT NULL DEFAULT '',
    shift_description TEXT NOT NULL DEFAULT '',
    work_days INTEGER NOT NULL DEFAULT 0,
    rest_days INTEGER NOT NULL DEFAULT 0,
    cycle_start TEXT NOT NULL DEFAULT '',
    cycle_anchor TEXT NOT NULL DEFAULT '',
    cycle_day INTEGER NOT NULL DEFAULT 0,
    status_label TEXT NOT NULL DEFAULT '',
    departure_time TEXT NOT NULL DEFAULT '',
    housing_location TEXT NOT NULL DEFAULT '',
    job_title TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    transport_class TEXT NOT NULL DEFAULT '',
    UNIQUE (company_id, employee_code)
);
CREATE TABLE IF NOT EXISTS service_items (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'قطعة',
    rate DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (rate >= 0),
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (company_id, code)
);
CREATE TABLE IF NOT EXISTS laundry_orders (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    reference TEXT UNIQUE,
    employee_id BIGINT NOT NULL REFERENCES employees(id),
    person_name TEXT NOT NULL DEFAULT '',
    service_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    fulfillment_status TEXT NOT NULL DEFAULT 'received' CHECK (fulfillment_status IN ('received','delivered')),
    delivered_at TIMESTAMPTZ,
    delivered_by BIGINT REFERENCES users(id),
    subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_by BIGINT NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    confirmed_by BIGINT REFERENCES users(id),
    confirmed_at TIMESTAMPTZ,
    rejection_reason TEXT NOT NULL DEFAULT '',
    client_uuid TEXT,
    receiver_kind TEXT NOT NULL DEFAULT '' CHECK (receiver_kind IN ('','same_employee','other')),
    receiver_name TEXT NOT NULL DEFAULT '',
    received_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS laundry_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    service_item_id BIGINT REFERENCES service_items(id),
    item_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_price DOUBLE PRECISION NOT NULL CHECK (unit_price >= 0),
    line_total DOUBLE PRECISION NOT NULL CHECK (line_total >= 0),
    received_quantity DOUBLE PRECISION
);
CREATE TABLE IF NOT EXISTS laundry_receipts (
    id BIGSERIAL PRIMARY KEY,
    company_id BIGINT NOT NULL REFERENCES companies(id),
    order_id BIGINT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    receiver_kind TEXT NOT NULL DEFAULT 'same_employee' CHECK (receiver_kind IN ('same_employee','other')),
    receiver_name TEXT NOT NULL DEFAULT '',
    received_by BIGINT REFERENCES users(id),
    received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS laundry_receipt_items (
    id BIGSERIAL PRIMARY KEY,
    receipt_id BIGINT NOT NULL REFERENCES laundry_receipts(id) ON DELETE CASCADE,
    order_item_id BIGINT NOT NULL REFERENCES laundry_order_items(id) ON DELETE CASCADE,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0)
);
CREATE TABLE IF NOT EXISTS settings (
    company_id BIGINT NOT NULL REFERENCES companies(id),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (company_id, key)
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON laundry_orders(company_id, service_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON laundry_orders(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_client_uuid ON laundry_orders(company_id, client_uuid) WHERE client_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_order ON laundry_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_receipts_order ON laundry_receipts(company_id, order_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON laundry_receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

-- ملاحظة: البيانات الأولية (الشركة الافتراضية، الخدمات، الإعدادات، حساب المدير)
-- يضيفها التطبيق تلقائياً عند أول تشغيل لكل شركة.
