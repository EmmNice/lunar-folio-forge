import { articles, formatArticleDate } from "@/data/articles";

export function ArticleList() {
  return (
    <section aria-labelledby="articles-heading" className="space-y-8">
      <h2
        id="articles-heading"
        className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
      >
        Day One
      </h2>

      <ul className="divide-y divide-border/70">
        {articles.map((a) => (
          <li key={a.id}>
            <a
              href={`#/articles/${a.slug}`}
              className="group grid gap-1 py-5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-baseline sm:gap-6 sm:py-6"
            >
              <time
                dateTime={a.date}
                className="text-xs uppercase tracking-wider text-muted-foreground sm:text-sm sm:normal-case sm:tracking-normal"
              >
                {formatArticleDate(a.date)}
              </time>
              <div className="min-w-0">
                <h3 className="text-base font-semibold tracking-tight text-foreground transition-colors group-hover:text-muted-foreground sm:text-lg">
                  {a.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                  {a.excerpt}
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
