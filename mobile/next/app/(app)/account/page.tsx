"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  CloudUpload,
  KeyRound,
  Lock,
  LogOut,
  RotateCcw,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Field,
  PageHead,
  Panel,
  TextInput,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import {
  getIdentity,
  hasLocalPin,
  setLocalPin,
  verifyLocalPin,
} from "@/lib/offlineStore";
import { canViewSettings, roleLabel } from "@/lib/permissions";
import { timeAgo } from "@/lib/format";

export default function AccountPage() {
  const { session, online, syncing, lastSync, pending, pendingServices, syncNow, lock, signOut, toast } = useApp();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinExists, setPinExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const username = session?.username || getIdentity()?.username || "";

  useEffect(() => {
    if (username) setPinExists(hasLocalPin(username));
  }, [username]);

  const displayName = session?.full_name || session?.name || session?.username || "المستخدم";
  const companyName = typeof session?.company === "string" ? session.company : "";
  const pendingTotal = pending + pendingServices;

  async function savePin() {
    setError("");
    if (!username) {
      setError("تعذر تحديد اسم المستخدم. أعد تسجيل الدخول.");
      return;
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      setError("رمز PIN يجب أن يكون من 4 إلى 8 أرقام.");
      return;
    }
    if (newPin !== confirmPin) {
      setError("تأكيد الرمز لا يطابق الرمز الجديد.");
      return;
    }
    setBusy(true);
    try {
      if (pinExists) {
        const valid = await verifyLocalPin(currentPin.trim(), username);
        if (!valid) {
          setError("الرمز الحالي غير صحيح.");
          return;
        }
      }
      await setLocalPin(newPin, username);
      setPinExists(true);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      toast(pinExists ? "تم تغيير رمز الدخول السريع." : "تم تعيين رمز الدخول السريع.", "success");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow="حسابي"
        title="بيانات الحساب"
        subtitle="معلومات المستخدم، رمز الدخول السريع دون اتصال، وحالة المزامنة."
        actions={
          canViewSettings(session) ? (
            <Link href="/settings" className="btn btn-outline btn-sm">
              الإعدادات
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div className="row" style={{ gap: 12 }}>
          <span className="avatar large">{displayName.slice(0, 1)}</span>
          <div className="grow">
            <strong style={{ fontSize: 16 }}>{displayName}</strong>
            <div className="muted small">{username || "بدون اسم مستخدم"}</div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              <Badge tone="primary">{roleLabel(session)}</Badge>
              {companyName && <Badge tone="muted">{companyName}</Badge>}
            </div>
          </div>
        </div>
      </Card>

      <div className="metric-grid">
        <div className="metric">
          <span className="metric-icon">
            {online ? <Wifi size={18} /> : <WifiOff size={18} />}
          </span>
          <div className="metric-body">
            <span>حالة الاتصال</span>
            <strong style={{ fontSize: 15 }}>{online ? "متصل" : "دون اتصال"}</strong>
            <small>{lastSync ? `آخر مزامنة ${timeAgo(lastSync)}` : "لم تتم مزامنة بعد"}</small>
          </div>
        </div>
        <div className="metric">
          <span className="metric-icon">
            <CloudUpload size={18} />
          </span>
          <div className="metric-body">
            <span>بانتظار الإرسال</span>
            <strong style={{ fontSize: 18 }}>{pendingTotal}</strong>
            <small>{pendingTotal ? "ستُزامن تلقائياً" : "كل شيء مُزامن"}</small>
          </div>
        </div>
      </div>

      <Panel title="رمز الدخول السريع (PIN)" subtitle="يتيح فتح التطبيق دون إنترنت على هذا الجهاز">
        <div className="stack" style={{ gap: 10 }}>
          <div className="alert alert-info">
            <ShieldCheck size={16} />
            <span>
              الرمز محفوظ مشفّراً على هذا الجهاز فقط ولا يُرسل إلى الخادم. استخدمه عند انقطاع الإنترنت.
            </span>
          </div>
          {pinExists && (
            <Field label="الرمز الحالي" required>
              <TextInput
                value={currentPin}
                onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                placeholder="••••"
              />
            </Field>
          )}
          <div className="filter-grid">
            <Field label={pinExists ? "الرمز الجديد" : "رمز PIN"} required>
              <TextInput
                value={newPin}
                onChange={(event) => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                placeholder="4 إلى 8 أرقام"
              />
            </Field>
            <Field label="تأكيد الرمز" required>
              <TextInput
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                placeholder="أعد كتابة الرمز"
              />
            </Field>
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <Button icon={KeyRound} loading={busy} onClick={() => void savePin()} disabled={!newPin || !confirmPin}>
            {pinExists ? "تغيير الرمز" : "تعيين الرمز"}
          </Button>
        </div>
      </Panel>

      <Panel title="إجراءات الحساب">
        <div className="settings-list">
          <button type="button" className="settings-link" onClick={() => setPinExists(true)}>
            <span className="link-icon">
              <RotateCcw size={17} />
            </span>
            <span className="link-text">
              <strong>رمز الدخول السريع</strong>
              <small>{pinExists ? "رمز مفعّل على هذا الجهاز" : "لم يُعيَّن رمز بعد"}</small>
            </span>
            <ChevronLeft size={17} className="chev" />
          </button>

          {online && (
            <button type="button" className="settings-link" onClick={() => void syncNow()} disabled={syncing}>
              <span className="link-icon">
                <CloudUpload size={17} />
              </span>
              <span className="link-text">
                <strong>{syncing ? "جارٍ المزامنة..." : "مزامنة الآن"}</strong>
                <small>{pendingTotal ? `${pendingTotal} إجراء بانتظار الإرسال` : "كل البيانات محدّثة"}</small>
              </span>
              <ChevronLeft size={17} className="chev" />
            </button>
          )}

          <button type="button" className="settings-link" onClick={lock}>
            <span className="link-icon">
              <Lock size={17} />
            </span>
            <span className="link-text">
              <strong>قفل التطبيق</strong>
              <small>يتطلب رمز PIN أو كلمة المرور للفتح</small>
            </span>
            <ChevronLeft size={17} className="chev" />
          </button>

          <button
            type="button"
            className="settings-link"
            onClick={() => {
              if (window.confirm("تسجيل الخروج سيمسح بيانات الجلسة من هذا الجهاز. هل تريد المتابعة؟")) {
                signOut();
              }
            }}
          >
            <span className="link-icon" style={{ background: "var(--danger-soft)", color: "var(--danger)" }}>
              <LogOut size={17} />
            </span>
            <span className="link-text">
              <strong style={{ color: "var(--danger)" }}>تسجيل الخروج</strong>
              <small>مسح الجلسة من الجهاز</small>
            </span>
            <ChevronLeft size={17} className="chev" />
          </button>
        </div>
      </Panel>

      <div className="muted tiny center">
        <UserRound size={12} style={{ verticalAlign: -2 }} /> الحساب: {username || "—"}
      </div>
    </div>
  );
}
