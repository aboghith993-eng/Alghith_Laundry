# نظام مغسلة الشركة — مشروع جاهز للتشغيل والنشر

واجهة عربية RTL مناسبة للجوال، قابلة للتثبيت على هاتف Android من متصفح Chrome كـ **تطبيق ويب تقدمي (PWA)**، وتستخدم PostgreSQL على Supabase عند النشر. الخادم يعمل على Render والكود محفوظ في GitHub.

> **مهم:** ملف المشروع جاهز للرفع والنشر، لكنه لم يُنشر داخل حسابات GitHub أو Render أو Supabase الخاصة بك؛ لا توجد في المشروع بيانات دخول إلى هذه الحسابات. اتبع خطوات النشر أدناه لربطها.

## 1. وظائف النظام

- حسابات وصلاحيات منفصلة: مدير النظام، متعهد المغسلة، مشرف السكن.
- قاعدة بيانات الموظفين: الرقم الوظيفي، الاسم، الشركة، القسم، الهاتف، حالة السجل، وملاحظات. يمكن إدخال البيانات يدوياً أو استيراد قائمة موظفين من ملف CSV، أو استيراد **كشف الموظفين** الرسمي من ملف Excel (انظر القسم 8).
- **بيانات الدوام ونوع الخدمة:** لكل موظف نوع خدمة (سكن / نقل / نقل-سكن / أخرى) ونظام دوام (عدد أيام العمل والراحة). يحسب النظام يوم الدورة وحالة الدوام (دوام/راحة) لأي تاريخ، ويعرض تنبيهاً واضحاً عند تسجيل طلب لموظف في مرحلة راحة أو نوع خدمته ليس «سكن» (التنبيه لا يمنع إنشاء الطلب ولا يمنع اعتماده).
- سجل **«موظف عام» GEN-001** للضيوف والزوار من خارج الشركة، مع إلزام إدخال اسم الشخص الفعلي عند تسجيل الطلب.
- إدخال طلب واحد يحتوي عدة خدمات: غسل الملابس، كيها، غسل وكي، الملايات، أغطية/لباس المخدات، البطانيات وأي خدمة أخرى.
- الأسعار قابلة للتعديل وإضافة أصناف ووحدات إضافية. يحفظ كل طلب سعر الوحدة وقت تسجيله، لذلك لا تتغير قيمة الطلبات السابقة عند تحديث الأسعار.
- يسجل المتعهد الطلب عند استلام القطع، ثم يسجل «تأكيد تسليم القطع النظيفة» بعد الغسيل/الكي وإعادتها للموظف. يظهر الطلب لمشرف السكن، ولا يسمح النظام باعتماد المستحقات قبل تسجيل التسليم. يستطيع المشرف اعتماد الطلب أو رفضه مع سبب مكتوب. يحتفظ الطلب باسم مدخله ومسلّمه والتواريخ والرقم المرجعي.
- كشف طباعة فيه خانة توقيع الموظف، وتوقيع متعهد المغسلة واعتماد مشرف السكن. التوقيع المقصود ورقي على الكشف؛ النظام لا يدّعي وجود توقيع إلكتروني.
- تقارير حسب فترة من/إلى، والحالة، والموظف/رقم الطلب؛ إجمالي المعتمد والمعلق والمرفوض؛ طباعة A4 أفقية وتصدير CSV لفتح التقرير في Excel.
- **ملخص كميات الغسيل** في صفحة التقارير: جدول لكل موظف يوضح عدد القطع المغسولة من كل صنف (لباس المخدات، البطانيات، ملايات السرير، وغيرها) وإجمالي القطع، وجدول ثانٍ يجمّع نفس الكميات **حسب نوع الخدمة** (سكن، نقل، نقل-سكن، أخرى) خلال الفترة المحددة. يظهر الملخص لمشرف السكن وللمدير، ويُدرج أيضاً في ملف CSV المُصدَّر.
- قاعدة بيانات سحابية مشتركة بين المتعهد ومشرف السكن عند فتح نفس رابط Render؛ إدخال المتعهد يظهر للمشرف عند تحديث الصفحة.

## 2. تشغيل تجريبي محلي على Windows

