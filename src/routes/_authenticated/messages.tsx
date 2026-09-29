import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/time";
import { EmptyState, ListSkeleton, PageHeader } from "@/components/states";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({ meta: [{ title: "Messages · The Ledger" }] }),
  component: MessagesIndex,
});

type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string;
  a: { id: string; handle: string; display_name: string; avatar_url: string | null } | null;
  b: { id: string; handle: string; display_name: string; avatar_url: string | null } | null;
};

function MessagesIndex() {
  const { user } = useAuth();
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [unreadThreads, setUnreadThreads] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    (async () => {
      // No .eq() filter here on purpose: the conversations SELECT policy already
      // scopes rows to the two participants. `error` was previously discarded, so
      // a failure looked like an empty inbox.
      const { data, error } = await supabase
        .from("conversations")
        .select(
          "id, user_a, user_b, last_message_at, a:profiles!conversations_user_a_fkey(id, handle, display_name, avatar_url), b:profiles!conversations_user_b_fkey(id, handle, display_name, avatar_url)",
        )
        .order("last_message_at", { ascending: false });
      if (error) {
        toast.error("Couldn't load your conversations.");
        setRows([]);
        return;
      }
      setRows((data ?? []) as unknown as ConversationRow[]);

      // Which threads have an unread message notification waiting.
      const { data: unread } = await supabase
        .from("notifications")
        .select("conversation_id")
        .eq("user_id", user.id)
        .eq("type", "message")
        .eq("read", false);
      setUnreadThreads(
        new Set((unread ?? []).map((n) => n.conversation_id).filter((v): v is string => !!v)),
      );
    })();
  }, [user]);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="page-enter mx-auto max-w-2xl px-4 pb-mobile-nav pt-8 sm:px-6">
        <PageHeader
          eyebrow="Direct"
          icon={MessageSquare}
          title="Messages"
          description="Private threads. Starting a new conversation costs one of three daily requests."
        />

        <div>
          {rows === null ? (
            <ListSkeleton count={3} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No conversations yet"
              description="Open someone's profile and hit Message to start a thread."
              action={
                <Link to="/feed" className="btn btn-primary btn-sm">
                  Find people in the feed
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((c) => {
                const other = c.a && c.a.id === user?.id ? c.b : c.a;
                if (!other) return null;
                const unread = unreadThreads.has(c.id);
                return (
                  <li key={c.id}>
                    <Link
                      to="/messages/$id"
                      params={{ id: c.id }}
                      className="flex items-center gap-3 py-4 transition-colors hover:bg-accent/30"
                    >
                      <div className="grid h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-sm font-semibold">
                        {other.avatar_url ? (
                          <img
                            src={other.avatar_url}
                            alt=""
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="grid h-full w-full place-items-center">
                            {other.display_name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {other.display_name}{" "}
                          <span className="text-muted-foreground">@{other.handle}</span>
                        </p>
                        {unread && (
                          <p className="text-xs font-medium text-violet-400">New message</p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(c.last_message_at)}
                      </span>
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-violet-400" />}
                    </Link>
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
