import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, Zap, MonitorCog } from "lucide-react";

export const Route = createFileRoute("/_authenticated/account-notifications")({
  head: () => ({ meta: [{ title: "Notification Preferences · The Ledger" }] }),
  component: NotificationSettingsPage,
});

const NOTIF_KEYS = {
  messages: "ledger_notif_messages",
  pitches:  "ledger_notif_pitches",
  system:   "ledger_notif_system",
} as const;
function readNotif(k: keyof typeof NOTIF_KEYS) {
  try { return localStorage.getItem(NOTIF_KEYS[k]) !== "false"; } catch { return true; }
}
function writeNotif(k: keyof typeof NOTIF_KEYS, v: boolean) {
  try { localStorage.setItem(NOTIF_KEYS[k], String(v)); } catch { /* ignore */ }
}

function LuxToggle({
  checked, onChange,
}: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative h-5 w-9 shrink-0 rounded-full transition-all"
      style={{
        background: checked ? "rgba(245,245,246,0.90)" : "rgba(255,255,255,0.10)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "translateX(2px)" }}
      />
    </button>
  );
}

function NotificationSettingsPage() {
  const navigate = useNavigate();

  const [messages, setMessages] = useState(() => readNotif("messages"));
  const [pitches,  setPitches]  = useState(() => readNotif("pitches"));
  const [system,   setSystem]   = useState(() => readNotif("system"));

  function toggle(k: keyof typeof NOTIF_KEYS, val: boolean, setter: (v: boolean) => void) {
    setter(val);
    writeNotif(k, val);
    toast.success("Saved.");
  }

  const rows = [
    {
      icon: MessageSquare,
      label: "New Message Alerts",
      desc: "Notify when someone sends you a direct message.",
      val: messages,
      set: (v: boolean) => toggle("messages", v, setMessages),
    },
    {
      icon: Zap,
      label: "Pitch Match Alerts",
      desc: "Notify when a new pitch arrives in your inbox.",
      val: pitches,
      set: (v: boolean) => toggle("pitches", v, setPitches),
    },
    {
      icon: MonitorCog,
      label: "System Updates",
      desc: "Platform announcements and feature releases.",
      val: system,
      set: (v: boolean) => toggle("system", v, setSystem),
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#0B0B0C" }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-4"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}
      >
        <button
          type="button"
          onClick={() => navigate({ to: "/feed" })}
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
          style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(26,26,30,0.60)" }}
        >
          {rows.map((r, i) => (
            <div
              key={r.label}
              className="flex items-center justify-between gap-6 px-5 py-4"
              style={i < rows.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}
            >
              <div className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <r.icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-[11px] text-muted-foreground">{r.desc}</p>
                </div>
              </div>
              <LuxToggle checked={r.val} onChange={r.set} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