1. فك ضغط الملف في مسار بسيط مثل `D:\التطبيقات\laundry_management_android`.
2. ثبّت Python 3.12 أو إصداراً متوافقاً وحدّث الاتصال بالإنترنت.
3. انقر نقراً مزدوجاً على `run_windows.bat`، أو افتح PowerShell داخل المجلد ونفّذ:

```powershell
.\run_windows.bat
```

4. يفتح النظام على `http://127.0.0.1:5505`.

حسابات التجربة المحلية الأولى:

| الدور | اسم الدخول | كلمة المرور الأولية |
|---|---|---|
| مدير النظام | `admin` | `Admin@12345` |
| متعهد المغسلة | `contractor` | `Laundry@12345` |
| مشرف السكن | `supervisor` | `Housing@12345` |

هذه الحسابات التجريبية **للتشغيل المحلي فقط**. غيّر كلمات المرور بعد أول دخول. البيانات المحلية في `instance/laundry.db` ولا تتم مزامنتها مع Supabase.

## 3. إنشاء قاعدة البيانات في Supabase

1. افتح [Supabase](https://supabase.com/) وأنشئ مشروعاً جديداً، واحتفظ بكلمة مرور قاعدة البيانات في مكان آمن.
2. من لوحة المشروع اضغط **Connect** ثم افتح خيارات اتصال PostgreSQL.
3. انسخ رابط **Session pooler** إن كان متاحاً، ويفضّل استخدام اتصال مجمّع يعمل عبر IPv4 لأن الخادم المستضاف قد لا يستطيع الوصول إلى الاتصال المباشر المعتمد على IPv6. غالباً يكون منفذ Session pooler `5432`؛ استخدم المضيف واسم المستخدم والمنفذ كما يعرضها مشروعك ولا تخمّنها.
4. ضع رابط الاتصال كاملاً في متغير Render باسم `DATABASE_URL`، واستبدل جزء كلمة المرور بكلمة مرور قاعدة البيانات الفعلية. إذا احتوت كلمة المرور على رموز خاصة مثل `@` أو `#` أو `/` فيجب ترميزها URL-encoding داخل الرابط.
5. **لا تضع `DATABASE_URL` داخل ملفات الواجهة أو في GitHub أو على هاتف المستخدم.** يوضع في متغيرات البيئة على Render فقط.

يقوم التطبيق بإنشاء الجداول والفهارس والخدمات الأولية وسجل «موظف عام» تلقائياً عند بدء التشغيل. ملف `supabase/schema.sql` متوفر للمراجعة أو الإنشاء اليدوي، لكنه ليس مطلوباً إذا سمحت قاعدة البيانات للتطبيق بإنشاء الجداول.

## 4. رفع المشروع إلى GitHub

### الطريقة المباشرة من الموقع

1. افتح [GitHub](https://github.com/) وأنشئ مستودعاً جديداً خاصاً (Private) باسم `alghith-laundry-system` لأن النظام مخصص لبيانات موظفين.
2. لا ترفع أي ملف `.env` يحتوي أسراراً. المشروع يحتوي `.gitignore` يمنع ملفات الأسرار وقاعدة البيانات المحلية.
3. من صفحة المستودع استخدم **Add file → Upload files** وارفع محتويات المجلد بعد فك الضغط (ارفع الملفات والمجلدات نفسها، وليس ملف ZIP فقط)، ثم اضغط **Commit changes**.

### أو عبر Git من PowerShell

افتح PowerShell داخل مجلد المشروع، واستبدل رابط المستودع بالرابط الذي أنشأته:

```powershell
git init
git add .
git commit -m "Initial laundry management system"
git branch -M main
git remote add origin https://github.com/USERNAME/alghith-laundry-system.git
git push -u origin main
```

إذا كان Git يطلب تسجيل الدخول، أكمل المصادقة بالطريقة التي يعرضها GitHub. لا تضع رمز الوصول الشخصي داخل أوامر محفوظة أو ملفات المشروع.

## 5. إنشاء الخدمة على Render

المشروع يتضمن ملف `render.yaml` لتسهيل النشر:

1. افتح [Render](https://render.com/) واربط حساب GitHub من لوحة Render.
2. اختر **New → Blueprint**، وحدد المستودع الذي رفعت إليه المشروع، ثم ابدأ إنشاء الخدمة.
3. إذا بدأ Render النشر قبل إضافة الأسرار، افتح **Environment** للخدمة وأضف `DATABASE_URL` و`INITIAL_ADMIN_PASSWORD` فوراً ثم أعد النشر. يجب أن تكون هذه القيم موجودة قبل أن يبدأ التطبيق الاتصال بقاعدة البيانات للمرة الأولى. أكمل بقية متغيرات البيئة المطلوبة:

| المتغير | القيمة المطلوبة |
|---|---|
| `DATABASE_URL` | رابط PostgreSQL من Supabase |
| `SECRET_KEY` | قيمة عشوائية طويلة وفريدة للجلسات؛ يمكن إنشاء واحدة من مدير كلمات مرور موثوق |
| `INITIAL_ADMIN_USERNAME` | `admin` أو اسم الدخول الذي تختاره |
| `INITIAL_ADMIN_NAME` | اسم مدير النظام |
| `INITIAL_ADMIN_PASSWORD` | كلمة مرور قوية فريدة بطول 12 حرفاً أو أكثر |

4. أمر البناء المحدد هو `pip install -r requirements.txt`، وأمر التشغيل هو Gunicorn. فحص الصحة على المسار `/health`.
5. عند اكتمال النشر افتح رابط `onrender.com` الذي يعرضه Render، وسجّل الدخول باسم المدير وكلمة المرور التي أدخلتها في `INITIAL_ADMIN_PASSWORD`.
6. افتح **المستخدمون والصلاحيات** وأنشئ حساب المتعهد وحساب مشرف السكن بكلمتي مرور منفصلتين. حسابات التجربة المحلية لا تُنشأ على Supabase.

يمكن أيضاً إنشاء Web Service يدوياً بدلاً من Blueprint باستخدام القيم التالية:

- **Build Command:** `pip install -r requirements.txt`
- **Start Command:** `gunicorn --workers 2 --threads 4 --timeout 120 --bind 0.0.0.0:$PORT app:app`
- **Health Check Path:** `/health`
- أضف متغيرات البيئة المذكورة في الجدول أعلاه.

لا تحتاج إلى قرص دائم في Render لحفظ قاعدة البيانات عند استخدام Supabase PostgreSQL. خدمة Render المجانية قد تدخل وضع السكون بعد عدم الاستخدام؛ أول فتح بعدها قد يتأخر. إذا كانت المغسلة تحتاج استجابة فورية مستمرة، اختر خطة استضافة مناسبة.

## 6. تثبيت النظام على هاتف Android (PWA)

> This section covers the PWA (installable from Chrome). To obtain the native APK, see section 6 "تطبيق الجوال الأصلي (Android APK)".

1. أكمل نشر Render أولاً، وافتح رابط الخدمة الذي يعمل عبر HTTPS من Chrome على الهاتف.
2. سجّل الدخول ثم افتح قائمة Chrome واختر **تثبيت التطبيق** أو **إضافة إلى الشاشة الرئيسية** (قد تختلف التسمية حسب إصدار Chrome والجهاز).
3. سيظهر رمز النظام في الشاشة الرئيسية ويمكن فتحه بواجهة مستقلة.
4. سجّل الدخول بحساب المتعهد على هاتفه، وبحساب المشرف على هاتفه الآخر. كلاهما يعمل على قاعدة البيانات نفسها.

هذا الإصدار **PWA قابل للتثبيت** ولا يلزم Android Studio لبناءه؛ يلزم اتصال بالإنترنت لاستخدام قاعدة البيانات المشتركة. أما النسخة **APK** فتحتاج ذاكرة تخزين محلية وتعمل دون اتصال.

## 6.7 تشغيل واجهة الجوال في المتصفح (للتجربة)

على الكمبيوتر نفس عنوان الخادم يعرض واجهة الجوال:

```
http://127.0.0.1:5505/mobile/
```

نفس الملفات التي تُحزم داخل الـ APK موجودة في `mobile/www/`.

## 6. تطبيق الجوال Flutter (تطبيق أصلي عربي) — يعمل دون اتصال

بالإضافة إلى الـ PWA، يوجد **تطبيق جوال أصلي مبني بـ Flutter** داخل `laundry_mobile_project/`:
واجهة عربية RTL بنفس تصميم الويب، خط IBM Plex Sans Arabic، والعمل دون اتصال مع مزامنة تلقائية.

### 6.0 التشغيل والتثبيت

| الملف | الوصف |
|-------|-------|
| `apk/laundry-mobile-v1.0-release.apk` | نسخة الإصدار (Release) جاهزة للتثبيت والتوزيع |
| `laundry_mobile_project/build/web/` | نسخة Web (تُبنى في `build/web`) |

التثبيت: انقل ملف الـ APK إلى الهاتف وافتحه ← اسمح بـ **"التثبيت من مصادر غير معروفة"**.

> اسم التطبيق: "نظام مغسلة الشركة" · المعرّف: `ye.alghith.laundry_mobile` · الحد الأدنى: Android 7.0.

عند أول تشغيل: يتصل التطبيق بعنوان النشر الافتراضي (`https://alghith-laundry.onrender.com`) مباشرة.
عنوان الخادم يُعدَّل من **إدارة النظام ← إعدادات النظام ← اتصال الخادم**، ولا يظهر في شاشة الدخول
ولا يصل إليه إلا **مدير النظام**.

### 6.0.1 الشاشات

| الشاشة | الوصف | الصلاحية |
|--------|-------|----------|
| المتابعة | مؤشرات الشهر، عدد الطلبات المعلقة، آخر الطلبات | الجميع |
| الطلبات | قائمة وبحث وتصفية بالتاريخ والحالة، تفاصيل الطلب | الجميع |
| طلب جديد | إدخال **رقم الموظف** فيظهر اسمه فوراً من قاعدة البيانات، ثم الخدمات والكميات مع تنبيهات الدوام | مدير، متعهد |
| الموظفون | قاعدة الموظفين وتعديلها وتفعيلها | مدير، مشرف |
| الأسعار | خدمات وأسعار وتفعيلها | مدير |
| التقارير | تجميع حسب الموظف ونوع الخدمة | الجميع |
| المستخدمون | حسابات وصلاحيات: إنشاء، تعديل، حذف، تعطيل، تغيير كلمة المرور | مدير |
| الإعدادات | اسم النظام والعملة، وعنوان الخادم (فيها فقط، للمدير) | مدير |
| الحساب | تغيير كلمة المرور | الجميع |

### 6.0.2 العمل دون اتصال

- تُخزَّن نسخة كاملة من البيانات (الموظفون، الخدمات، الطلبات، الإعدادات) على الجهاز.
- أي طلب يُنشأ دون اتصال أو عند انقطاع الشبكة أثناء الإرسال يُحفظ في **طابور محلي** ويُرفع تلقائياً
  عند عودة الاتصال، مع `client_uuid` يمنع تكرار الطلب.
- المزامنة التلقائية كل 45 ثانية وعند بدء التشغيل وعند عودة الشبكة.

### 6.0.3 البناء والاختبار

```powershell
powershell -ExecutionPolicy Bypass -File .\build_flutter_apk.ps1
```

الخيارات: `-ApiUrl <عنوان الخادم>` · `-SkipTests` · `-WebOnly`.

الاختبارات:

```powershell
cd laundry_mobile_project
flutter analyze
flutter test
dart run tool\integration_test.dart   # اختبار تكامل مع خادم Flask فعلي
```

المتطلبات: Flutter 3.32 (`D:\ali\flutter`) · JDK (`C:\Program Files\Android\Android Studio\jbr`) ·
Android SDK (`%LOCALAPPDATA%\Android\Sdk`) · NDK `27.3.13750724`.

## 6. تطبيق الجوال الأصلي (Android APK) — يعمل دون اتصال

Besides the installable PWA, the project contains a **native Android app built with Capacitor** that works fully offline and syncs automatically when a connection is available.

### 6.1 Install the ready-made APK

The signed installation files are in the `apk/` folder:

| File | Purpose |
|------|---------|
| `apk/laundry-mobile-v1.0-release.apk` | Release version, signed — **use this one for distribution** |
| `apk/laundry-mobile-v1.0-debug.apk` | Debug version for testing and development |

Installation: copy the file to the phone and open it → allow **"Install from unknown sources"**.

> Package: `com.ycs.laundry` · App name: "Laundry" · Minimum Android 7.0 (API 24) · Target API 36.

### 6.2 First run on the phone

1. Open the app and go to **Settings** → enter the server address (the Render URL, e.g. `https://your-app.onrender.com`).
   - Local network addresses work too, e.g. `http://192.168.1.10:5505` (HTTP is used automatically for local addresses).
2. Log in with username and password (the first login requires an internet connection).
3. Go to **Settings** → set a **local PIN** (4 digits or more). From then on the app opens with the PIN, even without a connection.
4. The app downloads the employee list, service items, and prices once — they remain available offline.

### 6.3 What works without an internet connection

- **Creating orders**: search for the employee, enter quantities, save — the order is stored on the phone.
- **Reviewing orders and reports** already downloaded.
- **Delivery and approval** operations: stored in the action queue and sent automatically once a connection returns.
- **Automatic sync**: the app syncs every 45 seconds, on app start, and immediately when the network returns.

### 6.4 Rebuilding the APK

```powershell
powershell -ExecutionPolicy Bypass -File .\build_apk.ps1
```

The script runs the tests, syncs the files with Capacitor, and builds both the debug and release APKs into `apk/`.

Options:

- `-ReleaseOnly` — build the release version only.
- `-SkipTests` — skip the test run.

Required tools (already installed on this machine):

- JDK 21: `C:\Program Files\Android\Android Studio\jbr`
- Android SDK: `%LOCALAPPDATA%\Android\Sdk`
- Gradle 8.13 (via the wrapper) and Capacitor 8 (`mobile/node_modules`)

After modifying any file in `mobile/www/`, run `npx cap sync android` (the build script does this automatically) to copy the changes into the APK.

### 6.5 Mobile API endpoints

The mobile app talks to the Flask server through these endpoints (all in `mobile_api.py`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/mobile/ping` | Connection check |
| POST | `/api/auth/login` | Login → access token (72 hours) + refresh token (60 days) |
| POST | `/api/auth/refresh` | Renew the access token |
| GET | `/api/auth/me` | Current user data |
| GET | `/api/sync/snapshot` | Employees, service items, and settings (one-time download) |
| POST | `/api/sync/orders` | Send queued orders (idempotent via `client_uuid`) |
| GET | `/api/orders` | Order history (supports `from`, `to`, `status`, `q`, `limit`) |
| GET | `/api/orders/<id>` | Order details |
| POST | `/api/orders/<id>/deliver` | Register delivery of clean items (admin, contractor) |
| POST | `/api/orders/<id>/confirm` | Approve or reject (admin, supervisor) |

### 6.6 Security notes

- The local PIN is stored as a SHA-256 hash with a random salt — the plain PIN is never saved.
- The app requires the local PIN on **every launch** once one has been set.
- The release APK is signed with `mobile/android/laundry-release.keystore` (password `Laundry2026`).
  **This file is not uploaded to GitHub on purpose — back it up in a safe place outside the repository.**
  Without it you cannot publish updates to the same app (the system refuses an update signed with a different key).
- Access tokens are stored in the app's `localStorage`; a rooted device could read them.

## 7. التشغيل اليومي

1. في البداية، يدخل مدير النظام إلى **الخدمات والأسعار** ويضع الأسعار المعتمدة لكل خدمة؛ الأسعار الافتراضية صفر حتى لا نفترض أسعار شركتك.
2. عند استلام الملابس المتسخة أو المفروشات من الموظف، يدخل المتعهد إلى **طلبات المغسلة → طلب جديد**، ويبحث عن الموظف بالرقم أو الاسم في الويب، أو يكتب **رقم الموظف** في تطبيق الجوال ليظهر اسمه فوراً، ثم يضيف القطع والكميات.
3. عند الزائر من خارج الشركة: في الجوال اضغط **سجل الزائر العام** ثم اكتب اسم الزائر، وفي الويب اختر السجل **GEN-001 — موظف عام**.
4. بعد إنجاز الغسيل والكي وتسليم القطع النظيفة للموظف، يفتح المتعهد الطلب ويضغط **تأكيد تسليم القطع النظيفة**. يوقّع الموظف على الكشف الورقي.
5. يراجع مشرف السكن الطلب بعد التسليم، ويطابق الكمية والخدمات ثم يعتمد أو يرفض مع السبب. لا يمكن اعتماد طلب لم يتم تسجيل تسليمه.
6. نهاية الشهر أو الفترة المطلوبة، يفتح المتعهد **التقارير والمستحقات**، ويختار تاريخ البداية والنهاية ويطبع الكشف للتواقيع الورقية أو يصدّره CSV.
7. تُحتسب الطلبات المعتمدة فقط ضمن مبلغ المستحقات؛ الطلبات المعلقة والمرفوضة تظهر منفصلة.

## 8. استيراد قاعدة الموظفين

من **قاعدة الموظفين** اختر استيراد CSV. يمكن أن يحتوي الملف على الأعمدة التالية (الإنجليزية أو عناوين عربية مدعومة):

```csv
employee_code,name,company,department,phone
10001,اسم الموظف,اسم الشركة,الإدارة,777000000
10002,اسم موظف آخر,اسم الشركة,السكن,777000001
```

الرقم الوظيفي يجب أن يكون فريداً. السجل الموجود بالرقم نفسه يُحدّث بدلاً من تكراره. يُفضّل حفظ ملف CSV بترميز UTF-8. لا ترسل قاعدة موظفي الشركة إلى جهة عامة أو مستودع GitHub عام؛ استوردها بعد تأمين الوصول إلى النظام.

### استيراد كشف الموظفين الرسمي (Excel)

ضع ملف كشف الموظفين بصيغة `.xlsx` في مجلد المشروع (بجانب `app.py`) ثم نفّذ:

```powershell
.venv\Scripts\python.exe import_employees.py --dry-run   # فحص دون كتابة
.venv\Scripts\python.exe import_employees.py             # الاستيراد الفعلي
```

- يستورد السكربت موظفي **«الشركة اليمنية لتكرير السكر»** فقط، ويستبعد بقية الشركات (مثل «رأس عيسى الصناعية») تلقائياً. غيّر `--company` لاستيراد شركة أخرى.
- يقرأ السكربت الأعمدة: الكود، الاسم الرسمي، الإدارة الفرعية، المسمى الوظيفي، جدول العمل، شرح نوع الدوام، عدد أيام العمل/الراحة، تاريخ أول يوم عمل، وقت المغادرة، الجنس، الشركة، موقع السكن، نوع الخدمة، تصنيف النقل، ويوم الدورة.
- يحسب السكربت «مرساة الدورة» لكل موظف من يوم الدورة المسجّل في الكشف، فيعيد النظام حساب حالة الدوام لأي تاريخ لاحق بدقة.
- يعتمد السكربت على مكتبة بايثون القياسية فقط (لا يحتاج تثبيت أي حزمة إضافية).
- يطبع السكربت تقريراً ويلتقط فحصاً لاتساق البيانات (مطابقة حالة الدوام ويوم الدورة)، ويحفظ نسخة في `import_report.txt`.
- السجل الموجود بالرقم الوظيفي نفسه يُحدّث بدلاً من تكراره، لذلك يمكن إعادة تشغيل السكربت بعد تحديث الكشف بأمان.

## 9. تشخيص سريع

- **فشل Render في بدء التشغيل ويذكر `INITIAL_ADMIN_PASSWORD`:** أضف المتغير إلى Render، واجعله 12 حرفاً على الأقل، ثم أعد النشر.
- **خطأ اتصال قاعدة البيانات:** راجع `DATABASE_URL` في Render، وكلمة مرور Supabase، واسم المضيف/المستخدم/المنفذ المنقول من زر Connect. لا تستخدم رابط الاتصال المباشر إذا كان غير متاح من بيئة Render؛ استخدم Session pooler.
- **ظهور `SQLite محلية للتجربة` في النظام المنشور:** المتغير `DATABASE_URL` غير موجود أو فارغ في Render. لا تُدخل بيانات إنتاج قبل تصحيح ذلك.
- **لا تظهر خدمة أو سعر مناسب:** ادخل مدير النظام إلى صفحة الخدمات والأسعار وأضف الصنف أو عدّل السعر؛ أسعار البداية صفر متعمداً.
- **لا تتزامن الأجهزة:** تأكد أن جميع المستخدمين يفتحون رابط Render نفسه، وليس `127.0.0.1` أو نسخة محلية.

## محتويات المجلد

- `app.py`: تطبيق Flask والصلاحيات والعمليات وقاعدة البيانات.
- `templates/`: الصفحات العربية.
- `static/`: التنسيق وJavaScript وأيقونات وملفات PWA.
- `supabase/schema.sql`: مخطط PostgreSQL.
- `render.yaml`: إعداد النشر على Render.
- `requirements.txt`: متطلبات التشغيل.
- `run_windows.bat`: تشغيل محلي على Windows.
- ظاهرة تشغيل محلي على Windows: `run_windows.bat` يستورد كشف الموظفين تلقائياً إن وُجد ملف `.xlsx` في المجلد قبل تشغيل الخادم.
- `xlsx_reader.py`: قارئ ملفات Excel بمكتبة بايثون القياسية (بدون اعتماديات).
- `import_employees.py`: استيراد كشف الموظفين من ملف Excel مع فحص الاتساق.
- `data/sample_employees.csv`: مثال لتنسيق ملف الموظفين.

### ملفات تطبيق الجوال

- `laundry_mobile_project/`: تطبيق الجوال Flutter (Android + Web) بواجهة عربية RTL.
  - `lib/state/laundry_store.dart`: الحالة، الجلسة، النسخة المحلية، طابور المزامنة دون اتصال.
  - `lib/services/laundry_api.dart`: عميل REST والتعامل مع الأخطاء العربية.
  - `lib/utils/shift.dart`: حساب دورة الدوام والتنبيهات (مطابق لمنطق الخادم).
  - `lib/screens/`: شاشات التطبيق (المتابعة، الطلبات، الموظفون، الأسعار، التقارير، المستخدمون، الإعدادات، الحساب).
  - `test/`: اختبارات الوحدة ودورة offline-first مقابل خادم فعلي.
  - `tool/integration_test.dart`: اختبار تكامل شامل مع واجهة API.
- `build_flutter_apk.ps1`: سكربت بناء التطبيق (فحص ← اختبارات ← APK + Web ← نسخ إلى `apk/`).
- `mobile_api.py`: REST API الخاص بتطبيق الجوال (دخول، نسخة محلية، مزامنة، تسليم واعتماد).
- `mobile/www/`: واجهة تطبيق الجوال (HTML/CSS/JS خالص) — نفس الملفات المحزومة داخل الـ APK.
  - `mobile/www/js/store.js`: التخزين المحلي، الجلسة، PIN، طابور المزامنة، طابور الإجراءات.
  - `mobile/www/js/shift.js`: حساب دورة الدوام والتنبيهات (مطابق تماماً لمنطق الخادم).
  - `mobile/www/js/app.js`: الشاشات (الرئيسية، طلب جديد، الطلبات، التقارير، الإعدادات).
  - `mobile/www/js/bootstrap.js`: الإقلاع، الدخول، القفل بالرمز المحلي، المزامنة التلقائية.
- `mobile/test/mobile_test.mjs`: اختبارات منطق التطبيق (110 فحصاً) تُشغَّل عبر Node.
- `mobile/capacitor.config.json`: إعدادات Capacitor (المعرّف، الاسم، مسار الملفات).
- `mobile/android/`: مشروع Android (Gradle) الذي ينتج ملفات APK.
- `mobile/android/laundry-release.keystore`: مفتاح توقيع نسخة الإصدار — **احتفظ به ولا تشاركه**.
- `build_apk.ps1`: سكربت بناء الـ APK (اختبارات ← مزامنة ← بناء ← نسخ إلى `apk/`).
- `apk/`: ملفات APK الجاهزة للتثبيت.
