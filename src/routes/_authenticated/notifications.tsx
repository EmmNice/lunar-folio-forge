import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/time";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications · The Ledger" }] }),
  component: NotificationsPage,
});

type NotificationRow = {
  id: string;
  type: "like" | "comment" | "repost";
  read: boolean;
  created_at: string;
  actor: { id: string; handle: string; display_name: string; avatar_url: string | null } | null;
  post: { id: string; content: string } | null;
};

const TYPE_ICON = {
  like: Heart,
  comment: MessageCircle,
  repost: Repeat2,
};

const TYPE_LABEL: Record<string, string> = {
  like: "liked your post",
  comment: "commented on your post",
  repost: "re-shipped your post",
};

function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("notifications")
        .select(
          "id, type, read, created_at, actor:profiles!notifications_actor_id_fkey(id, handle, display_name, avatar_url), post:posts!notifications_post_id_fkey(id, content)",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (cancelled) return;
      setNotifications((data ?? []) as unknown as NotificationRow[]);

      // Mark all unread as read
      const unreadIds = (data ?? []).filter((n: any) => !n.read).map((n: any) => n.id);
      if (unreadIds.length > 0) {
        await supabase
          .from("notifications")
          .update({ read: true })
          .in("id", unreadIds);
      }
    })();

    return () => { cancelled = true; };
  }, [user]);

  return (
    <div className="min-h-screen pb-16 sm:pb-0">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 pt-10 pb-24 sm:px-6 page-enter">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Notifications</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Activity on your posts — likes, comments, and re-ships.
        </p>

        <div className="mt-8">
          {notifications === null ? (
            <div className="space-y-0 divide-y divide-border/60">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-start gap-3 py-4">
                  <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-secondary/60" style={{ animationDelay: `${i * 50}ms` }} />
                  <div className="flex-1 space-y-2 pt-0.5">
                    <div className="h-3 w-48 animate-pulse rounded-full bg-secondary/60" style={{ animationDelay: `${i * 50 + 25}ms` }} />
                    <div className="h-3 w-64 animate-pulse rounded-full bg-secondary/40" style={{ animationDelay: `${i * 50 + 50}ms` }} />
                    <div className="h-2.5 w-16 animate-pulse rounded-full bg-secondary/25" style={{ animationDelay: `${i * 50 + 75}ms` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center">
              <Bell className="mx-auto h-8 w-8 text-border" />
              <p className="mt-3 text-sm text-muted-foreground">No notifications yet.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                When someone likes, comments, or re-ships your posts, it'll show here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const iconColor =
                  n.type === "like"
                    ? "text-rose-400"
                    : n.type === "comment"
                      ? "text-sky-400"
                      : "text-emerald-400";
                return (
                  <li
                    key={n.id}
                    className={
                      "flex items-start gap-3 py-4 transition-colors " +
                      (!n.read ? "bg-secondary/20" : "")
                    }
                  >
                    {/* Icon */}
                    <div
                      className={
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/60 bg-secondary/40 " +
                        iconColor
                      }
                    >
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Actor avatar */}
                    {n.actor && (
                      <Link
                        to="/u/$handle"
                        params={{ handle: n.actor.handle }}
                        search={{ tab: undefined }}
                        className="shrink-0 hover:opacity-80"
                      >
                        <div className="grid h-8 w-8 overflow-hidden rounded-full border border-border bg-secondary/50 text-xs font-semibold">
                          {n.actor.avatar_url ? (
                            <img
                              src={n.actor.avatar_url}
                              alt=""
                              className="h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="grid h-full w-full place-items-center">
                              {n.actor.display_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </Link>
                    )}

                    {/* Text */}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        {n.actor ? (
                          <Link
                            to="/u/$handle"
                            params={{ handle: n.actor.handle }}
                            search={{ tab: undefined }}
                            className="font-medium hover:underline"
                          >
                            {n.actor.display_name}
                          </Link>
                        ) : (
                          <span className="font-medium">Someone</span>
                        )}{" "}
                        <span className="text-muted-foreground">{TYPE_LABEL[n.type]}</span>
                      </p>
                      {n.post && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          "{n.post.content.slice(0, 80)}{n.post.content.length > 80 ? "…" : ""}"
                        </p>
                      )}
                      <p className="mt-1 text-[11px] text-muted-foreground/60">
                        {timeAgo(n.created_at)}
                      </p>
                    </div>

                    {!n.read && (
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-foreground/70" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
