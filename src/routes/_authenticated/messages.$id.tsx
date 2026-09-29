import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { VerificationBadge } from "@/components/VerificationBadge";
import type { VerificationTier } from "@/hooks/use-auth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeWriteError } from "@/lib/db-errors";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { MAX_MESSAGE_LENGTH } from "@/lib/limits";

export const Route = createFileRoute("/_authenticated/messages/$id")({
  head: () => ({ meta: [{ title: "Conversation · The Ledger" }] }),
  component: ThreadPage,
});

type Profile = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  verification_tier: VerificationTier;
};
type Message = { id: string; sender_id: string; body: string; created_at: string };

function ThreadPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [other, setOther] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: conv } = await supabase
        .from("conversations")
        .select(
          "user_a, user_b, a:profiles!conversations_user_a_fkey(id, handle, display_name, avatar_url, verification_tier), b:profiles!conversations_user_b_fkey(id, handle, display_name, avatar_url, verification_tier)",
        )
        .eq("id", id)
        .maybeSingle();
      if (cancelled || !conv) return;
      // Supabase returns joined rows as objects for FK joins; guard against
      // array shape and missing profile (e.g. deleted account).
      const rawOther = conv.user_a === user.id ? conv.b : conv.a;
      const otherProfile = Array.isArray(rawOther) ? (rawOther[0] ?? null) : rawOther;
      if (!otherProfile) return;
      setOther(otherProfile as unknown as Profile);

      const { data: msgs, error: msgErr } = await supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (msgErr) {
        toast.error("Couldn't load this conversation.");
        return;
      }
      setMessages((msgs ?? []) as Message[]);
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: 1e9 }));

      // Opening the thread clears its unread badge. notify_on_message() keeps at
      // most one unread row per conversation, so this is the read receipt.
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", user.id)
        .eq("conversation_id", id)
        .eq("read", false);
    })();

    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${id}`,
        },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          queueMicrotask(() => scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id, user]);

  async function send() {
    if (!user) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      toast.error(`Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }
    setSending(true);
    const { error } = await supabase
      .from("messages")
      .insert({ conversation_id: id, sender_id: user.id, body: trimmed });
    setSending(false);
    if (error) {
      toast.error(describeWriteError(error.message, "send messages"));
      return;
    }
    setBody("");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      {/* pb-mobile-nav, like every other authenticated page: without it the last
          messages in the thread hide behind the fixed bottom navigation too. */}
      <main className="pb-mobile-nav mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-6 sm:px-6">
        <div className="mb-4 flex items-center gap-3 border-b border-border/60 pb-4">
          <Link to="/messages" className="text-xs text-muted-foreground hover:text-foreground">
            ← Inbox
          </Link>
          {other ? (
            <Link
              to="/u/$handle"
              params={{ handle: other.handle }}
              search={{ tab: undefined }}
              className="ml-auto flex items-center gap-2 text-sm font-medium hover:opacity-80"
            >
              <div className="grid h-8 w-8 overflow-hidden rounded-full border border-border bg-secondary/50 text-xs font-semibold">
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
              <span className="truncate">{other.display_name}</span>
              <VerificationBadge tier={other.verification_tier} size={13} />
              <span className="text-muted-foreground">@{other.handle}</span>
            </Link>
          ) : null}
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pb-4">
          {messages.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">Say hello.</p>
          ) : (
            messages.map((m) => {
              const mine = m.sender_id === user?.id;
              return (
                <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                  <div
                    className={
                      "max-w-[75%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm " +
                      (mine
                        ? "bg-foreground text-background"
                        : "border border-border bg-secondary/50 text-foreground")
                    }
                  >
                    {m.body}
                  </div>
                </div>
              );
            })
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          /*
            Offset above the mobile navigation, not flush to the viewport bottom.

            MobileNav is `fixed bottom-0` and this was `sticky bottom-0`, so on a
            phone the entire composer sat underneath it — there was no visible way
            to type a message, which is most of what this screen is for. The
            desktop breakpoint has no bottom nav, so the offset is dropped there.
          */
          className="sticky bottom-[var(--composer-offset)] flex items-end gap-2 border-t border-border/60 bg-background/80 pt-3 pb-3 backdrop-blur sm:bottom-0 sm:pb-0"
          style={
            {
              "--composer-offset":
                "calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px))",
            } as React.CSSProperties
          }
        >
          <textarea
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH + 40}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Write a message… (Enter to send, Shift+Enter for newline)"
            className="min-h-[44px] flex-1 resize-none rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm outline-none focus:border-foreground/40"
          />
          <button
            type="submit"
            disabled={sending || !body.trim()}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </main>
    </div>
  );
}
