import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldCheck, CheckCircle2, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { timeAgo } from "@/lib/time";
import type { VerificationTier } from "@/hooks/use-auth";
import {
  submitVerificationApplication,
  recheckVerificationProof,
  getVerificationProof,
  resumeVerificationPayment,
} from "@/lib/verification.functions";

/**
 * The verification portal: apply for Silver or Gold, publish the proof code, and
 * see whether the automated check found it.
 *
 * This used to live inside the Edit-profile sheet on the profile page, below the
 * Save button — the only way to reach it was to open a modal about editing your
 * bio and scroll past the whole form. Nobody found it. It has a route of its own
 * now (/verification), and this file exists so that route and the profile page can
 * share one implementation rather than two drifting copies.
 */

/**
 * The choices offered, described by who somebody is rather than by what the tier
 * demands of them. Each maps to a tier and, for Gold, a track.
 */
const CHOICES = [
  {
    key: "builder",
    tier: "silver" as const,
    track: null,
    title: "I build things",
    blurb:
      "A developer, a startup team, a designer, an indie hacker. You write code or ship product.",
  },
  {
    key: "founder",
    tier: "gold" as const,
    track: "founder" as const,
    title: "I've launched, and people use it",
    blurb:
      "Your product is live and has real users and real transactions — not an idea, a waitlist or a landing page.",
  },
  {
    key: "backer",
    tier: "gold" as const,
    track: "backer" as const,
    title: "I invest",
    blurb: "A fund, an angel, or a company that writes cheques into startups.",
  },
] as const;

/** Which kind of Gold somebody is applying for. Mirrors verification_requests.gold_track. */
export type GoldTrack = "founder" | "backer";

/** The shape this component needs from the viewer's own profile. */
export type VerificationProfile = {
  id: string;
  handle: string;
  verification_tier: VerificationTier;
};

type VerificationRequestRow = {
  id: string;
  tier: "silver" | "gold";
  status: "pending" | "approved" | "rejected";
  created_at: string;
  /* Proof state, so the applicant can see whether the automated check found the
     code they published rather than waiting on a human to tell them. */
  proof_verified_at: string | null;
  proof_checked_at: string | null;
  proof_detail: string | null;
  /* 'unpaid' means checkout was never completed, so this is not in the review
     queue and the member is offered the payment again. */
  payment_status: string | null;
  payment_waived_reason: string | null;
};

