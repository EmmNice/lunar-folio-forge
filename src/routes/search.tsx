import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search as SearchIcon, Users, FileText, Loader2 } from "lucide-react";
import { AppHeader, MobileNav } from "@/components/AppHeader";
import { EmptyState, ErrorState, PostSkeleton } from "@/components/states";
import { PostCard, type FeedPost } from "@/components/PostCard";
import { VerificationBadge } from "@/components/VerificationBadge";
import { supabase } from "@/integrations/supabase/client";
import { toBackground } from "@/components/StatusCard";
import { useAuth } from "@/hooks/use-auth";
import type { VerificationTier } from "@/hooks/use-auth";
import { useCardExport } from "@/hooks/use-card-export";
import { ROLE_LABEL } from "@/lib/roles";
import type { RoleType } from "@/hooks/use-auth";
import { MIN_SEARCH_LENGTH, SEARCH_PAGE_SIZE } from "@/lib/limits";

/**
 * Search.
 *
 * Both halves are real database searches, not client-side filtering of a page of
 * rows — posts and profiles each carry a generated `search_vector` with a GIN index,
 * and handles and display names additionally have trigram indexes so a partial
 * handle matches (20260929000900).
 *
 * The two halves reach the data differently, on purpose:
 *
 *   Posts are an ordinary filtered SELECT. That means the posts SELECT policy
 *   applies unchanged — audience rules, blocks and author suspension are all
 *   inherited rather than re-implemented here, which is the whole reason not to
 *   wrap post search in a definer function.
 *
 *   People go through the search_profiles() definer function, because
 *   `hide_from_search` has to be honoured for anything querying the database, not
 *   only for this screen. It returns an explicit list of public columns; see the
 *   comment on the function for why `setof profiles` would have leaked
 *   date_of_birth.
 */

const SEARCH_TABS = ["people", "posts"] as const;
type SearchTab = (typeof SEARCH_TABS)[number];

export const Route = createFileRoute("/search")({
  head: () => ({
    meta: [
      { title: "Search — The Ledger" },
      { name: "description", content: "Find builders and posts on The Ledger." },
      // Search result pages are not content of ours to index.
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" && search.q.length > 0 ? search.q : undefined,
    tab: SEARCH_TABS.find((t) => t === search.tab),
  }),
  component: SearchPage,
});

type PersonResult = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  company_name: string | null;
  role_type: string | null;
  verification_tier: string;
};

type RawPostRow = {
  id: string;
  content: string;
  background: string | null;
  comments_enabled: boolean | null;
  visibility: string | null;
  created_at: string;
  edited_at: string | null;
  author: {
    id: string;
    handle: string;
    display_name: string;
    avatar_url: string | null;
    verification_tier: string;
  };
};

