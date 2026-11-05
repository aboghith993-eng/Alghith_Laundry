"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronDown,
  CloudUpload,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Server,
  ShieldCheck,
  UserRound,
  WashingMachine,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useApp } from "@/lib/store";
import { roleLabel } from "@/lib/permissions";
import {
  BUILD_DEFAULT_SERVER,
  backendBaseUrl,
  getConfig,
  getIdentity,
  hasLocalPin,
  isOnline,
  normalizeBaseUrl,
  saveConfig,
  setLocalPin,
  testServerConnection,
  tryOnlineLogin,
  unlockLocal,
  verifyLocalPin,
} from "@/lib/offlineStore";
import type { SessionUser } from "@/lib/types";
import { Button, Field, LoadingBlock, Modal, TextInput } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { ready, session, toast } = useApp();

  const [identity, setIdentity] = useState<Partial<SessionUser> | null>(null);
  const [pinExists, setPinExists] = useState(false);
  const [quickPin, setQuickPin] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPin, setNewPin] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [serverOpen, setServerOpen] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [effectiveServer, setEffectiveServer] = useState("");

  useEffect(() => {
    if (!ready) return;
    const stored = getIdentity();
    setIdentity(stored);
    if (stored?.username) {
      setUsername(stored.username);
      setPinExists(hasLocalPin(stored.username));
    }
    setShowFull(!stored);
    setServerUrl(getConfig().server_url || "");
    setEffectiveServer(backendBaseUrl());
    if (session) router.replace("/home");
  }, [ready, session, router]);

  const online = useMemo(() => (typeof navigator === "undefined" ? true : navigator.onLine), [ready]);

  async function finishLogin() {
    router.replace("/home");
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const name = username.trim();
    if (!name) {
      setError("اكتب اسم المستخدم.");
      return;
    }
    if (!password) {
      setError("اكتب كلمة المرور.");
      return;
    }
    if (newPin && !/^\d{4,8}$/.test(newPin)) {
      setError("رمز الدخول السريع يجب أن يكون من 4 إلى 8 أرقام.");
      return;
    }
    setBusy(true);
    try {
      const result = await tryOnlineLogin(name, password);
      if (result.ok) {
        if (newPin) await setLocalPin(newPin, name);
        toast("تم تسجيل الدخول. تجري مزامنة البيانات...", "success");
        await finishLogin();
        return;
      }
      if (result.code === "unauthorized") {
        setError("اسم المستخدم أو كلمة المرور غير صحيحة.");
        return;
      }
      // تعذر الوصول إلى الخادم: محاولة الدخول المحلي إن كانت الجلسة محفوظة.
      const stored = getIdentity();
      if (stored?.username && stored.username === name) {
        if (hasLocalPin(name)) {
          setError("لا يوجد اتصال بالخادم. استخدم رمز الدخول السريع بالأسفل.");
        } else {
          unlockLocal(name);
          toast("تم الدخول بالبيانات المحفوظة — ستتم المزامنة عند عودة الاتصال.", "info");
          router.replace("/home");
        }
        return;
      }
      setError(
        "تعذر الاتصال بالخادم. تحقق من الإنترنت، أو استخدم حساباً سبق تسجيل الدخول عليه من هذا الجهاز للعمل دون اتصال.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickLogin(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!identity?.username) return;
    const name = identity.username;
    if (hasLocalPin(name)) {
      if (!quickPin.trim()) {
        setError("أدخل رمز الدخول السريع.");
        return;
      }
      const valid = await verifyLocalPin(quickPin.trim(), name);
      if (!valid) {
        setError("رمز الدخول السريع غير صحيح.");
        return;
      }
    }
    unlockLocal(name);
    toast("مرحباً بك مرة أخرى.", "success");
    router.replace("/home");
  }

  async function handleServerSave(test: boolean) {
    setTesting(true);
    try {
      saveConfig({ server_url: normalizeBaseUrl(serverUrl) });
      setEffectiveServer(backendBaseUrl());
      if (test) {
        const result = await testServerConnection();
        if (result.ok) {
          toast(`تم الاتصال بالخادم: ${result.base}`, "success");
          setServerOpen(false);
        } else {
          toast(result.error || "تعذر الاتصال بالخادم.", "error");
        }
      } else {
        toast("تم حفظ عنوان الخادم.", "success");
        setServerOpen(false);
      }
    } finally {
      setTesting(false);
    }
  }

  if (!ready) {
    return (
      <div className="login-page">
        <LoadingBlock label="جارٍ تجهيز التطبيق..." />
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-wrap">
        <div className="login-hero">
          <span className="hero-icon">
            <WashingMachine size={28} />
          </span>
          <h1>مغسلة الغيث</h1>
          <p>إدارة طلبات المغسلة والساكنين — تعمل دون إنترنت وتُزامن تلقائياً عند عودة الاتصال.</p>
          <div className="hero-chips">
            <span className="hero-chip">
              <WifiOff size={12} /> عمل دون اتصال
            </span>
            <span className="hero-chip">
              <CloudUpload size={12} /> مزامنة تلقائية
            </span>
            <span className="hero-chip">
              <ShieldCheck size={12} /> بيانات محفوظة على الجهاز
            </span>
          </div>
        </div>

        {identity && !showFull ? (
          <div className="login-card">
            <div className="quick-user">
              <span className="avatar large">{(identity.full_name || identity.username || "؟").slice(0, 1)}</span>
              <div>
                <strong>{identity.full_name || identity.username}</strong>
                <small>{roleLabel(identity as SessionUser)} — دخول سريع</small>
              </div>
            </div>
            <form onSubmit={handleQuickLogin} className="stack">
              {pinExists && (
                <Field label="رمز الدخول السريع (PIN)" hint="الرمز المحلي الذي عيّنته عند أول تسجيل دخول.">
                  <div className="search-box" style={{ paddingInlineStart: 12 }}>
                    <KeyRound size={17} />
                    <input
                      value={quickPin}
                      onChange={(event) => setQuickPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="••••"
                    />
                  </div>
                </Field>
              )}
              {error && <div className="alert alert-error">{error}</div>}
              <Button type="submit" size="lg" block icon={LockKeyhole}>
                {pinExists ? "فتح التطبيق" : "الدخول دون اتصال"}
              </Button>
              {!online && (
                <div className="alert alert-warn">
                  <WifiOff size={16} />
                  <span>لا يوجد اتصال حالياً — ستعمل على البيانات المحفوظة، وستُزامن كل الإجراءات تلقائياً لاحقاً.</span>
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => {
                  setShowFull(true);
                  setError("");
                }}
              >
                استخدام حساب آخر
              </button>
            </form>
          </div>
        ) : (
          <div className="login-card">
            <h2>تسجيل الدخول</h2>
            <p>تسجيل الدخول متاح عبر الإنترنت، ثم يمكنك الدخول لاحقاً برمز PIN دون اتصال.</p>
            <form onSubmit={handleLogin} className="stack">
              <Field label="اسم المستخدم" required>
                <div className="search-box" style={{ paddingInlineStart: 12 }}>
                  <UserRound size={17} />
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    inputMode="text"
                    placeholder="مثال: admin"
                    required
                  />
                </div>
              </Field>
              <Field label="كلمة المرور" required>
                <div className="search-box" style={{ paddingInlineStart: 12, paddingInlineEnd: 4 }}>
                  <KeyRound size={17} />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    className="icon-plain"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              <details className="advanced-box">
                <summary>
                  <ChevronDown size={15} /> خيارات الدخول دون اتصال
                </summary>
                <div className="stack" style={{ marginTop: 10 }}>
                  <Field
                    label="رمز PIN اختياري"
                    hint="من 4 إلى 8 أرقام. يُحفظ على الجهاز فقط ويتيح فتح التطبيق دون إنترنت."
                  >
                    <TextInput
                      value={newPin}
                      onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="مثال: 1234"
                    />
                  </Field>
                </div>
              </details>

              {error && <div className="alert alert-error">{error}</div>}
              {!online && (
                <div className="alert alert-warn">
                  <WifiOff size={16} />
                  <span>الجهاز دون اتصال الآن. يمكنك الدخول من الحساب المحفوظ إن وُجد، ثم المزامنة لاحقاً.</span>
                </div>
              )}
              <Button type="submit" size="lg" block loading={busy} icon={online ? Wifi : LockKeyhole}>
                {online ? "دخول ومزامنة" : "محاولة الدخول"}
              </Button>
              {identity && (
                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => {
                    setShowFull(false);
                    setError("");
                  }}
                >
                  <ArrowLeft size={16} /> العودة للدخول السريع
                </button>
              )}
            </form>
          </div>
        )}

        <div className="login-foot">
          <div>
            الخادم: <b dir="ltr">{effectiveServer || "غير محدد"}</b>
          </div>
          <button type="button" onClick={() => setServerOpen(true)}>
            <Server size={12} style={{ verticalAlign: -1, marginInlineEnd: 3 }} />
            إعدادات الخادم
          </button>
          {!getConfig().server_url && <div>الخادم الافتراضي المدمج: {BUILD_DEFAULT_SERVER}</div>}
        </div>
      </div>

      <Modal
        open={serverOpen}
        title="عنوان خادم المغسلة"
        subtitle="اتركه فارغاً لاستخدام الخادم الافتراضي المدمج."
        onClose={() => setServerOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setServerOpen(false)} disabled={testing}>
              إلغاء
            </Button>
            <Button variant="outline" onClick={() => void handleServerSave(false)} disabled={testing}>
              حفظ
            </Button>
            <Button loading={testing} onClick={() => void handleServerSave(true)}>
              حفظ واختبار الاتصال
            </Button>
          </>
        }
      >
        <Field
          label="عنوان الخادم"
          hint={`الافتراضي: ${BUILD_DEFAULT_SERVER}`}
        >
          <TextInput
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            dir="ltr"
            inputMode="url"
            placeholder={BUILD_DEFAULT_SERVER}
          />
        </Field>
        <div className="alert alert-info" style={{ marginTop: 12 }}>
          <Server size={16} />
          <span>
            يُستخدم هذا العنوان للمزامنة وتحميل بيانات الساكنين والخدمات. تأكد من الاتصال قبل اختبار العنوان.
          </span>
        </div>
        <div className="kv" style={{ marginTop: 10 }}>
          <span>العنوان الفعّال</span>
          <strong dir="ltr">{backendBaseUrl() || "—"}</strong>
        </div>
        <div className="kv">
          <span>حالة الاتصال</span>
          <strong>{isOnline() ? "الجهاز متصل" : "دون اتصال"}</strong>
        </div>
      </Modal>
    </div>
  );
}
