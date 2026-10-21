from app import app
from mobile_api import register as register_mobile_api

# تسجيل مسارات API الخاصة بتطبيق الجوال فقط
register_mobile_api(app)

# لا يتم تسجيل أي صفحات ويب هنا، لكن مسارات /api/* جاهزة للعمل
