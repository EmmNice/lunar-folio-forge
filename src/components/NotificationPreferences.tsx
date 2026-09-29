import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, MessageSquare, MonitorCog, Zap } from "lucide-react";
import { LuxToggle } from "@/components/LuxToggle";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  NOTIFICATION_CHANNELS,
  parseNotificationPrefs,
  type NotificationChannel,
  type NotificationPrefs,
} from "@/lib/notification-prefs";

const CHANNEL_ICON: Record<NotificationChannel, typeof Bell> = {
  messages: MessageSquare,
  pitches: Zap,
  system: MonitorCog,
};

/**
 * Notification toggles, shared by /settings and /account-notifications.
 *
 * Writes straight to profiles.notification_prefs and rolls back the switch if
 * the update fails, so the UI never claims to have saved something it didn't.
 */
export function NotificationPreferences() {
  const { user, profile, refreshProfile } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [busy, setBusy] = useState<NotificationChannel | null>(null);

  useEffect(() => {
    if (profile) setPrefs(parseNotificationPrefs(profile.notification_prefs));
  }, [profile]);

  async function toggle(channel: NotificationChannel, value: boolean) {
    if (!user || !prefs) return;

    const previous = prefs;
    const next = { ...prefs, [channel]: value };
    setPrefs(next);
    setBusy(channel);

    const { error } = await supabase
      .from("profiles")
      .update({ notification_prefs: next })
      .eq("id", user.id);

    setBusy(null);

    if (error) {
      setPrefs(previous);
      toast.error(error.message);
      return;
    }

    await refreshProfile();
    toast.success("Notification preference saved.");
  }

  return (
    <>
      {NOTIFICATION_CHANNELS.map((channel, index) => {
        const Icon = CHANNEL_ICON[channel.key];
        return (
          <div
            key={channel.key}
            className="flex items-center justify-between gap-6 px-5 py-4"
            style={
              index < NOTIFICATION_CHANNELS.length - 1
                ? { borderBottom: "1px solid rgba(255,255,255,0.05)" }
                : undefined
            }
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <Icon className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">{channel.label}</p>
                <p className="text-[11px] text-muted-foreground">{channel.description}</p>
              </div>
            </div>
            <LuxToggle
              label={channel.label}
              checked={prefs?.[channel.key] ?? true}
              disabled={prefs === null || busy === channel.key}
              onChange={(value) => toggle(channel.key, value)}
            />
          </div>
        );
      })}
    </>
  );
}
