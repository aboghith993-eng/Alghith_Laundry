"use client";

/* مزوّد التطبيق: يربط واجهة React بمخزن المغسلة المحلي، ويشغّل المزامنة التلقائية
   عند عودة الاتصال وعند فتح التطبيق، ويعرض التنبيهات. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import * as store from "./offlineStore";
import type { LocalOrder, ServiceItem, SessionUser, Snapshot } from "./types";

export type ToastTone = "success" | "error" | "info";

type Toast = { id: number; message: string; tone: ToastTone };

type AppValue = {
  ready: boolean;
  session: SessionUser | null;
  online: boolean;
  syncing: boolean;
  lastSync: string;
  lastError: string;
  snapshot: Snapshot | null;
  orders: LocalOrder[];
  services: ServiceItem[];
  pending: number;
  pendingServices: number;
  toast: (message: string, tone?: ToastTone) => void;
  syncNow: (silent?: boolean) => Promise<void>;
  refreshSnapshot: (silent?: boolean) => Promise<void>;
  lock: () => void;
  signOut: () => void;
};

const AppContext = createContext<AppValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [, forceRender] = useReducer((value: number) => value + 1, 0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    store.initStore();
    forceRender();
    const unsubscribe = store.subscribe(() => forceRender());
    return unsubscribe;
  }, []);

  const toast = useCallback((message: string, tone: ToastTone = "info") => {
    if (!message) return;
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4600);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  // مزامنة تلقائية دورية وعند عودة الاتصال.
  useEffect(() => {
    const scheduleSync = (delay = 900) => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => {
        if (!store.isOnline() || !store.isOnlineSession()) return;
        void store.syncEverything();
      }, delay);
    };

    const onOnline = () => {
      store.setOnline(true);
      toast("عاد الاتصال — تجري المزامنة التلقائية.", "info");
      scheduleSync(400);
    };
    const onOffline = () => {
      store.setOnline(false);
      toast("انقطع الاتصال — يعمل التطبيق دون إنترنت وستُزامَن البيانات تلقائياً.", "info");
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = store.state.lastSync ? new Date(store.state.lastSync).getTime() : 0;
      if (Date.now() - last > 45000) scheduleSync(700);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);

    if (store.isOnline() && store.isOnlineSession()) {
      const last = store.state.lastSync ? new Date(store.state.lastSync).getTime() : 0;
      scheduleSync(Date.now() - last > 20000 ? 1200 : 4000);
    }
    const interval = setInterval(() => {
      if (!store.isOnline() || !store.isOnlineSession()) return;
      if (store.state.syncing) return;
      void store.syncEverything();
    }, 60000);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [toast]);

  const syncNow = useCallback(
    async (silent = false) => {
      if (!store.isOnlineSession()) {
        toast("سجّل الدخول مرة واحدة على الأقل لتتمكن المزامنة.", "error");
        return;
      }
      if (!store.isOnline()) {
        toast("لا يوجد اتصال بالإنترنت الآن. ستُزامَن البيانات عند عودته.", "info");
        return;
      }
      const result = await store.syncEverything();
      const pendingAfter = store.pendingCount() + store.pendingServiceCount();
      if (!silent) {
        if (!result.snapshot.ok && result.snapshot.error) {
          toast(result.snapshot.error, "error");
        } else if (pendingAfter > 0) {
          toast(
            `تمت المزامنة — بقي ${pendingAfter} إجراء بانتظار الإرسال. تحقق من الأخطاء في الطلبات.`,
            "info",
          );
        } else {
          toast("تمت مزامنة البيانات بنجاح.", "success");
        }
      }
    },
    [toast],
  );

  const refreshSnapshot = useCallback(
    async (silent = false) => {
      if (!store.isOnline() || !store.isOnlineSession()) {
        if (!silent) toast("يتطلب تحديث بيانات الساكنين اتصالاً بالإنترنت.", "info");
        return;
      }
      const result = await store.refreshSnapshot();
      if (!silent) {
        if (result.ok) toast("تم تحديث بيانات الساكنين والخدمات.", "success");
        else toast(result.error || "تعذر تحديث البيانات.", "error");
      }
    },
    [toast],
  );

  const lock = useCallback(() => {
    store.lockApp();
    window.location.href = "/";
  }, []);

  const signOut = useCallback(() => {
    store.fullSignOut();
    window.location.href = "/";
  }, []);

  const session = store.state.session;
  const snapshot = store.state.snapshot;

  // نُصدر نسخاً جديدة من المصفوفات عند كل إشعار كي تُعيد الواجهات
  // حساب القوائم المفلترة (useMemo) فوراً بعد الإضافة أو التعديل.
  const value: AppValue = {
    ready: store.state.ready,
    session,
    online: store.state.online,
    syncing: store.state.syncing,
    lastSync: store.state.lastSync,
    lastError: store.state.lastError,
    snapshot,
    orders: [...store.state.orders],
    services: [...store.state.services],
    pending: store.pendingCount(),
    pendingServices: store.pendingServiceCount(),
    toast,
    syncNow,
    refreshSnapshot,
    lock,
    signOut,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className={`toast toast-${item.tone}`}>
            {item.tone === "success" ? (
              <CheckCircle2 size={18} />
            ) : item.tone === "error" ? (
              <AlertTriangle size={18} />
            ) : (
              <Info size={18} />
            )}
            <span>{item.message}</span>
            <button type="button" onClick={() => dismissToast(item.id)} aria-label="إغلاق">
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

export function useApp(): AppValue {
  const value = useContext(AppContext);
  if (!value) {
    throw new Error("useApp must be used within AppProvider");
  }
  return value;
}

/** حماية صفحة: إعادة التوجيه إلى تسجيل الدخول إذا لا توجد جلسة. */
export function useSessionGuard(): boolean {
  const { ready, session } = useApp();
  useEffect(() => {
    if (ready && !session) {
      window.location.replace("/");
    }
  }, [ready, session]);
  return ready && !!session;
}
