import { createFileRoute } from "@tanstack/react-router";
import { ProfileHeader } from "@/components/ProfileHeader";
import { StatusStudio } from "@/components/StatusStudio";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Godson Chukwuemeka — Tech Founder" },
      {
        name: "description",
        content:
          "Personal site and Status Studio by Godson Chukwuemeka — design and export share-ready cards for WhatsApp Status and social media.",
      },
      { property: "og:title", content: "Godson Chukwuemeka — Tech Founder" },
      {
        property: "og:description",
        content:
          "Design and export share-ready cards for WhatsApp Status and social media.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 pt-20 pb-32 sm:pt-28">
      <ProfileHeader />
      <hr className="my-12 border-t border-border/70" />
      <StatusStudio />
    </main>
  );
}
