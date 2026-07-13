import { Github, Linkedin, Twitter } from "lucide-react";

const socials = [
  { href: "https://github.com", label: "GitHub", Icon: Github },
  { href: "https://linkedin.com", label: "LinkedIn", Icon: Linkedin },
  { href: "https://x.com", label: "X", Icon: Twitter },
];

export function ProfileHeader() {
  return (
    <header className="flex flex-col items-start gap-5">
      <div
        aria-hidden
        className="grid h-16 w-16 shrink-0 place-items-center rounded-full border border-border bg-secondary/60 text-lg font-semibold tracking-tight text-foreground"
      >
        G
      </div>

      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Godson Chukwuemeka
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Tech Founder
        </p>
      </div>

      <nav aria-label="Social links" className="flex items-center gap-1 -ml-2">
        {socials.map(({ href, label, Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={label}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </a>
        ))}
      </nav>
    </header>
  );
}
