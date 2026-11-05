"use client";

import { useEffect, useId, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Inbox,
  Loader2,
  Search,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

/* --------------------------------- الترويسة -------------------------------- */

export function PageHead({
  title,
  subtitle,
  eyebrow,
  actions,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  );
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {hint && <span>{hint}</span>}
      </div>
      {action}
    </div>
  );
}

/* ---------------------------------- البطاقات -------------------------------- */

export function Card({
  children,
  className = "",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  if (onClick) {
    return (
      <button type="button" className={cx("card", "card-clickable", className)} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <div className={cx("card", className)}>{children}</div>;
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("panel", className)}>
      {(title || actions) && (
        <div className="panel-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <span>{subtitle}</span>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "primary" | "success" | "danger" | "warn" | "muted" | "info";
}) {
  return (
    <div className={cx("metric", `metric-${tone}`)}>
      {Icon && (
        <span className="metric-icon">
          <Icon size={18} />
        </span>
      )}
      <div className="metric-body">
        <span>{label}</span>
        <strong>{value}</strong>
        {hint && <small>{hint}</small>}
      </div>
    </div>
  );
}

/* ---------------------------------- الشارات ---------------------------------- */

export type BadgeTone = "good" | "bad" | "warn" | "info" | "muted" | "primary";

export function Badge({
  children,
  tone = "muted",
  dot = false,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
}) {
  return (
    <span className={cx("badge", `badge-${tone}`)}>
      {dot && <i className="badge-dot" />}
      {children}
    </span>
  );
}

export function CountPill({ children }: { children: ReactNode }) {
  return <span className="count-pill">{children}</span>;
}

/* ---------------------------------- الأزرار ---------------------------------- */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "soft" | "outline";
  size?: "md" | "sm" | "lg";
  icon?: LucideIcon;
  loading?: boolean;
  block?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  icon: Icon,
  loading,
  block,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx("btn", `btn-${variant}`, `btn-${size}`, block && "btn-block", className)}
    >
      {loading ? <Loader2 size={17} className="spin" /> : Icon ? <Icon size={17} /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button {...props} type="button" aria-label={label} title={label} className={cx("icon-btn", className)}>
      <Icon size={18} />
    </button>
  );
}

/* ---------------------------------- الحقول ---------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  required,
  className = "",
  htmlFor,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cx("field", className)}>
      {label && (
        <label htmlFor={htmlFor}>
          {label}
          {required && <b className="req"> *</b>}
        </label>
      )}
      {children}
      {hint && <small className="field-hint">{hint}</small>}
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx("ui-input", props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx("ui-input", "ui-textarea", props.className)} />;
}

export function Select({
  options,
  placeholder,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}) {
  return (
    <select {...props} className={cx("ui-input", "ui-select", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "بحث...",
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
}) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && onSubmit) onSubmit();
        }}
        placeholder={placeholder}
        inputMode="search"
      />
      {value && (
        <button type="button" className="icon-plain" onClick={() => onChange("")} aria-label="مسح البحث">
          <X size={15} />
        </button>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={cx("switch", checked && "on")}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </label>
  );
}

/* --------------------------------- التبويبات -------------------------------- */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ value: T; label: string; icon?: LucideIcon }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={value === tab.value}
            className={cx("tab", value === tab.value && "active")}
            onClick={() => onChange(tab.value)}
          >
            {Icon && <Icon size={16} />}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------- النوافذ ---------------------------------- */

export function Modal({
  open,
  title,
  subtitle,
  children,
  footer,
  onClose,
  size = "md",
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  size?: "md" | "lg";
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className={cx("modal", `modal-${size}`)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon={X} label="إغلاق" onClick={onClose} />
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  tone = "primary",
  busy,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && (
        <div className={cx("confirm-message", tone === "danger" && "danger")}>
          {tone === "danger" ? <AlertTriangle size={20} /> : <Check size={20} />}
          <p>{message}</p>
        </div>
      )}
      {children}
    </Modal>
  );
}

/* ---------------------------------- حالات ---------------------------------- */

export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

export function LoadingBlock({ label = "جارٍ التحميل..." }: { label?: string }) {
  return (
    <div className="loading-block">
      <Loader2 size={24} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function ProgressBar({ value, tone = "primary" }: { value: number; tone?: "primary" | "warn" | "danger" }) {
  const width = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={cx("progress", `progress-${tone}`)}>
      <span style={{ width: `${width}%` }} />
    </div>
  );
}

export function BackLink({ href, label = "رجوع" }: { href: string; label?: string }) {
  return (
    <a className="back-link" href={href}>
      <ChevronLeft size={16} />
      {label}
    </a>
  );
}
