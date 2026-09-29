import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell,
  Heart,
  MessageCircle,
  Repeat2,
  ShieldCheck,
  ShieldOff,
  Mail,
  Briefcase,
  UserPlus,
  AtSign,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/time";
import { NOTIFICATION_PAGE_SIZE } from "@/lib/limits";
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from "@/components/states";
import { setUnreadCount } from "@/lib/unread-count";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications · The Ledger" }] }),
  component: NotificationsPage,
});

type NotificationType =
  | "like"
  | "comment"
  | "repost"
  | "verification_approved"
  | "verification_rejected"
  | "message"
  | "pitch"
  | "follow"
  | "mention";

type NotificationRow = {
  id: string;
  type: NotificationType;
  read: boolean;
  created_at: string;
  conversation_id: string | null;
  metadata: { tier?: "silver" | "gold"; companyName?: string } | null;
  actor: { id: string; handle: string; display_name: string; avatar_url: string | null } | null;
  post: { id: string; content: string } | null;
};

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  like: Heart,
  comment: MessageCircle,
  repost: Repeat2,
  verification_approved: ShieldCheck,
  verification_rejected: ShieldOff,
  message: Mail,
  pitch: Briefcase,
  follow: UserPlus,
  mention: AtSign,
};

const TYPE_LABEL: Record<string, string> = {
  like: "liked your post",
  comment: "commented on your post",
  repost: "re-shipped your post",
  message: "sent you a message",
  pitch: "pitched you",
  follow: "followed you",
  mention: "mentioned you",
};

const TYPE_ICON_COLOR: Record<string, string> = {
  like: "text-rose-400",
  comment: "text-sky-400",
  repost: "text-emerald-400",
  verification_approved: "text-amber-400",
  verification_rejected: "text-red-400",
  message: "text-violet-400",
  pitch: "text-amber-400",
  follow: "text-sky-400",
  mention: "text-[var(--gold)]",
};

function verificationLabel(
  type: "verification_approved" | "verification_rejected",
  tier?: "silver" | "gold",
) {
  const tierLabel = tier === "gold" ? "Gold Investor" : "Silver Builder";
  if (type === "verification_approved") {
    return `🎉 Congratulations! Your ${tierLabel} verification has been approved.`;
  }
  return `Your ${tierLabel} verification application was not approved. You can reapply at any time.`;
}

function NotificationsPage() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingRead, setMarkingRead] = useState(false);

  async function load() {
    if (!user) return;
    // `error` used to be destructured away entirely, so a failed request rendered
    // the "No notifications yet" empty state — indistinguishable from an account
    // that genuinely has none.
    const { data, error } = await supabase
      .from("notifications")
      .select(
        "id, type, read, created_at, conversation_id, metadata, actor:profiles!notifications_actor_id_fkey(id, handle, display_name, avatar_url), post:posts!notifications_post_id_fkey(id, content)",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(NOTIFICATION_PAGE_SIZE);

    if (error) {
      setLoadError("Couldn't load your notifications. Check your connection and try again.");
      setNotifications([]);
      return;
    }
    setLoadError(null);
    setNotifications((data ?? []) as unknown as NotificationRow[]);
  }

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  /**
   * Mark everything read, on request.
   *
   * This used to fire automatically on mount, which meant the unread highlight
   * you were looking at was already stale and there was no way to leave something
   * marked unread to come back to.
   */
  async function markAllRead() {
    if (!user) return;
    const unreadIds = (notifications ?? []).filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    setMarkingRead(true);
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .in("id", unreadIds);
    setMarkingRead(false);
    if (error) {
      toast.error("Couldn't mark them read.");
      return;
    }
    setNotifications((prev) => prev?.map((n) => ({ ...n, read: true })) ?? null);
    setUnreadCount(0);
  }

  /** Reading one notification marks just that one. */
  async function markOneRead(id: string) {
    setNotifications((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? null);
    setUnreadCount(Math.max(0, unreadCount - 1));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }

  const unreadCount = (notifications ?? []).filter((n) => !n.read).length;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="page-enter mx-auto max-w-2xl px-4 pb-mobile-nav pt-8 sm:px-6">
        <PageHeader
          eyebrow="Activity"
          icon={Bell}
          title="Notifications"
          description="Likes, replies, re-ships, messages, pitches and verification decisions."
          action={
            unreadCount > 0 ? (
              <button
                type="button"
                onClick={markAllRead}
                disabled={markingRead}
                className="btn btn-outline btn-sm"
              >
                {markingRead ? "Marking…" : `Mark ${unreadCount} read`}
              </button>
            ) : undefined
          }
        />

        {loadError && (
          <div className="mb-5">
            <ErrorState message={loadError} onRetry={load} />
          </div>
        )}

        <div>
          {notifications === null ? (
            <ListSkeleton count={5} />
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Nothing yet"
              description="Likes, replies, re-ships, messages, pitches and verification decisions all land here."
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {notifications.map((n) => {
                const isVerification =
                  n.type === "verification_approved" || n.type === "verification_rejected";
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const iconColor = TYPE_ICON_COLOR[n.type] ?? "text-muted-foreground";

                return (
                  <li
                    key={n.id}
                    onClick={() => !n.read && markOneRead(n.id)}
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

                    {/* Actor avatar (only for social notifications) */}
                    {!isVerification && n.actor && (
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
                      {isVerification ? (
                        /* Verification notification */
                        <p className="text-sm text-foreground">
                          <span className="font-medium">The Ledger</span>{" "}
                          <span className="text-muted-foreground">
                            {verificationLabel(
                              n.type as "verification_approved" | "verification_rejected",
                              n.metadata?.tier,
                            )}
                          </span>
                        </p>
                      ) : (
                        /* Social notification */
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
                      )}
                      {!isVerification && n.post && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          "{n.post.content.slice(0, 80)}
                          {n.post.content.length > 80 ? "…" : ""}"
                        </p>
                      )}
                      {isVerification && n.type === "verification_approved" && (
                        <a
                          href="/feed"
                          className="mt-1 inline-block text-xs font-medium text-amber-400 hover:underline"
                        >
                          Open The Ledger →
                        </a>
                      )}
                      {n.type === "message" && n.conversation_id && (
                        <Link
                          to="/messages/$id"
                          params={{ id: n.conversation_id }}
                          className="mt-1 inline-block text-xs font-medium text-violet-400 hover:underline"
                        >
                          Open conversation →
                        </Link>
                      )}
                      {n.type === "pitch" && (
                        <Link
                          to="/settings"
                          className="mt-1 inline-block text-xs font-medium text-amber-400 hover:underline"
                        >
                          {n.metadata?.companyName
                            ? `Review pitch from ${n.metadata.companyName} →`
                            : "Review in Inbound Pitches →"}
                        </Link>
                      )}
                      <p className="mt-1 text-[11px] text-tertiary">{timeAgo(n.created_at)}</p>
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
