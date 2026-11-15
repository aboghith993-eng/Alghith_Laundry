/* محمّل التحديث التلقائي (OTA Live Loader) — نقطة إقلاع ثابتة في الـ APK.
   الآلية:
   1) عند كل فتح للتطبيق يفحص الخادم بصمة واجهة التطبيق (/api/mobile/ota/manifest).
   2) إن وُجد إصدار أحدث من المحفوظ/المدمج: يحمّل النسخة الجديدة ويشغّلها فوراً.
   3) لا يمس أي بيانات الجهاز (ln_orders وغيرها) — يكتب فقط مفاتيح ln_live_*.
   4) حماية كاملة: عند فشل تحميل أو تشغيل أي إصدار يتراجع تلقائياً للنسخة المدمجة
      في الـ APK، ويحتفظ بآخر إصدار سليم في النسخة السابقة.
   ملفات index.html وlive.js نفسه لا تُحدَّث عن بُعد — كل الواجهة تُبنى من JS. */

const BUNDLED_VERSION = "bundle-1.2.0"; // يُحدَّث مع كل إصدار APK جديد
const DEFAULT_SERVER = "https://alghith-laundry.onrender.com";
const KEY_LIVE = "ln_live_bundle"; // {version, entry, files:{path:code}}
const KEY_CHECKED_AT = "ln_live_checked_at";
const KEY_LIVE_OK = "ln_live_ok"; // آخر إصدار أُقلع بنجاح
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // فحص كل ساعة كحد أقصى عند الإقلاع
const FETCH_TIMEOUT_MS = 6000;

/* عنوان الخادم: نفس منطق store.js لكن مستقل حتى يعمل المحمّل قبل تحميل الوحدات. */
function isNativePlatform() {
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

function serverBase() {
  let raw = "";
  try {
    const cfg = JSON.parse(localStorage.getItem("ln_config") || "{}");
    raw = String(cfg.server_url || "").trim();
  } catch {
    raw = "";
  }
  if (raw) {
    if (!/^https?:\/\//i.test(raw)) {
      raw = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(raw)
        ? `http://${raw}`
        : `https://${raw}`;
    }
    return raw.replace(/\/+$/, "");
  }
  if (typeof window === "undefined") return DEFAULT_SERVER;
  // في تطبيق Capacitor origin هو https://localhost — لا يصلح كخادم خلفي.
  if (isNativePlatform()) return DEFAULT_SERVER;
  return window.location.origin || DEFAULT_SERVER;
}

function readStoredBundle() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY_LIVE) || "null");
    if (data && data.version && data.entry && data.files && data.files[data.entry]) return data;
  } catch {
    /* حزمة تالفة — تُتجاهل */
  }
  return null;
}

function storeBundle(bundle) {
  try {
    localStorage.setItem(KEY_LIVE, JSON.stringify(bundle));
  } catch {
    /* التخزين ممتلئ: نحذف الحزمة القديمة ونعيد المحاولة مرة */
    try {
      localStorage.removeItem(KEY_LIVE);
      localStorage.setItem(KEY_LIVE, JSON.stringify(bundle));
    } catch {
      /* تجاهل */
    }
  }
}

