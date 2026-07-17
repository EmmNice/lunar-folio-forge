import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/messages/$id")({
  head: () => ({ meta: [{ title: "Conversation · The Ledger" }] }),
  component: ThreadPage,
});

type Profile = { id: string; handle: string; display_name: string; avatar_url: string | null };
type Message = { id: string; sender_id: string; body: string; created_at: string };
const MAX = 1000;

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
          "user_a, user_b, a:profiles!conversations_user_a_fkey(id, handle, display_name, avatar_url), b:profiles!conversations_user_b_fkey(id, handle, display_name, avatar_url)",
        )
        .eq("id", id)
        .maybeSingle();
      if (cancelled || !conv) return;
      const otherProfile = (conv.user_a === user.id ? conv.b : conv.a) as unknown as Profile;
      setOther(otherProfile);

      const { data: msgs } = await supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setMessages((msgs ?? []) as Message[]);
      queueMicrotask(() => scrollRef.current?.scrollTo({ top: 1e9 }));
    })();

    const channel = supabase
      .channel(`messages:${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` },
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
    if (trimmed.length > MAX) {
      toast.error(`Messages are limited to ${MAX} characters.`);
      return;
    }
    setSending(true);
    const { error } = await supabase
      .from("messages")
      .insert({ conversation_id: id, sender_id: user.id, body: trimmed });
    setSending(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBody("");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pt-6 pb-6 sm:px-6">
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
                  <img src={other.avatar_url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid h-full w-full place-items-center">
                    {other.display_name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="truncate">{other.display_name}</span>
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
          className="sticky bottom-0 flex items-end gap-2 border-t border-border/60 bg-background/80 pt-3 backdrop-blur"
        >
          <textarea
            rows={2}
            maxLength={MAX + 40}
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
