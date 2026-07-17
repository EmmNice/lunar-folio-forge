import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/time";

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

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select(
          "id, user_a, user_b, last_message_at, a:profiles!conversations_user_a_fkey(id, handle, display_name, avatar_url), b:profiles!conversations_user_b_fkey(id, handle, display_name, avatar_url)",
        )
        .order("last_message_at", { ascending: false });
      setRows((data ?? []) as unknown as ConversationRow[]);
    })();
  }, [user]);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-2xl px-4 pt-10 pb-24 sm:px-6 page-enter">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          New conversations are limited to 3 per day.
        </p>

        <div className="mt-8">
          {rows === null ? (
            <div className="divide-y divide-border/60">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 py-4">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-secondary/60" style={{ animationDelay: `${i * 60}ms` }} />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-40 animate-pulse rounded-full bg-secondary/60" style={{ animationDelay: `${i * 60 + 30}ms` }} />
                    <div className="h-3 w-24 animate-pulse rounded-full bg-secondary/35" style={{ animationDelay: `${i * 60 + 60}ms` }} />
                  </div>
                  <div className="h-2.5 w-10 animate-pulse rounded-full bg-secondary/30" />
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
              No conversations yet. Message someone from{" "}
              <Link to="/feed" className="underline underline-offset-4">The Ledger</Link>.
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((c) => {
                const other = c.a && c.a.id === user?.id ? c.b : c.a;
                if (!other) return null;
                return (
                  <li key={c.id}>
                    <Link
                      to="/messages/$id"
                      params={{ id: c.id }}
                      className="flex items-center gap-3 py-4 transition-colors hover:bg-accent/30"
                    >
                      <div className="grid h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border bg-secondary/50 text-sm font-semibold">
                        {other.avatar_url ? (
                          <img src={other.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
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
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(c.last_message_at)}
                      </span>
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