async function fetchManifest() {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`${serverBase()}/api/mobile/ota/manifest`, {
      method: "GET",
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.version || !data.entry || !data.files || !data.files[data.entry]) return null;
    const size = Object.values(data.files).reduce((sum, code) => sum + String(code).length, 0);
    if (size > 3 * 1024 * 1024) return null; // حزمة غير منطقية — تجاهل
    return data;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* تحويل نص الملفات إلى وحدات Blob مع إعادة كتابة الاستيرادات النسبية (./x.js)
   إلى أسماء مستعارة (ln:x.js) تُحل عبر خريطة استيراد (import map) تشير إلى
   روابط الـ Blob نفسها — فيصبح رسم الوحدات مغلقاً ومحسوماً بأي عمق. */
function buildBundleGraph(bundle) {
  const files = bundle.files || {};
  const bareNames = new Map();
  for (const path of Object.keys(files)) {
    if (path.endsWith(".js")) bareNames.set(path, `ln:${path.split("/").pop()}`);
  }
  const rewritten = new Map();
  for (const [path, code] of Object.entries(files)) {
    if (!path.endsWith(".js")) {
      rewritten.set(path, code);
      continue;
    }
    const out = code.replace(/(["'])\.\/([^"']+\.js)\1/g, (match, quote, spec) => {
      // كل وحدات التطبيق أشقاء في مجلد js/ — المسار الهدف js/<spec>
      const target = "js/" + String(spec).replace(/^\.\//, "");
      const bare = bareNames.get(target);
      return bare ? `${quote}${bare}${quote}` : match;
    });
    rewritten.set(path, out);
  }
  if (!rewritten.has(bundle.entry)) throw new Error("missing entry: " + bundle.entry);
  const urls = new Map();
  for (const [path, code] of rewritten) {
    const type = path.endsWith(".css") ? "text/css" : "text/javascript";
    urls.set(path, URL.createObjectURL(new Blob([code], { type })));
  }
  const imports = {};
  for (const [path, url] of urls) {
    const bare = bareNames.get(path);
    if (bare) imports[bare] = url;
  }
  return { urls, imports };
}

/* حقن CSS المحدَّث فوق الستايل المدمج. */
function injectCss(bundle) {
  const css = (bundle.files || {})["css/app.css"];
  if (!css) return;
  const old = document.getElementById("live-css");
  if (old) old.remove();
  const style = document.createElement("style");
  style.id = "live-css";
  style.textContent = css;
  document.head.appendChild(style);
}

async function importBundle(bundle) {
  const { urls, imports } = buildBundleGraph(bundle);
  // خريطة الاستيراد يجب أن تُدرج قبل أول تحميل وحدة — live.js سكربت تقليدي
  // لذلك لا بد أن يكون الإدراج هنا آمناً (لا وحدات محمّلة قبله في المستند).
  if (!document.querySelector('script[type="importmap"]')) {
    const mapScript = document.createElement("script");
    mapScript.type = "importmap";
    mapScript.textContent = JSON.stringify({ imports });
    document.head.appendChild(mapScript);
  }
  await import(urls.get(bundle.entry));
}

function markBooted(version) {
  try {
    localStorage.setItem(KEY_LIVE_OK, version);
  } catch {
    /* تجاهل */
  }
}

/* تحديث صامت أثناء العمل: يخزّن الإصدار الجديد ليُطبَّق عند الفتح التالي. */
async function backgroundCheck() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, offline: true };
  const manifest = await fetchManifest();
  if (!manifest) return { ok: false };
  try {
    localStorage.setItem(KEY_CHECKED_AT, String(Date.now()));
  } catch {
    /* تجاهل */
  }
  const stored = readStoredBundle();
  if (manifest.version === BUNDLED_VERSION) {
    if (stored) {
      try {
        localStorage.removeItem(KEY_LIVE);
      } catch {
        /* تجاهل */
      }
    }
    return { ok: true, version: manifest.version, same: true };
  }
  if (stored && stored.version === manifest.version) return { ok: true, version: manifest.version, same: true };
  storeBundle(manifest);
  return { ok: true, version: manifest.version, updated: true };
}

/* فحص يدوي من الإعدادات: يخزّن التحديث ويطلب إعادة فتح التطبيق لتطبيقه. */
window.LaundryLive = {
  bundledVersion: BUNDLED_VERSION,
  get version() {
    try {
      return localStorage.getItem(KEY_LIVE_OK) || BUNDLED_VERSION;
    } catch {
      return BUNDLED_VERSION;
    }
  },
  server: serverBase(),
  async check() {
    const result = await backgroundCheck();
    if (result.updated) {
      return { updated: true, version: result.version, message: "تم تنزيل التحديث — أعد فتح التطبيق لتطبيقه." };
    }
    return { updated: false, version: result.version || null, message: "التطبيق محدَّث لآخر إصدار." };
  },
};

/* إقلاع التطبيق على أحدث نسخة متاحة. */
(async function boot() {
  const online = typeof navigator !== "undefined" ? navigator.onLine : true;
  const stored = readStoredBundle();
  const lastCheck = Number(localStorage.getItem(KEY_CHECKED_AT) || 0);
  const stale = Date.now() - lastCheck > CHECK_INTERVAL_MS;

  // 1) فحص الخادم عند الإقلاع: فقط عند توفر اتصال وانتهاء صلاحية آخر فحص
  //    (أو عند وجود إصدار مخزن لم يُثبَّت بعد). أثناء الفحص تُظهر الشاشة شعارها الحالي.
  let target = null;
  if (online && (stale || !stored)) {
    const manifest = await fetchManifest();
    if (manifest) {
      try {
        localStorage.setItem(KEY_CHECKED_AT, String(Date.now()));
      } catch {
        /* تجاهل */
      }
      if (manifest.version === BUNDLED_VERSION) {
        // الخادم يعيد نفس النسخة المدمجة: تُمسح أي حزمة قديمة.
        if (stored) {
          try {
            localStorage.removeItem(KEY_LIVE);
          } catch {
            /* تجاهل */
          }
        }
      } else if (!stored || stored.version !== manifest.version) {
        // إصدار أحدث على الخادم: يُخزَّن ويُشغَّل فوراً — بلا إعادة تثبيت.
        storeBundle(manifest);
        target = manifest;
      }
    }
    if (!target) target = readStoredBundle();
  } else {
    target = stored;
  }

  // 2) تشغيل النسخة المختارة مع تراجع آمن إلى النسخة المدمجة عند أي خطأ.
  if (target) {
    try {
      injectCss(target);
      await importBundle(target);
      markBooted(target.version);
      return;
    } catch (err) {
      console.error("[live] فشل تشغيل الإصدار المحدَّث، التراجع للنسخة المدمجة:", err);
      try {
        localStorage.removeItem(KEY_LIVE);
      } catch {
        /* تجاهل */
      }
    }
  }
  try {
    await import("./bootstrap.js");
    markBooted(BUNDLED_VERSION);
  } catch (err) {
    console.error("[live] فشل إقلاع النسخة المدمجة:", err);
  }
})();

/* فحص دوري صغير أثناء العمل: يجهّز التحديث للفتح التالي دون مقاطعة المستخدم. */
setInterval(() => {
  if (document.visibilityState === "visible") backgroundCheck();
}, CHECK_INTERVAL_MS);
