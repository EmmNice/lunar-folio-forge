import { createFileRoute } from "@tanstack/react-router";
import { ProfileHeader } from "@/components/ProfileHeader";
import { ArticleList } from "@/components/ArticleList";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Alex Morgan — Software Engineer & API Builder" },
      {
        name: "description",
        content:
          "Personal site and writing by Alex Morgan — a software engineer building APIs, tools, and small software.",
      },
      { property: "og:title", content: "Alex Morgan — Software Engineer & API Builder" },
      {
        property: "og:description",
        content: "Notes on software, APIs, and the craft of shipping.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 pt-20 pb-32 sm:pt-28">
      <ProfileHeader />
      <hr className="my-12 border-t border-border/70" />
      <ArticleList />
    </main>
  );
}
