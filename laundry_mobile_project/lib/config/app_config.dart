/// إعدادات تطبيق نظام مغسلة الشركة (الجوال).
///
/// التطبيق يتصل بنفس خادم Flask الذي يقدّم تطبيق الويب (`app.py` + `mobile_api.py`)،
/// لذلك البيانات وقواعد الاعتماد واحدة ولا يوجد خادم منفصل للجوال.
///
/// - عدّل [defaultBaseUrl] ليشير إلى عنوان النشر الفعلي على Render.
///   flutter build apk --release --dart-define=LAUNDRY_API_BASE_URL=https://alghith-laundry.onrender.com
/// - يمكن تغيير العنوان داخل التطبيق من شاشة الدخول دون إعادة البناء، ويُحفظ على الجهاز.
class AppConfig {
  AppConfig._();

  static const String appName = 'نظام مغسلة الشركة';

  /// عنوان الخادم الافتراضي (بدون مسار /api لأن المسارات نفسها تبدأ بـ /api).
  static const String defaultBaseUrl = String.fromEnvironment(
    'LAUNDRY_API_BASE_URL',
    defaultValue: 'https://alghith-laundry.onrender.com',
  );

  /// مفتاح تخزين عنوان الخادم المخصّص على الجهاز.
  static const String baseUrlPrefsKey = 'laundry_api_base_url';

  /// مفتاح تخزين رمز الدخول والبيانات المحلية.
  static const String sessionPrefsKey = 'laundry_session_v1';
  static const String cachePrefsKey = 'laundry_cache_v1';

  /// مهلة الاتصال بالخادم.
  ///
  /// الخطة المجانية على Render تُنيم الخادم عند عدم الاستخدام، ويستغرق استيقاظه
  /// حتى ~50 ثانية، لذا نمنح مهلة كافية لأول طلب.
  static const Duration apiTimeout = Duration(seconds: 90);

  /// المدة بين محاولات المزامنة التلقائية.
  static const Duration syncInterval = Duration(seconds: 45);
}