// URL validation helper
function isValidUrl(value: string): boolean {
  if (!value) return true; // empty = optional, treated as valid (required check is separate)
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function VerificationSection({ profile }: { profile: VerificationProfile }) {
  const { user } = useAuth();
  const doSubmit = useServerFn(submitVerificationApplication);
  const doRecheck = useServerFn(recheckVerificationProof);
  const doResume = useServerFn(resumeVerificationPayment);
  const loadProofCode = useServerFn(getVerificationProof);
  const [activeTab, setActiveTab] = useState<"silver" | "gold">("silver");
  const [requests, setRequests] = useState<VerificationRequestRow[] | null>(null);
  const [proofCode, setProofCode] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [paying, setPaying] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);

  // Track optimistic pending state so form hides immediately after submit
  const [localPending, setLocalPending] = useState<{ silver?: boolean; gold?: boolean }>({});

  // Silver fields
  const [sGithub, setSGithub] = useState("");
  const [sLiveUrl, setSLiveUrl] = useState("");
  const [sContract, setSContract] = useState("");
  const [sShipDesc, setSShipDesc] = useState("");

  // Silver field errors
  const [sGithubErr, setSGithubErr] = useState("");
  const [sLiveUrlErr, setSLiveUrlErr] = useState("");

  // Gold fields
  // Gold branches into two tracks; nothing is preselected, because guessing wrong
  // would quietly put somebody on the wrong set of requirements.
  const [gTrack, setGTrack] = useState<GoldTrack | null>(null);
  // Null until the member says who they are; everything else stays hidden.
  const [chosen, setChosen] = useState<(typeof CHOICES)[number]["key"] | null>(null);
  const [gFundName, setGFundName] = useState("");
  const [gPortfolio, setGPortfolio] = useState("");
  const [gLinkedin, setGLinkedin] = useState("");
  const [gInviteCode, setGInviteCode] = useState("");
  const [gProductUrl, setGProductUrl] = useState("");
  const [gTractionUrl, setGTractionUrl] = useState("");
  const [gTraction, setGTraction] = useState("");
  const [gContract, setGContract] = useState("");
  const [gProductUrlErr, setGProductUrlErr] = useState("");
  const [gTractionUrlErr, setGTractionUrlErr] = useState("");

  // Gold field errors
  const [gPortfolioErr, setGPortfolioErr] = useState("");
  const [gLinkedinErr, setGLinkedinErr] = useState("");

  const [busy, setBusy] = useState(false);

  async function loadRequests() {
    if (!user) return;
    const { data } = await supabase
      .from("verification_requests")
      .select("id, tier, status, created_at, proof_verified_at, proof_checked_at, proof_detail")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setRequests((data ?? []) as VerificationRequestRow[]);
  }

  /*
    The proof code is fetched on demand rather than with the profile, because it is
    not a column `authenticated` can read — it comes back through a server function
    that reads it with the service role for its owner only (20260930000300). Loaded
    once when the panel opens, since it is stable for the life of the account.
  */
  useEffect(() => {
    if (!user || proofCode) return;
    let cancelled = false;
    loadProofCode({})
      .then((result) => {
        if (!cancelled) setProofCode(result.code);
      })
      .catch(() => {
        // Non-fatal: the form still works, the applicant just does not see the
        // code panel. Surfacing a toast here would fire on every profile open.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function copyCode() {
    if (!proofCode) return;
    try {
      await navigator.clipboard.writeText(proofCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // Clipboard access is denied in some embedded browsers; the code is
      // selectable on screen, so this is a convenience failing, not a blocker.
      toast.error("Couldn't copy — select the code and copy it manually.");
    }
  }

  async function resumePayment() {
    if (paying) return;
    setPaying(true);
    try {
      const { url } = await doResume({ data: { tier: activeTab } });
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment could not be started.");
      setPaying(false);
    }
  }

  async function runCheck() {
    if (checking) return;
    setChecking(true);
    try {
      const result = await doRecheck({ data: { tier: activeTab } });
      if (result.verified) {
        toast.success("Ownership confirmed — a reviewer will see this as proven.");
      } else {
        toast.error(result.detail || "The code was not found yet.");
      }
      await loadRequests();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The check could not run.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    loadRequests();
    // Load once per signed-in user; loadRequests is redeclared each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function latestFor(tier: "silver" | "gold") {
    return requests?.find((r) => r.tier === tier) ?? null;
  }

  // Silver validation
  function validateSilver(): boolean {
    let ok = true;
    const g = sGithub.trim();
    if (!g) {
      setSGithubErr("GitHub URL is required.");
      ok = false;
    } else if (!isValidUrl(g)) {
      setSGithubErr("Enter a valid URL starting with https://");
      ok = false;
    } else {
      setSGithubErr("");
    }
    const l = sLiveUrl.trim();
    if (l && !isValidUrl(l)) {
      setSLiveUrlErr("Enter a valid URL starting with https://");
      ok = false;
    } else {
      setSLiveUrlErr("");
    }
    /*
      Silver used to require only a GitHub URL, which enforced "has a GitHub
      account" while claiming to mean "builds things". The database now requires
      evidence of something shipped (vr_silver_needs_something_shipped), so the
      form asks for it in a sentence rather than letting the constraint do the
      talking.
    */
    if (!l && !sContract.trim()) {
      toast.error(
        "Add something you have shipped — a live project URL, or a deployed contract address.",
      );
      ok = false;
    }
    return ok;
  }

  // Gold validation, per track
  function validateGold(): boolean {
    if (!gTrack) {
      toast.error("Choose whether you are applying as a founder or as a backer.");
      return false;
    }
    let ok = true;

    if (gTrack === "founder") {
      const product = gProductUrl.trim();
      if (!product) {
        setGProductUrlErr("The product URL is required.");
        ok = false;
      } else if (!isValidUrl(product)) {
        setGProductUrlErr("Enter a valid URL starting with https://");
        ok = false;
      } else {
        setGProductUrlErr("");
      }

      const evidence = gTractionUrl.trim();
      if (evidence && !isValidUrl(evidence)) {
        setGTractionUrlErr("Enter a valid URL starting with https://");
        ok = false;
      } else {
        setGTractionUrlErr("");
      }
      // One or the other, which is the rule the database enforces as
      // vr_gold_founder_needs_evidence. Told here so the applicant learns it from
      // a sentence rather than from a constraint name.
      if (!evidence && !gContract.trim()) {
        toast.error(
          "Add evidence of real usage: a public analytics page, a store listing, a block explorer link, or your deployed contract address.",
        );
        ok = false;
      }
      return ok;
    }

    if (!gFundName.trim()) {
      toast.error("The backer track needs the name of your fund or company.");
      ok = false;
    }
    const p = gPortfolio.trim();
    if (p && !isValidUrl(p)) {
      setGPortfolioErr("Enter a valid URL starting with https://");
      ok = false;
    } else {
      setGPortfolioErr("");
    }
    const l = gLinkedin.trim();
    if (l && !isValidUrl(l)) {
      setGLinkedinErr("Enter a valid URL starting with https://");
      ok = false;
    } else {
      setGLinkedinErr("");
    }
    if (!p && !l) {
      toast.error("Add a link we can check — your fund's site, a portfolio page, or LinkedIn/X.");
      ok = false;
    }
    return ok;
  }

  async function handleSubmit() {
    if (!user) return;
    const valid = activeTab === "silver" ? validateSilver() : validateGold();
    if (!valid) return;

    setBusy(true);
    // Optimistically mark pending so the form hides right away
    setLocalPending((p) => ({ ...p, [activeTab]: true }));
    try {
      const result = await doSubmit({
        data:
          activeTab === "silver"
            ? {
                tier: "silver" as const,
                github_url: sGithub.trim(),
                deployed_contract_address: sContract.trim(),
                live_project_url: sLiveUrl.trim(),
                recent_ship_desc: sShipDesc.trim(),
              }
            : {
                tier: "gold" as const,
                gold_track: gTrack ?? undefined,
                // Founder fields reuse live_project_url and the contract address —
                // the same columns Silver uses for "something shipped", because it
                // is the same kind of evidence judged against a higher bar.
                live_project_url: gTrack === "founder" ? gProductUrl.trim() : "",
                deployed_contract_address: gTrack === "founder" ? gContract.trim() : "",
                traction_evidence_url: gTrack === "founder" ? gTractionUrl.trim() : "",
                traction_summary: gTrack === "founder" ? gTraction.trim() : "",
                fund_or_company_name: gTrack === "backer" ? gFundName.trim() : "",
                portfolio_url: gTrack === "backer" ? gPortfolio.trim() : "",
                linkedin_or_x_url: gTrack === "backer" ? gLinkedin.trim() : "",
                invite_code: gTrack === "backer" ? gInviteCode.trim() : "",
              },
      });
      /*
        When a fee is due, Stripe is the next step rather than the review queue —
        the application exists but is 'unpaid' until the webhook says otherwise, so
        sending the member anywhere else would leave it stranded.
      */
      if (result?.checkoutUrl) {
        toast.success("Application saved — taking you to payment.");
        window.location.href = result.checkoutUrl;
        return;
      }
      toast.success("Application submitted — your credentials are now under review.");
      await loadRequests();
    } catch (e) {
      // Revert optimistic update on failure
      setLocalPending((p) => ({ ...p, [activeTab]: false }));
      toast.error(e instanceof Error ? e.message : "Submission failed.");
    } finally {
      setBusy(false);
    }
  }

  // Resolved states for each tier
  const silverLatest = latestFor("silver");
  const goldLatest = latestFor("gold");
  const isSilverVerified =
    profile.verification_tier === "silver" || profile.verification_tier === "gold";
  const isGoldVerified = profile.verification_tier === "gold";

  const activeLatest = activeTab === "silver" ? silverLatest : goldLatest;
  const activeVerified = activeTab === "silver" ? isSilverVerified : isGoldVerified;
  const isPending = activeLatest?.status === "pending" || !!localPending[activeTab];
  const isRejected = activeLatest?.status === "rejected";
  const canApply = !activeVerified && !isPending;

  // Tier styles
  const silverStyle = {
    card: "glass-silver",
    accent: "#94a3b8",
    accentBright: "#cbd5e1",
    iconBg: "rgba(148,163,184,0.12)",
    title: "#cbd5e1",
    subtitle: "rgba(148,163,184,0.65)",
    desc: "rgba(148,163,184,0.70)",
    btnBorder: "rgba(148,163,184,0.35)",
    btnBg: "rgba(148,163,184,0.04)",
    btnHoverBg: "rgba(148,163,184,0.12)",
  };
  const goldStyle = {
    card: "glass-gold",
    accent: "#fbbf24",
    accentBright: "#fde68a",
    iconBg: "rgba(251,191,36,0.12)",
    title: "#fde68a",
    subtitle: "rgba(251,191,36,0.55)",
    desc: "rgba(251,191,36,0.60)",
    btnBorder: "rgba(251,191,36,0.40)",
    btnBg: "rgba(251,191,36,0.04)",
    btnHoverBg: "rgba(251,191,36,0.12)",
  };
  const ts = activeTab === "silver" ? silverStyle : goldStyle;

  return (
    <div className="space-y-4">
      {/*
        Choose who you are before seeing what is being asked of you.

        This was a tab switcher sitting above a form that listed both tiers'
        requirements at once. Reading the requirements first is the wrong way round:
        it invites people to pick the tier whose checklist looks easiest rather than
        the one that describes them, and it puts a wall of criteria in front of
        somebody who has not yet decided they are applying. Nothing about the
        requirements is shown until a choice is made.
      */}
      {!chosen ? (
        <div className="space-y-2.5">
          <p className="text-[13px] font-medium text-foreground">Which of these are you?</p>
          {CHOICES.map((choice) => {
            const held =
              (choice.tier === "silver" && isSilverVerified) ||
              (choice.tier === "gold" && isGoldVerified);
            return (
              <button
                key={choice.key}
                type="button"
                disabled={held}
                onClick={() => {
                  setActiveTab(choice.tier);
                  setGTrack(choice.track);
                  setChosen(choice.key);
                }}
                className="w-full rounded-2xl p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 enabled:hover:bg-white/[0.03]"
                style={{ border: "1px solid rgba(255,255,255,0.09)" }}
              >
                <span className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-foreground">{choice.title}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase"
                    style={{
                      color: choice.tier === "silver" ? "#cbd5e1" : "#fde68a",
                      background:
                        choice.tier === "silver"
                          ? "rgba(148,163,184,0.12)"
                          : "rgba(251,191,36,0.12)",
                    }}
                  >
                    {choice.tier}
                  </span>
                  {held && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                </span>
                <span className="mt-1 block text-[12px] leading-relaxed text-tertiary">
                  {held ? "You already hold this badge." : choice.blurb}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setChosen(null)}
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Not you? Choose again
        </button>
      )}

      {chosen && (
        <>
          {/* Active track card */}
          <div className={`${ts.card} rounded-2xl p-5 space-y-4`}>
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold" style={{ color: ts.title }}>
                  {activeTab === "silver" ? "Silver — Builders" : "Gold — Launched & Backing"}
                </p>
                <p className="text-[11px]" style={{ color: ts.subtitle }}>
                  {activeTab === "silver"
                    ? "Developers, startups, designers — anyone shipping"
                    : "Founders with real traction, and the people who fund them"}
                </p>
              </div>
              {activeVerified && (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Verified
                </div>
              )}
            </div>

            {/* Already verified — nothing more to do */}
            {activeVerified && (
              <div
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  background: "rgba(34,197,94,0.06)",
                  border: "1px solid rgba(34,197,94,0.15)",
                  color: "#4ade80",
                }}
              >
                You already hold {activeTab === "silver" ? "Silver (or higher)" : "Gold"}{" "}
                verification — no action needed.
              </div>
            )}

            {/* Pending state — form hidden, show waiting message */}
            {!activeVerified && isPending && (
              <div className="space-y-3">
                {/*
                  An unpaid application is not in the review queue, so telling its
                  owner it is "under review" would be false — and they would wait
                  for a decision on something no reviewer can see.
                */}
                {activeLatest?.payment_status === "unpaid" ? (
                  <div
                    className="rounded-xl px-4 py-3 text-sm"
                    style={{
                      background: "rgba(248,113,113,0.07)",
                      border: "1px solid rgba(248,113,113,0.22)",
                      color: "#f87171",
                    }}
                  >
                    <p className="font-medium">Payment not finished</p>
                    <p className="mt-1 text-xs opacity-80">
                      Your answers are saved, but the $1 review fee hasn't gone through — so this
                      hasn't reached a reviewer yet.
                    </p>
                    <button
                      type="button"
                      onClick={resumePayment}
                      disabled={paying}
                      className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50"
                      style={{ border: "1px solid rgba(248,113,113,0.35)" }}
                    >
                      {paying && <Loader2 className="h-3 w-3 animate-spin" />}
                      {paying ? "Opening checkout…" : "Finish paying $1"}
                    </button>
                  </div>
                ) : (
                  <div
                    className="rounded-xl px-4 py-3 text-sm"
                    style={{
                      background: "rgba(251,191,36,0.06)",
                      border: "1px solid rgba(251,191,36,0.20)",
                      color: "#fbbf24",
                    }}
                  >
                    <p className="font-medium">Application under review</p>
                    <p className="mt-1 text-xs opacity-80">
                      Your {activeTab === "silver" ? "Silver" : "Gold"} application has been
                      received. You'll get a notification here once a reviewer has looked at it.
                    </p>
                  </div>
                )}
                {activeLatest && (
                  <p className="text-[11px]" style={{ color: ts.subtitle }}>
                    Submitted {timeAgo(activeLatest.created_at)}
                  </p>
                )}
                <ProofPanel
                  code={proofCode}
                  tier={activeTab}
                  request={activeLatest}
                  checking={checking}
                  onCheck={runCheck}
                  copied={codeCopied}
                  onCopy={copyCode}
                  style={ts}
                />
              </div>
            )}

            {/* Application form — only shown when user can still apply */}
            {canApply && (
              <>
                {activeTab === "silver" && (
                  <ul className="space-y-1 text-[11px] leading-relaxed" style={{ color: ts.desc }}>
                    <li>· Your GitHub profile, with the proof code in its bio</li>
                    <li>· One thing you have shipped: a live URL or a deployed contract</li>
                    <li>· A line on what you worked on recently</li>
                  </ul>
                )}
                {/*
                  There was a track-blind paragraph here that branched only on
                  silver-vs-gold, so a founder was told to "provide your fund or
                  company name" — the backer instructions, on the wrong track.
                  Removed rather than given a third branch: Silver has its bullet
                  list above, and each Gold track opens with its own description, so
                  this was duplicating one of them and contradicting the other.
                */}

                {/*
              The fee, stated plainly before the form rather than sprung at the end.
              $1 is not a revenue line — it is a card that clears, which is a weak
              identity signal, and it stops the review queue being free to flood.
            */}
                <p
                  className="rounded-xl px-3 py-2 text-[11px] leading-relaxed"
                  style={{ background: "rgba(255,255,255,0.03)", color: ts.desc }}
                >
                  <span className="font-semibold" style={{ color: ts.accent }}>
                    $1 to apply.
                  </span>{" "}
                  One-off, for either badge, charged when you submit. It pays for the review, not
                  the result — a rejected application is not refunded, and you can reapply after 7
                  days.
                </p>

                {/* Publish-the-code step, shown before the form rather than after, because
                doing it first means the application arrives already proven. */}
                <ProofPanel
                  code={proofCode}
                  tier={activeTab}
                  request={null}
                  checking={false}
                  onCheck={null}
                  copied={codeCopied}
                  onCopy={copyCode}
                  style={ts}
                />

                {/* Status pill for rejected state */}
                {isRejected && activeLatest && (
                  <div
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
                    style={{ background: "rgba(239,68,68,0.10)", color: "#f87171" }}
                  >
                    ✕ Previous application not approved — you can reapply below
                    <span className="opacity-60">· {timeAgo(activeLatest.created_at)}</span>
                  </div>
                )}

                {/* Silver form */}
                {activeTab === "silver" && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: ts.subtitle }}
                      >
                        GitHub Profile URL <span style={{ color: ts.accent }}>*</span>
                      </label>
                      <input
                        className={`lux-field${sGithubErr ? " border-red-500/60 focus:border-red-500" : ""}`}
                        placeholder="https://github.com/yourhandle"
                        value={sGithub}
                        onChange={(e) => {
                          setSGithub(e.target.value);
                          if (sGithubErr) setSGithubErr("");
                        }}
                        onBlur={() => {
                          const v = sGithub.trim();
                          if (!v) setSGithubErr("GitHub URL is required.");
                          else if (!isValidUrl(v))
                            setSGithubErr("Enter a valid URL starting with https://");
                          else setSGithubErr("");
                        }}
                      />
                      {sGithubErr && <p className="text-[11px] text-red-400">{sGithubErr}</p>}
                    </div>
                    <div className="space-y-1">
                      <label
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: ts.subtitle }}
                      >
                        Live DApp / Project URL
                      </label>
                      <input
                        className={`lux-field${sLiveUrlErr ? " border-red-500/60 focus:border-red-500" : ""}`}
                        placeholder="https://yourproject.xyz"
                        value={sLiveUrl}
                        onChange={(e) => {
                          setSLiveUrl(e.target.value);
                          if (sLiveUrlErr) setSLiveUrlErr("");
                        }}
                        onBlur={() => {
                          const v = sLiveUrl.trim();
                          if (v && !isValidUrl(v))
                            setSLiveUrlErr("Enter a valid URL starting with https://");
                          else setSLiveUrlErr("");
                        }}
                      />
                      {sLiveUrlErr && <p className="text-[11px] text-red-400">{sLiveUrlErr}</p>}
                    </div>
                    <div className="space-y-1">
                      <label
                        className="text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: ts.subtitle }}
                      >
                        Deployed Contract Address{" "}
                        <span className="normal-case opacity-60">(optional)</span>
                      </label>
                      <input
                        className="lux-field font-mono text-xs"
                        placeholder="0x…"
                        value={sContract}
                        onChange={(e) => setSContract(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <label
                        className="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider"
                        style={{ color: ts.subtitle }}
                      >
                        <span>What did you ship this week?</span>
                        <span style={{ color: sShipDesc.length > 90 ? "#f87171" : ts.subtitle }}>
                          {sShipDesc.length}/100
                        </span>
                      </label>
                      <textarea
                        className="lux-field resize-none"
                        rows={2}
                        placeholder="One sentence — the more specific the better."
                        maxLength={100}
                        value={sShipDesc}
                        onChange={(e) => setSShipDesc(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Gold form. Which track was already chosen on the opening screen. */}
                {activeTab === "gold" && (
                  <div className="space-y-4">
                    {gTrack === "founder" && (
                      <div className="space-y-3">
                        <p className="text-[11px] leading-relaxed" style={{ color: ts.desc }}>
                          Gold is for products that are live and being used — not a landing page,
                          not a waitlist. We need the product itself, and one place a reviewer can
                          go to see that people are actually using it.
                        </p>
                        <Field
                          label="Live product URL"
                          required
                          accent={ts.accent}
                          subtitle={ts.subtitle}
                          placeholder="https://yourproduct.com"
                          value={gProductUrl}
                          error={gProductUrlErr}
                          onChange={(v) => {
                            setGProductUrl(v);
                            if (gProductUrlErr) setGProductUrlErr("");
                          }}
                          onBlur={() => {
                            const v = gProductUrl.trim();
                            if (!v) setGProductUrlErr("The product URL is required.");
                            else if (!isValidUrl(v))
                              setGProductUrlErr("Enter a valid URL starting with https://");
                            else setGProductUrlErr("");
                          }}
                        />
                        <Field
                          label="Evidence of real usage"
                          required
                          accent={ts.accent}
                          subtitle={ts.subtitle}
                          placeholder="https://… analytics, store listing, or block explorer"
                          hint="Somewhere public: a shared analytics dashboard, an App Store or Play Store listing with reviews, a block explorer page for your contract, or a status page. A deployed contract address below also counts."
                          value={gTractionUrl}
                          error={gTractionUrlErr}
                          onChange={(v) => {
                            setGTractionUrl(v);
                            if (gTractionUrlErr) setGTractionUrlErr("");
                          }}
                          onBlur={() => {
                            const v = gTractionUrl.trim();
                            if (v && !isValidUrl(v))
                              setGTractionUrlErr("Enter a valid URL starting with https://");
                            else setGTractionUrlErr("");
                          }}
                        />
                        <div className="space-y-1">
                          <label
                            className="text-[11px] font-medium uppercase tracking-wider"
                            style={{ color: ts.subtitle }}
                          >
                            Your numbers{" "}
                            <span className="normal-case opacity-60">(as you report them)</span>
                          </label>
                          <textarea
                            className="lux-field min-h-[70px] resize-y"
                            placeholder="1,400 weekly active users. $38k settled last month. 60 paying customers."
                            maxLength={280}
                            value={gTraction}
                            onChange={(e) => setGTraction(e.target.value)}
                          />
                          <p className="text-[10px]" style={{ color: ts.desc }}>
                            {gTraction.length}/280 · We cannot verify these, and they are shown to
                            reviewers as your claim. The link above is what carries weight.
                          </p>
                        </div>
                        <Field
                          label="Deployed contract address"
                          accent={ts.accent}
                          subtitle={ts.subtitle}
                          placeholder="0x…"
                          hint="Optional, and counts as evidence of usage on its own."
                          value={gContract}
                          error=""
                          onChange={setGContract}
                        />
                      </div>
                    )}

                    {gTrack === "backer" && (
                      <div className="space-y-3">
                        <p className="text-[11px] leading-relaxed" style={{ color: ts.desc }}>
                          For funds, angels and companies that invest. We need the entity's name and
                          one link a reviewer can check — then the proof code published on that
                          site.
                        </p>
                        <div className="space-y-1">
                          <label
                            className="text-[11px] font-medium uppercase tracking-wider"
                            style={{ color: ts.subtitle }}
                          >
                            Fund or company name <span style={{ color: ts.accent }}>*</span>
                          </label>
                          <input
                            className="lux-field"
                            placeholder="Acme Ventures"
                            value={gFundName}
                            onChange={(e) => setGFundName(e.target.value)}
                          />
                        </div>
                        <Field
                          label="Fund or portfolio website"
                          accent={ts.accent}
                          subtitle={ts.subtitle}
                          placeholder="https://acmeventures.com"
                          hint="This or a LinkedIn/X profile is required — the site is stronger, because the proof code can be published on it."
                          value={gPortfolio}
                          error={gPortfolioErr}
                          onChange={(v) => {
                            setGPortfolio(v);
                            if (gPortfolioErr) setGPortfolioErr("");
                          }}
                          onBlur={() => {
                            const v = gPortfolio.trim();
                            if (v && !isValidUrl(v))
                              setGPortfolioErr("Enter a valid URL starting with https://");
                            else setGPortfolioErr("");
                          }}
                        />
                        <Field
                          label="LinkedIn or X profile"
                          accent={ts.accent}
                          subtitle={ts.subtitle}
                          placeholder="https://linkedin.com/in/yourname"
                          value={gLinkedin}
                          error={gLinkedinErr}
                          onChange={(v) => {
                            setGLinkedin(v);
                            if (gLinkedinErr) setGLinkedinErr("");
                          }}
                          onBlur={() => {
                            const v = gLinkedin.trim();
                            if (v && !isValidUrl(v))
                              setGLinkedinErr("Enter a valid URL starting with https://");
                            else setGLinkedinErr("");
                          }}
                        />
                        <div className="space-y-1">
                          <label
                            className="text-[11px] font-medium uppercase tracking-wider"
                            style={{ color: ts.subtitle }}
                          >
                            Invite code{" "}
                            <span className="normal-case opacity-60">
                              (optional — speeds up review)
                            </span>
                          </label>
                          <input
                            className="lux-field font-mono text-xs tracking-widest"
                            placeholder="LEDGER-XXXX"
                            value={gInviteCode}
                            onChange={(e) => setGInviteCode(e.target.value.toUpperCase())}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-40"
                  style={{
                    border: `1px solid ${ts.btnBorder}`,
                    color: ts.accent,
                    background: ts.btnBg,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = ts.btnHoverBg;
                    e.currentTarget.style.color = ts.accentBright;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = ts.btnBg;
                    e.currentTarget.style.color = ts.accent;
                  }}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4" />
                  )}
                  {isRejected
                    ? "Reapply"
                    : `Apply for ${activeTab === "silver" ? "Silver" : "Gold"}`}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The applicant-facing proof-of-ownership step.
 *
 * Before this existed, verification asked for a GitHub URL and nothing tied the
 * URL to the applicant — `github.com/torvalds` was a complete, valid Silver
 * application, and a reviewer looking at it had no way to tell. The fix is not a
 * better-looking form: it is asking the applicant to publish a value we generated
 * somewhere only the real owner can write, then going to read it.
 *
 * Shown in two places, doing two jobs with the same panel: before applying it is
 * the instruction, and while pending it is the result plus a way to re-run the
 * check after fixing a typo. `onCheck` being null is what distinguishes them.
 */
function ProofPanel({
  code,
  tier,
  request,
  checking,
  onCheck,
  copied,
  onCopy,
  style,
}: {
  code: string | null;
  tier: "silver" | "gold";
  request: VerificationRequestRow | null;
  checking: boolean;
  onCheck: (() => void) | null;
  copied: boolean;
  onCopy: () => void;
  style: { accent: string; subtitle: string; desc: string; btnBorder: string; btnBg: string };
}) {
  // The code is loaded separately from the profile, so it can briefly be absent.
  // Rendering an empty box with a copy button that copies nothing is worse than
  // rendering nothing.
  if (!code) return null;

  const proven = Boolean(request?.proof_verified_at);
  const checked = Boolean(request?.proof_checked_at);

  const where =
    tier === "silver"
      ? "the Bio field of your GitHub profile"
      : "your company or portfolio homepage — anywhere in the page, including a meta tag";

  return (
    <div
      className="space-y-3 rounded-xl p-4"
      style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${style.btnBorder}` }}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: style.accent }} />
        <div className="space-y-1">
          <p className="text-[13px] font-semibold" style={{ color: style.accent }}>
            Prove the account is yours
          </p>
          <p className="text-[11px] leading-relaxed" style={{ color: style.desc }}>
            Add this code to {where}. We check for it automatically — it's what separates your
            application from someone pasting your link.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <code
          className="flex-1 overflow-x-auto rounded-lg px-3 py-2 font-mono text-[12px] select-all"
          style={{
            background: "rgba(0,0,0,0.30)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#F5F5F6",
          }}
        >
          {code}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 rounded-lg px-2.5 py-2 transition-colors"
          style={{ background: style.btnBg, color: style.accent }}
          aria-label="Copy proof code"
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>

      {/* Result, once there is one to show. */}
      {request && (
        <div className="space-y-2">
          {proven ? (
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Ownership confirmed. A reviewer sees this application as proven.
            </p>
          ) : (
            <p className="text-[11px]" style={{ color: style.desc }}>
              {/* "Not checked yet" and "checked, and the code wasn't there" are
                  different situations and the applicant can act on the second. */}
              {checked
                ? (request.proof_detail ?? "The code wasn't found yet.")
                : "Not checked yet."}
            </p>
          )}

          {onCheck && !proven && (
            <button
              type="button"
              onClick={onCheck}
              disabled={checking}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50"
              style={{ border: `1px solid ${style.btnBorder}`, color: style.accent }}
            >
              {checking ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {checking ? "Checking…" : "Check again"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One labelled text input with an optional hint and error.
 *
 * The Gold form went from four fields to nine across two tracks, and repeating the
 * label/input/error markup nine times is how the tracks end up subtly
 * inconsistent with each other.
 */
function Field({
  label,
  required,
  accent,
  subtitle,
  placeholder,
  hint,
  value,
  error,
  onChange,
  onBlur,
}: {
  label: string;
  required?: boolean;
  accent: string;
  subtitle: string;
  placeholder: string;
  hint?: string;
  value: string;
  error: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  return (
    <div className="space-y-1">
      <label
        className="text-[11px] font-medium tracking-wider uppercase"
        style={{ color: subtitle }}
      >
        {label} {required && <span style={{ color: accent }}>*</span>}
      </label>
      <input
        className={`lux-field${error ? " border-red-500/60 focus:border-red-500" : ""}`}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      {hint && !error && (
        <p className="text-[10px] leading-relaxed" style={{ color: subtitle }}>
          {hint}
        </p>
      )}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
