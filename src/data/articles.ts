export type Article = {
  id: number;
  title: string;
  date: string; // ISO date
  excerpt: string;
  slug: string;
};

// Edit or add your articles here.
export const articles: Article[] = [
  {
    id: 1,
    title: "Designing APIs that feel inevitable",
    date: "2026-07-02",
    excerpt:
      "On naming, defaults, and the quiet craft of building interfaces developers never question.",
    slug: "designing-apis-that-feel-inevitable",
  },
  {
    id: 2,
    title: "The small joy of a well-typed response",
    date: "2026-06-18",
    excerpt:
      "How narrow types at the edges make everything downstream simpler.",
    slug: "the-small-joy-of-a-well-typed-response",
  },
  {
    id: 3,
    title: "Shipping less, more often",
    date: "2026-05-30",
    excerpt: "A month of tiny releases and what changed in the way I work.",
    slug: "shipping-less-more-often",
  },
  {
    id: 4,
    title: "Notes on running a solo software business",
    date: "2026-04-11",
    excerpt:
      "Boring infra, aggressive pricing, and why I stopped writing roadmaps.",
    slug: "notes-on-running-a-solo-software-business",
  },
  {
    id: 5,
    title: "Rate limits are a product decision",
    date: "2026-03-04",
    excerpt: "Treat them like pricing, not plumbing.",
    slug: "rate-limits-are-a-product-decision",
  },
];

export function formatArticleDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}
