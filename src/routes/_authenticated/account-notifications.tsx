import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { NotificationPreferences } from "@/components/NotificationPreferences";

export const Route = createFileRoute("/_authenticated/account-notifications")({
  head: () => ({ meta: [{ title: "Notification Preferences · The Ledger" }] }),
  component: NotificationSettingsPage,
});

function NotificationSettingsPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => navigate({ to: "/feed" })}
          aria-label="Back to feed"
          className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.06]"
        >
          <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        </button>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
            Account
          </p>
          <h1 className="text-[17px] font-semibold tracking-tight">Notification Preferences</h1>
        </div>
      </div>

      <main className="mx-auto max-w-lg px-4 pt-8 pb-28">
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(26,26,30,0.60)",
          }}
        >
          <NotificationPreferences />
        </div>
      </main>
    </div>
  );
}
