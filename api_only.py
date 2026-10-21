from app import app
from mobile_api import register as register_mobile_api

# تسجيل مسارات API الخاصة بتطبيق الجوال فقط (تجنب التسجيل المكرر)
try:
    register_mobile_api(app)
except ValueError:
    # تم التسجيل مسبقاً داخل app.py
    pass

