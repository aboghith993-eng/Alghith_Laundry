-- نظام مغسلة الشركة: PostgreSQL schema for Supabase.
-- التطبيق ينشئ الجداول تلقائياً عند أول تشغيل على Render، لذلك تنفيذ هذا الملف اختياري.

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','contractor','supervisor')),
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    employee_code TEXT NOT NULL UNIQUE,
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
    transport_class TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS service_items (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'قطعة',
    rate DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (rate >= 0),
    active SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS laundry_orders (
    id BIGSERIAL PRIMARY KEY,
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
    rejection_reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS laundry_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES laundry_orders(id) ON DELETE CASCADE,
    service_item_id BIGINT REFERENCES service_items(id),
    item_name TEXT NOT NULL,
    unit TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    unit_price DOUBLE PRECISION NOT NULL CHECK (unit_price >= 0),
    line_total DOUBLE PRECISION NOT NULL CHECK (line_total >= 0)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON laundry_orders(service_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON laundry_orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON laundry_order_items(order_id);

INSERT INTO settings(key,value) VALUES ('currency','ريال يمني') ON CONFLICT(key) DO NOTHING;
INSERT INTO settings(key,value) VALUES ('company_name','مغسلة الشركة') ON CONFLICT(key) DO NOTHING;
INSERT INTO employees(employee_code,name,company,department,person_type,notes)
VALUES ('GEN-001','موظف عام','زوار وضيوف من خارج الشركة','عام','general','سجل عام؛ اكتب اسم الزائر الفعلي عند إنشاء طلب المغسلة')
ON CONFLICT(employee_code) DO NOTHING;
INSERT INTO service_items(code,name,unit,rate) VALUES
('WASH_CLOTHES','غسل ملابس الموظفين','كيلوجرام',0),
('IRON_CLOTHES','كي الملابس','قطعة',0),
('WASH_IRON','غسل وكي الملابس','قطعة',0),
('BED_SHEET','غسل ملاية سرير','قطعة',0),
('PILLOW_CASE','غسل لباس مخدة','قطعة',0),
('BLANKET','غسل بطانية','قطعة',0),
('OTHER','خدمة أخرى','قطعة',0)
ON CONFLICT(code) DO NOTHING;

-- لا تضف كلمات المرور إلى هذا الملف؛ حساب المدير الأول ينشئه التطبيق بأمان
-- من متغير INITIAL_ADMIN_PASSWORD الموجود في إعدادات Render.
