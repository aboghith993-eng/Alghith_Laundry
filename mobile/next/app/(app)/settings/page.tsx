"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronLeft,
  CloudUpload,
  Database,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Tags,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageHead,
  Panel,
  StatCard,
  TextInput,
} from "@/components/ui";
import { useApp } from "@/lib/store";
import {
  BUILD_DEFAULT_SERVER,
  backendBaseUrl,
  getConfig,
  normalizeBaseUrl,
  saveConfig,
  testServerConnection,
} from "@/lib/offlineStore";
import { canViewSettings, roleLabel } from "@/lib/permissions";
import { timeAgo } from "@/lib/format";

export default function SettingsPage() {
  const {
    session,
    snapshot,
    services,
    orders,
    online,
    syncing,
    lastSync,
    lastError,
    pending,
    pendingServices,
    syncNow,
    refreshSnapshot,
    toast,
  } = useApp();

  const allowed = canViewSettings(session);
  const [serverUrl, setServerUrl] = useState("");
  const [effective, setEffective] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setServerUrl(getConfig().server_url || "");
    setEffective(backendBaseUrl());
  }, []);

  if (!allowed) {
    return (
      <div className="stack">
        <PageHead title="الإعدادات" />
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="الإعدادات لمدير النظام فقط"
            hint="هذه الصفحة مخفية عن بقية المستخدمين. يمكنك إدارة حسابك ورمز الدخول من صفحة «حسابي»."
            action={
              <Link href="/account" className="btn btn-primary btn-sm">
                حسابي
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  async function saveServer(test: boolean) {
    setSaving(true);
    try {
      saveConfig({ server_url: normalizeBaseUrl(serverUrl) });
      setEffective(backendBaseUrl());
      if (!test) {
        toast("تم حفظ عنوان الخادم.", "success");
        return;
      }
      setTesting(true);
      const result = await testServerConnection();
      if (result.ok) {
        toast(`تم الاتصال بالخادم: ${result.base}`, "success");
      } else {
        toast(result.error || "تعذر الاتصال بالخادم.", "error");
      }
    } finally {
      setTesting(false);
      setSaving(false);
    }
  }

  function resetServer() {
    saveConfig({ server_url: "" });
    setServerUrl("");
    setEffective(backendBaseUrl());
    toast("تمت استعادة الخادم الافتراضي المدمج.", "success");
  }

  const pendingTotal = pending + pendingServices;

  return (
    <div className="stack-lg">
      <PageHead
        eyebrow="مدير النظام"
        title="الإعدادات"
        subtitle="عنوان الخادم، المزامنة، بيانات الساكنين، وإدارة الخدمات والأسعار."
        actions={
          <>
            {online && (
              <Button size="sm" variant="outline" icon={RefreshCw} loading={syncing} onClick={() => void syncNow()}>
                مزامنة
              </Button>
            )}
            <Link href="/services" className="btn btn-primary btn-sm">
              <Tags size={16} /> الخدمات
            </Link>
          </>
        }
      />

      <div className="metric-grid">
        <StatCard
          icon={CloudUpload}
          label="بانتظار الإرسال"
          value={pendingTotal}
          hint={pendingTotal ? "ستُزامن تلقائياً" : "كل شيء مُزامن"}
          tone={pendingTotal ? "warn" : "success"}
        />
        <StatCard
          icon={UsersRound}
          label="الساكنون"
          value={snapshot?.employees?.length || 0}
          hint="بيانات محفوظة على الجهاز"
          tone="primary"
        />
        <StatCard icon={Tags} label="الخدمات" value={services.length} hint="أسعار قابلة للتعديل" tone="info" />
        <StatCard icon={Database} label="الطلبات" value={orders.length} hint="محفوظة محلياً" tone="muted" />
      </div>

      <Panel title="عنوان الخادم" subtitle="يُستخدم للمزامنة وتحميل بيانات الساكنين والخدمات">
        <div className="stack" style={{ gap: 10 }}>
          <Field
            label="عنوان الخادم"
            hint={`اتركه فارغاً لاستخدام الافتراضي المدمج: ${BUILD_DEFAULT_SERVER}`}
          >
            <TextInput
              value={serverUrl}
              onChange={(event) => setServerUrl(event.target.value)}
              dir="ltr"
              inputMode="url"
              placeholder={BUILD_DEFAULT_SERVER}
            />
          </Field>

          <div className="kv">
            <span>العنوان الفعّال</span>
            <strong dir="ltr">{effective || "—"}</strong>
          </div>
          <div className="kv">
            <span>حالة الاتصال</span>
            <strong>
              {online ? (
                <Badge tone="good" dot>
                  متصل
                </Badge>
              ) : (
                <Badge tone="warn" dot>
                  دون اتصال
                </Badge>
              )}
            </strong>
          </div>
          <div className="kv">
            <span>آخر مزامنة</span>
            <strong>{lastSync ? timeAgo(lastSync) : "لم تتم بعد"}</strong>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="outline"
              icon={Server}
              loading={saving || testing}
              onClick={() => void saveServer(true)}
            >
              حفظ واختبار الاتصال
            </Button>
            <Button variant="soft" onClick={() => void saveServer(false)} disabled={saving || testing}>
              حفظ
            </Button>
            <Button variant="ghost" onClick={resetServer} disabled={saving || testing}>
              استعادة الافتراضي
            </Button>
          </div>

          {lastError && (
            <div className="alert alert-error">
              <AlertTriangle size={16} />
              <span>{lastError}</span>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="المزامنة والبيانات">
        <div className="settings-list">
          <button
            type="button"
            className="settings-link"
            onClick={() => void syncNow()}
            disabled={!online || syncing}
          >
            <span className="link-icon">
              <CloudUpload size={17} />
            </span>
            <span className="link-text">
              <strong>{syncing ? "جارٍ المزامنة..." : "مزامنة الآن"}</strong>
              <small>إرسال الإجراءات المحلية وتحميل التحديثات</small>
            </span>
            <ChevronLeft size={17} className="chev" />
          </button>

          <button
            type="button"
            className="settings-link"
            onClick={() => void refreshSnapshot()}
            disabled={!online || syncing}
          >
            <span className="link-icon">
              <RefreshCw size={17} />
            </span>
            <span className="link-text">
              <strong>تحديث بيانات الساكنين</strong>
              <small>
                {snapshot?.built_at
                  ? `آخر تحميل ${timeAgo(snapshot.built_at)}`
                  : "لم تُحمّل بعد — يتطلب اتصالاً"}
              </small>
            </span>
            <ChevronLeft size={17} className="chev" />
          </button>

          <Link href="/services" className="settings-link">
            <span className="link-icon">
              <Tags size={17} />
            </span>
            <span className="link-text">
              <strong>الخدمات والأسعار</strong>
              <small>إضافة خدمة، تعديل السعر، إيقاف أو حذف</small>
            </span>
            <ChevronLeft size={17} className="chev" />
          </Link>

          <Link href="/account" className="settings-link">
            <span className="link-icon">
              <UserRound size={17} />
            </span>
            <span className="link-text">
              <strong>حسابي</strong>
              <small>رمز الدخول السريع وقفل التطبيق</small>
            </span>
            <ChevronLeft size={17} className="chev" />
          </Link>
        </div>
      </Panel>

      <Panel title="معلومات النظام">
        <div className="kv">
          <span>المستخدم</span>
          <strong>{session?.full_name || session?.name || session?.username || "—"}</strong>
        </div>
        <div className="kv">
          <span>الدور</span>
          <strong>{roleLabel(session)}</strong>
        </div>
        <div className="kv">
          <span>الشركة</span>
          <strong>
            {(typeof session?.company === "string" && session.company) ||
              (snapshot?.company as string | undefined) ||
              "—"}
          </strong>
        </div>
        <div className="kv">
          <span>إصدار التطبيق</span>
          <strong>2.0.0</strong>
        </div>
        <div className="kv">
          <span>العملة</span>
          <strong>{snapshot?.settings?.currency || "—"}</strong>
        </div>
      </Panel>

      <div className="alert alert-info">
        <ShieldCheck size={16} />
        <span>
          صفحة الإعدادات وإدارة الخدمات والأسعار متاحة لمدير النظام فقط، ومخفية عن المتعهد والمشرف.
        </span>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <span className={online ? "net-chip online" : "net-chip offline"}>
          {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          {online ? "متصل بالإنترنت" : "دون اتصال"}
        </span>
        <span className="muted tiny">
          <Settings size={12} style={{ verticalAlign: -2 }} /> الإعدادات تُطبَّق فوراً على هذا الجهاز.
        </span>
      </div>
    </div>
  );
}
