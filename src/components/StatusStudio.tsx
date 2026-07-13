import { useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Download, Loader2 } from "lucide-react";
import { StatusCard } from "./StatusCard";

export function StatusStudio() {
  const [name, setName] = useState("Godson Chukwuemeka");
  const [title, setTitle] = useState("Tech Founder");
  const [content, setContent] = useState(
    "Building quiet software with loud ambition. Notes from the workshop, shipped daily.",
  );
  const [handle, setHandle] = useState("@godson");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportRef = useRef<HTMLDivElement | null>(null);

  async function handleDownload() {
    if (!exportRef.current) return;
    setBusy(true);
    setError(null);
    try {
      const dataUrl = await toPng(exportRef.current, {
        pixelRatio: 1, // node is already 1080x1920
        cacheBust: true,
        backgroundColor: "#0b0b0c",
        width: 1080,
        height: 1920,
      });
      const link = document.createElement("a");
      const safe = (name || "status").toLowerCase().replace(/[^a-z0-9]+/g, "-");
      link.download = `${safe}-status.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to export image.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors focus:border-foreground/40";

  return (
    <section className="space-y-10">
      <div className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Status Studio
        </h2>
        <p className="text-sm text-muted-foreground">
          Type below. The card updates live. Export a 1080×1920 image ready for
          WhatsApp Status.
        </p>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Live preview */}
        <div className="order-2 lg:order-1">
          <div className="mx-auto w-full max-w-[320px]">
            <StatusCard
              name={name}
              title={title}
              content={content}
              handle={handle}
            />
          </div>
        </div>

        {/* Editor */}
        <div className="order-1 space-y-4 lg:order-2">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Name
            </label>
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Title
            </label>
            <input
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Tech Founder"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Handle
            </label>
            <input
              className={field}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground">
              Content
            </label>
            <textarea
              rows={7}
              className={field + " resize-y leading-relaxed"}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your post…"
            />
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Rendering…
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> Download for WhatsApp Status
              </>
            )}
          </button>
          {error ? (
            <p className="text-xs text-red-400">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              PNG · 1080×1920 · optimized for Status &amp; Stories
            </p>
          )}
        </div>
      </div>

      {/* Off-screen full-resolution render used only for export */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          pointerEvents: "none",
          opacity: 0,
          zIndex: -1,
        }}
      >
        <StatusCard
          ref={exportRef}
          name={name}
          title={title}
          content={content}
          handle={handle}
          exportMode
        />
      </div>
    </section>
  );
}