function SearchPage() {
  const { q, tab } = Route.useSearch();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { requestExport, exportSurface } = useCardExport();

  const [draft, setDraft] = useState(q ?? "");
  const [people, setPeople] = useState<PersonResult[] | null>(null);
  const [posts, setPosts] = useState<FeedPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const activeTab: SearchTab = tab ?? "people";
  const query = (q ?? "").trim();
  const tooShort = query.length > 0 && query.length < MIN_SEARCH_LENGTH;

  // The URL is the state. Sharing a search, reloading and the back button all work
  // as a result, and there is no second copy of the query to fall out of step.
  function submit(nextQuery: string) {
    const trimmed = nextQuery.trim();
    navigate({
      to: "/search",
      search: { q: trimmed.length > 0 ? trimmed : undefined, tab: activeTab },
      replace: true,
    });
  }

  function setTab(next: SearchTab) {
    navigate({ to: "/search", search: { q: q ?? undefined, tab: next }, replace: true });
  }

  useEffect(() => {
    setDraft(q ?? "");
  }, [q]);

  useEffect(() => {
    if (query.length < MIN_SEARCH_LENGTH) {
      setPeople(null);
      setPosts(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setBusy(true);
    setError(null);

    (async () => {
      const [peopleRes, postsRes] = await Promise.all([
        supabase.rpc("search_profiles", { _query: query, _limit: SEARCH_PAGE_SIZE }),
        supabase
          .from("posts")
          .select(
            "id, content, background, comments_enabled, visibility, created_at, edited_at, author:profiles!posts_author_id_fkey(id, handle, display_name, avatar_url, verification_tier)",
          )
          // websearch_to_tsquery: quoted phrases and -exclusions behave the way
          // anyone who has used a search engine expects, and a malformed query
          // returns nothing instead of raising a syntax error the way
          // to_tsquery would.
          .textSearch("search_vector", query, { type: "websearch", config: "english" })
          .order("created_at", { ascending: false })
          .limit(SEARCH_PAGE_SIZE),
      ]);

      if (cancelled) return;
      setBusy(false);

      if (peopleRes.error || postsRes.error) {
        setError("Search is unavailable right now. Try again in a moment.");
        setPeople([]);
        setPosts([]);
        return;
      }

      setPeople((peopleRes.data ?? []) as PersonResult[]);
      setPosts(
        ((postsRes.data ?? []) as unknown as RawPostRow[]).map((p) => ({
          id: p.id,
          content: p.content,
          background: toBackground(p.background),
          comments_enabled: p.comments_enabled ?? true,
          visibility: p.visibility ?? "public",
          created_at: p.created_at,
          edited_at: p.edited_at,
          author: {
            ...p.author,
            verification_tier: p.author.verification_tier as VerificationTier,
          },
        })),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [query]);

  const results = activeTab === "people" ? people : posts;
  const showResults = query.length >= MIN_SEARCH_LENGTH;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <MobileNav />

      <main className="page-enter mx-auto max-w-2xl px-4 pb-mobile-nav pt-5 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="flex items-center gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              // Not autoFocus: on a phone that opens the keyboard over the results
              // the moment the page loads from a shared link.
              placeholder="Search builders and posts…"
              aria-label="Search"
              className="field w-full !pl-9"
            />
          </div>
          <button type="submit" className="btn btn-primary btn-sm shrink-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </button>
        </form>

        <div className="mt-4">
          <div className="segmented sm:max-w-[16rem]">
            {SEARCH_TABS.map((t) => {
              // Each tab shows its OWN count. This read `results.length` — the
              // active tab's array — for both, so sitting on People made Posts
              // report the number of people found.
              const count = t === "people" ? people?.length : posts?.length;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  data-active={activeTab === t}
                  className="segmented-item"
                >
                  {t === "people" ? (
                    <Users className="h-3.5 w-3.5" />
                  ) : (
                    <FileText className="h-3.5 w-3.5" />
                  )}
                  {t === "people" ? "People" : "Posts"}
                  {showResults && count !== undefined ? (
                    <span className="ml-1 tabular-nums opacity-60">{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <div className="mt-5">
            <ErrorState message={error} onRetry={() => submit(draft)} />
          </div>
        )}

        <div className="mt-5">
          {!showResults ? (
            <EmptyState
              icon={SearchIcon}
              title={tooShort ? "Keep typing" : "Search The Ledger"}
              description={
                tooShort
                  ? `Searches need at least ${MIN_SEARCH_LENGTH} characters.`
                  : "Find builders by handle, name, company or bio — or search the text of every post you can see."
              }
            />
          ) : results === null ? (
            activeTab === "posts" ? (
              <PostSkeleton count={3} />
            ) : (
              <PeopleSkeleton />
            )
          ) : results.length === 0 ? (
            <EmptyState
              icon={activeTab === "people" ? Users : FileText}
              title={`No ${activeTab === "people" ? "builders" : "posts"} match “${query}”`}
              description={
                activeTab === "people"
                  ? "Try a shorter query, or part of a handle. Members who have hidden themselves from search won't appear."
                  : "Try different words. Only posts you have access to are searched."
              }
            />
          ) : activeTab === "people" ? (
            <ul className="space-y-2">
              {(results as PersonResult[]).map((p) => (
                <li key={p.id}>
                  <Link
                    to="/u/$handle"
                    params={{ handle: p.handle }}
                    search={{ tab: undefined }}
                    className="card card-interactive flex items-start gap-3 p-4"
                  >
                    <span className="grid h-11 w-11 shrink-0 overflow-hidden rounded-full bg-secondary/60 text-sm font-semibold">
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt=""
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[15px] font-bold text-foreground/70">
                          {p.display_name.charAt(0).toUpperCase()}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-semibold leading-tight text-foreground">
                        {p.display_name}
                        <VerificationBadge
                          tier={p.verification_tier as VerificationTier}
                          size={14}
                        />
                      </span>
                      <span className="mt-0.5 block text-[12px] text-tertiary">
                        @{p.handle}
                        {p.role_type ? ` · ${ROLE_LABEL[p.role_type as RoleType]}` : ""}
                        {p.company_name ? ` · ${p.company_name}` : ""}
                      </span>
                      {p.bio ? (
                        <span className="mt-1.5 line-clamp-2 block text-[13px] leading-relaxed text-secondary">
                          {p.bio}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-3">
              {(results as FeedPost[]).map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUserId={user?.id}
                  onDownload={requestExport}
                  onDeleted={(id) => setPosts((prev) => prev?.filter((x) => x.id !== id) ?? null)}
                  onEdited={(id, content, editedAt) =>
                    setPosts(
                      (prev) =>
                        prev?.map((x) =>
                          x.id === id ? { ...x, content, edited_at: editedAt } : x,
                        ) ?? null,
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {exportSurface}
    </div>
  );
}

function PeopleSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card flex items-start gap-3 p-4">
          <span className="skeleton h-11 w-11 shrink-0 rounded-full" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3.5 w-40 rounded-full" />
            <span className="skeleton block h-3 w-24 rounded-full" />
          </span>
        </div>
      ))}
    </div>
  );
}
