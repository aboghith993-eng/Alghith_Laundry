"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { LoadingBlock } from "@/components/ui";
import { useApp } from "@/lib/store";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { ready, session } = useApp();

  useEffect(() => {
    if (ready && !session) {
      router.replace("/");
    }
  }, [ready, session, router]);

  if (!ready) {
    return (
      <div className="login-page">
        <LoadingBlock label="جارٍ تجهيز بياناتك..." />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="login-page">
        <LoadingBlock label="جارٍ التحويل لتسجيل الدخول..." />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
