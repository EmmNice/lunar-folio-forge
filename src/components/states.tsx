import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { AlertCircle, RefreshCw } from "lucide-react";

/**
 * The three states every list in the product needs, in one place.
 *
 * Each screen used to invent its own: some empty states were a bare sentence in
 * muted text, others a dashed box with different padding and a different icon
 * treatment; failures were mostly a toast that vanished, leaving a page that
 * looked identical to "you have nothing here". Loading was per-screen pulsing
 * blocks with hand-picked animation delays.
 */

/** Section heading used at the top of a page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1.5 flex items-center gap-2">
            {Icon ? <Icon className="h-3.5 w-3.5 text-tertiary" /> : null}
            <p className="eyebrow">{eyebrow}</p>
          </div>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-secondary">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Empty state. Deliberately opinionated: an icon, one line that says what this
 * place is for, and — where there is one — a single next action. An empty screen
 * with no way forward is the most common way a new account stalls.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div
        className="mb-4 grid h-12 w-12 place-items-center rounded-2xl border"
        style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}
      >
        <Icon className="h-5 w-5 text-tertiary" />
      </div>
      <p className="text-[15px] font-semibold">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/**
 * Failure state with a way out.
 *
 * `onRetry` is not optional by accident — a dead end that only tells you
 * something broke is barely better than the silent empty list it replaced.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      className="flex flex-col items-start gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderColor: "rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.06)" }}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--danger)" }} />
        <div>
          <p className="text-sm font-semibold" style={{ color: "#fca5a5" }}>
            {title}
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-secondary">{message}</p>
        </div>
      </div>
      <button type="button" onClick={onRetry} className="btn btn-outline btn-sm shrink-0">
        <RefreshCw className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  );
}

/** A single shimmering block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

/** Placeholder rows shaped like the post cards they stand in for. */
export function PostSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading posts" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-4/5" />
              <div className="flex gap-5 pt-1.5">
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="h-3 w-10" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder rows for the notification and conversation lists. */
export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y" style={{ borderColor: "var(--border)" }} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3 w-10 shrink-0" />
        </div>
      ))}
    </div>
  );
}

/** Convenience: a primary-styled internal link, since several empty states need one. */
export function EmptyStateLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="btn btn-primary btn-sm">
      {children}
    </Link>
  );
}
