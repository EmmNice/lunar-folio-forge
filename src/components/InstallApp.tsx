import { useEffect, useState } from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { LedgerMark } from "@/components/AppHeader";
import {
  dismissInstallBanner,
  isInstallBannerDismissed,
  promptInstall,
  useInstallState,
} from "@/lib/pwa";

/**
 * One install action for every entry point.
 *
 * Chrome-family browsers give us a real prompt; iOS gives us nothing, so there
 * the action opens a short sheet showing the two taps that do it. `available` is
 * false when neither applies — already installed, or a desktop browser that will
 * not install — and callers render nothing in that case.
 */
export function useInstallAction() {
  const state = useInstallState();
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  async function run() {
    if (state.canPrompt) {
      const outcome = await promptInstall();
      if (outcome === "accepted") toast.success("The Ledger is on your home screen.");
      return;
    }
    if (state.needsIosInstructions) setIosSheetOpen(true);
  }

  return {
    available: state.canPrompt || state.needsIosInstructions,
    run,
    iosSheet: <IosInstallSheet open={iosSheetOpen} onOpenChange={setIosSheetOpen} />,
  };
}

function IosInstallSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl border-t px-6 pt-6"
        style={{
          background: "#0B0B0C",
          borderColor: "rgba(255,255,255,0.08)",
          paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
        }}
      >
        <SheetTitle className="text-[17px] font-semibold tracking-tight">
          Add The Ledger to your home screen
        </SheetTitle>
        <SheetDescription className="mt-1 text-[13px] text-secondary">
          iPhone doesn&apos;t offer a one-tap install, but it only takes two taps.
        </SheetDescription>

        <ol className="mt-5 space-y-4">
          <li className="flex items-center gap-3.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(255,255,255,0.07)" }}
            >
              <Share className="h-[17px] w-[17px] text-sky-400" strokeWidth={1.9} />
            </span>
            <p className="text-[14px] leading-snug">
              Tap <span className="font-semibold">Share</span> in the browser toolbar
            </p>
          </li>
          <li className="flex items-center gap-3.5">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(255,255,255,0.07)" }}
            >
              <SquarePlus className="h-[17px] w-[17px] text-foreground" strokeWidth={1.9} />
            </span>
            <p className="text-[14px] leading-snug">
              Choose <span className="font-semibold">Add to Home Screen</span>
            </p>
          </li>
        </ol>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className="btn btn-primary mt-6 w-full"
        >
          Got it
        </button>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A small, dismissible "Install the app" card at the top of the feed, phones only.
 *
 * The drawer has an Install entry too, but that alone repeats the mistake the
 * admin panel just taught: an option nobody can see is an option nobody uses.
 * This is the visible one. It goes away for two weeks when dismissed, for good
 * once installed, and never appears on desktop, where it would be noise.
 */
export function InstallBanner() {
  const install = useInstallAction();
  // Read after mount: localStorage does not exist during SSR, and reading it in
  // render would make the server and client disagree about the markup.
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(isInstallBannerDismissed()), []);

  if (!install.available || dismissed) return null;

  return (
    <>
      <div
        className="mb-4 flex items-center gap-3 rounded-2xl border p-3 sm:hidden"
        style={{ borderColor: "var(--border)", background: "var(--surface-1)" }}
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: "#0B0B0C", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <LedgerMark className="h-[14px] w-auto" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold leading-tight">Get the app</p>
          <p className="text-[12px] leading-snug text-tertiary">
            Full screen, on your home screen.
          </p>
        </div>
        <button type="button" onClick={install.run} className="btn btn-primary btn-sm shrink-0">
          <Download className="h-3.5 w-3.5" />
          Install
        </button>
        <button
          type="button"
          aria-label="Not now"
          onClick={() => {
            dismissInstallBanner();
            setDismissed(true);
          }}
          className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-tertiary transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {install.iosSheet}
    </>
  );
}
