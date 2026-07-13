import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Flag, MessageSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusCard, type Background } from "@/components/StatusCard";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/time";
import { startConversation } from "@/lib/messaging.functions";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/feed")({
  head: () => ({
    meta: [
      { title: "The Ledger — Feed of tech-founder status cards" },
      {
        name: "description",
        content:
          "A real-time feed of status cards from tech founders and builders.",
      },
    ],
  }),
  component: FeedPage,
});

type FeedPost = {
  id: string;
  content: string;
  background: Background;
  created_at: string;
  author: {
    id: string;
    handle: string;
    display_name: string;
    avatar_url: string | null;
  };
};

function FeedPage() {
  const [posts, setPosts] = useState<FeedPost[] | null>(null);

  async function fetchAll() {
    const { data, error } = await supabase
      .from("posts")
      .select(
        "id, content, background, created_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url)",
      )
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) {
      toast.error("Couldn't load the feed.");
      setPosts([]);
      return;
    }
    setPosts((data ?? []) as unknown as FeedPost[]);
  }

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel("public:posts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "posts" },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pt-10 pb-24 sm:px-6">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              The Ledger
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              What builders are saying
            </h1>
          </div>
          <Link
            to="/studio"
            className="rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background transition-opacity hover:opacity-90"
          >
            Publish yours
          </Link>
        </div>

        {posts === null ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : posts.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="columns-1 gap-6 sm:columns-2 lg:columns-3 [column-fill:_balance]">
            {posts.map((p) => (
              <FeedCard key={p.id} post={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center">
      <p className="text-sm text-muted-foreground">
        No posts yet. Be the first to publish something.
      </p>
      <Link
        to="/studio"
        className="mt-4 inline-block rounded-md bg-foreground px-4 py-2 text-xs font-medium text-background"
      >
        Open the Studio
      </Link>
    </div>
  );
}

function FeedCard({ post }: { post: FeedPost }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const start = useServerFn(startConversation);
  const [busyMsg, setBusyMsg] = useState(false);
  const [reported, setReported] = useState(false);

  const isSelf = user?.id === post.author.id;

  async function report() {
    if (!user) {
      toast.error("Sign in to report posts.");
      return;
    }
    const { error } = await supabase
      .from("reports")
      .insert({ post_id: post.id, reporter_id: user.id });
    if (error && !error.message.includes("duplicate")) {
      toast.error("Couldn't submit report.");
      return;
    }
    setReported(true);
    toast.success("Thanks — the moderators will review.");
  }

  async function message() {
    if (!user || !profile) {
      toast.error("Sign in to send a message.");
      return;
    }
    setBusyMsg(true);
    try {
      const res = await start({ data: { recipientId: post.author.id } });
      navigate({ to: "/messages/$id", params: { id: res.conversationId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start a conversation.");
    } finally {
      setBusyMsg(false);
    }
  }

  return (
    <div className="mb-6 break-inside-avoid">
      <div className="overflow-hidden rounded-2xl border border-border/60">
        <StatusCard
          name={post.author.display_name}
          handle={post.author.handle}
          avatarUrl={post.author.avatar_url}
          content={post.content}
          background={post.background}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
        <Link
          to="/u/$handle"
          params={{ handle: post.author.handle }}
          className="truncate transition-colors hover:text-foreground"
        >
          <span className="font-medium text-foreground">{post.author.display_name}</span>{" "}
          · @{post.author.handle} · {timeAgo(post.created_at)}
        </Link>
        <div className="flex shrink-0 items-center gap-1">
          {user && !isSelf ? (
            <button
              type="button"
              onClick={message}
              disabled={busyMsg}
              aria-label="Message author"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              <MessageSquare className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={report}
            disabled={reported}
            aria-label="Report post"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            <Flag className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
