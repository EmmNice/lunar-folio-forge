import { safeFetchText } from "./safe-fetch.server";

/**
 * The half of verification that a reviewer cannot do by eye.
 *
 * A human looking at `github.com/torvalds` on an application has no way to tell
 * whether the applicant is Linus. Neither does a link checker. The only thing
 * that settles it is asking the applicant to put a value we generated somewhere
 * only the account's owner can write, and then going to look.
 *
 * So each member has a proof code (profiles.verification_proof_code, added in
 * 20260930000300) and verification asks them to publish it:
 *
 *   Silver — in the bio of the GitHub account they are claiming.
 *   Gold   — on the company or portfolio site they are claiming to represent.
 *
 * This module does the looking. It does not decide anything: a passed check is
 * evidence handed to a reviewer, not an automatic approval, because controlling a
 * GitHub account proves identity and not merit. A failed check is not an
 * automatic rejection either — the reason is shown to the applicant so they can
 * fix a typo, and the reviewer can still vouch manually (proof_method 'manual').
 */

export type ProofMethod = "github_bio" | "github_website" | "domain_page" | "manual";

/**
 * Facts measured by the server, as opposed to claims made by the applicant.
 *
 * Every field on a verification application used to be something the applicant
 * typed, including the ones a reviewer would most want corroborated. These are
 * gathered by actually going and looking, and are stored and displayed apart from
 * the applicant's own answers so the two are never confused.
 *
 * Nothing here auto-approves or auto-rejects. A one-repo GitHub account can belong
 * to someone excellent and a thousand-repo account can belong to a bot farm; the
 * numbers are context for a person, not a threshold for a machine.
 */
export type ApplicantSignals = {
  github?: {
    login: string;
    publicRepos: number;
    accountAgeDays: number;
    /** Most recent push across their public repositories, if any. */
    lastPushedAt: string | null;
    followers: number;
  };
  /** Whether each supplied URL actually resolves and serves a page. */
  urls?: { label: string; url: string; reachable: boolean; detail: string }[];
  measuredAt: string;
};

export type ProofOutcome =
  | { verified: true; method: ProofMethod; detail: string }
  | { verified: false; detail: string };

/** GitHub's API host is fixed, so this path is not exposed to SSRF at all. */
const GITHUB_API = "https://api.github.com";

/**
 * Pulls the account name out of a GitHub profile URL.
 *
 * Returns null for anything that is not a plain user or org URL — a repo link, a
 * gist, a github.io page — because the thing being proved is control of an
 * *account*, and those URLs do not identify one unambiguously.
 */
export function githubLoginFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^(www\.)?github\.com$/i.test(url.hostname)) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return null;

  const login = segments[0];
  // GitHub logins: alphanumeric and single hyphens, 39 chars max.
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(login)) return null;
  return login;
}

/**
 * Whether `haystack` publishes `code`.
 *
 * Case-insensitive, and tolerant of the HTML around it: the code may well arrive
 * inside a `<meta>` tag, a footer, or JSON embedded in a page, and all of those
 * are legitimate places to put it. A plain substring search accepts all of them,
 * where parsing for one specific shape would reject most.
 */
function publishes(haystack: string | null | undefined, code: string): boolean {
  if (!haystack) return false;
  if (!isUsableCode(code)) return false;
  return haystack.toLowerCase().includes(code.toLowerCase());
}

/**
 * The shortest code this is allowed to search for.
 *
 * Real codes are `ledger-` plus twelve hex characters, so this is never close to
 * being hit in practice. It exists because the failure mode is silent and total:
 * `haystack.includes("")` is `true` for every string, so an empty code would
 * verify every application against every page, and a one-character code very
 * nearly would. A check that cannot fail is worse than no check, because the
 * reviewer is told there is evidence.
 *
 * Found by a test passing `code: "x"` at a LinkedIn page and watching it pass.
 */
const MIN_CODE_LENGTH = 12;

function isUsableCode(code: string): boolean {
  return typeof code === "string" && code.trim().length >= MIN_CODE_LENGTH;
}

type GithubUser = {
  login?: string;
  bio?: string | null;
  blog?: string | null;
  name?: string | null;
  public_repos?: number;
  followers?: number;
  created_at?: string;
};

/**
 * Checks a Silver claim: does the named GitHub account publish this code?
 *
 * Looks in the bio first, then at the account's website if one is set. The
 * website hop goes through safeFetchText because that URL comes from the
 * applicant's GitHub profile, which is to say from the applicant.
 */
/**
 * Headers for the GitHub API.
 *
 * A token lifts the rate limit from 60 requests an hour per IP to 5,000. Optional:
 * without it the checks still work, they just report honestly when GitHub starts
 * refusing rather than making it look like the applicant's fault.
 */
function githubHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "TheLedger-VerificationBot/1.0",
    ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
  };
}

/** Fetches one GitHub account, or null when the lookup did not succeed. */
async function githubUser(login: string): Promise<GithubUser | null> {
  const response = await fetch(`${GITHUB_API}/users/${encodeURIComponent(login)}`, {
    headers: githubHeaders(),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  return (await response.json()) as GithubUser;
}

/** Newest push across an account's public repositories, or null. */
async function lastPush(login: string): Promise<string | null> {
  try {
    const response = await fetch(
      `${GITHUB_API}/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=1`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return null;
    const repos = (await response.json()) as { pushed_at?: string }[];
    return repos[0]?.pushed_at ?? null;
  } catch {
    return null;
  }
}

/** Days between an ISO timestamp and now, floored. */
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Collects the objective half of an application.
 *
 * Deliberately tolerant: every lookup may fail, and a failure is recorded rather
 * than thrown. A GitHub rate limit, or a site that is down for ten minutes, must
 * not cost somebody their application.
 */
export async function collectSignals(input: {
  githubUrl: string | null;
  urls: { label: string; url: string | null }[];
}): Promise<ApplicantSignals> {
  const signals: ApplicantSignals = { measuredAt: new Date().toISOString() };

  const login = input.githubUrl ? githubLoginFromUrl(input.githubUrl) : null;
  if (login) {
    try {
      const user = await githubUser(login);
      if (user?.created_at) {
        signals.github = {
          login: user.login ?? login,
          publicRepos: user.public_repos ?? 0,
          accountAgeDays: daysSince(user.created_at),
          lastPushedAt: await lastPush(login),
          followers: user.followers ?? 0,
        };
      }
    } catch {
      // Left absent rather than recorded as zero: "we could not look" and "they
      // have no repositories" must not render as the same thing.
    }
  }

  const checked: NonNullable<ApplicantSignals["urls"]> = [];
  for (const entry of input.urls) {
    if (!entry.url) continue;
    const result = await safeFetchText(entry.url);
    checked.push({
      label: entry.label,
      url: entry.url,
      reachable: result.ok,
      detail: result.ok ? `resolved to ${result.finalUrl}` : result.reason,
    });
  }
  if (checked.length > 0) signals.urls = checked;

  return signals;
}

async function checkGithub(githubUrl: string, code: string): Promise<ProofOutcome> {
  const login = githubLoginFromUrl(githubUrl);
  if (!login) {
    return {
      verified: false,
      detail:
        "That does not look like a GitHub profile URL. It should be https://github.com/your-username, with nothing after the username.",
    };
  }

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API}/users/${encodeURIComponent(login)}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return {
      verified: false,
      detail: "GitHub could not be reached to check this. Try again shortly.",
    };
  }

  if (response.status === 404) {
    return { verified: false, detail: `GitHub has no account called “${login}”.` };
  }
  if (response.status === 403 || response.status === 429) {
    return {
      verified: false,
      detail:
        "GitHub rate-limited the check. This is on our side, not yours — try again in a few minutes.",
    };
  }
  if (!response.ok) {
    return { verified: false, detail: `GitHub returned HTTP ${response.status} for that account.` };
  }

  const user = (await response.json()) as GithubUser;

  if (publishes(user.bio, code)) {
    return {
      verified: true,
      method: "github_bio",
      detail: `Code found in the bio of github.com/${user.login ?? login}`,
    };
  }

  if (user.blog) {
    const site = await safeFetchText(
      // GitHub stores the website field as typed, so it is frequently missing a
      // scheme. Assuming https is both the safer default and the only one this
      // fetcher permits.
      /^https?:\/\//i.test(user.blog) ? user.blog : `https://${user.blog}`,
    );
    if (site.ok && publishes(site.body, code)) {
      return {
        verified: true,
        method: "github_website",
        detail: `Code found at ${site.finalUrl}, the website listed on github.com/${user.login ?? login}`,
      };
    }
  }

  return {
    verified: false,
    detail: `github.com/${login} exists, but the code is not in its bio. Add it to your GitHub bio and run the check again.`,
  };
}

/**
 * Checks a Gold claim: does the claimed company or portfolio page publish this code?
 *
 * Tries each supplied URL in turn and reports the first that works. LinkedIn and X
 * both serve bot traffic a login wall, so a failure there is expected and says so
 * rather than implying the applicant did something wrong.
 */
async function checkSite(urls: string[], code: string): Promise<ProofOutcome> {
  const candidates = urls.filter((u): u is string => Boolean(u && u.trim()));
  if (candidates.length === 0) {
    return { verified: false, detail: "No verifiable link was supplied with this application." };
  }

  const failures: string[] = [];

  for (const candidate of candidates) {
    const result = await safeFetchText(candidate);
    if (!result.ok) {
      failures.push(`${hostOf(candidate)}: ${result.reason}`);
      continue;
    }
    if (publishes(result.body, code)) {
      return {
        verified: true,
        method: "domain_page",
        detail: `Code found at ${result.finalUrl}`,
      };
    }
    failures.push(
      isWalledGarden(candidate)
        ? `${hostOf(candidate)}: serves a login wall to automated checks, so it cannot be checked this way`
        : `${hostOf(candidate)}: reachable, but the code is not on the page`,
    );
  }

  return { verified: false, detail: failures.join("; ") };
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return raw.slice(0, 40);
  }
}

function isWalledGarden(raw: string): boolean {
  return /(^|\.)(linkedin\.com|x\.com|twitter\.com|facebook\.com|instagram\.com)$/i.test(
    hostOf(raw),
  );
}

/**
 * Runs the right check for the tier being applied for.
 *
 * Silver is proved through GitHub because that is what Silver is about — someone
 * who ships code. Gold is proved through the company or fund's own web presence,
 * because that is the claim being made.
 */
export async function runProofCheck(input: {
  tier: "silver" | "gold";
  /*
    Which Gold track, because the two prove ownership in different places and
    against different URLs. Without this the check looked only at portfolio and
    LinkedIn — fields the founder track does not collect — so a founder who
    supplied a product and evidence URL was told "no verifiable link was supplied"
    and could never be proven. Observed on the deployed site.
  */
  goldTrack?: "founder" | "backer" | null;
  code: string;
  githubUrl: string | null;
  portfolioUrl: string | null;
  linkedinOrXUrl: string | null;
  liveProjectUrl: string | null;
  tractionEvidenceUrl?: string | null;
}): Promise<ProofOutcome> {
  /*
    Refused before anything is fetched. A malformed code means this account's
    proof code is broken, which is our problem to fix, not something to quietly
    resolve by matching everything.
  */
  if (!isUsableCode(input.code)) {
    return {
      verified: false,
      detail: "This account has no usable proof code, so the check could not run.",
    };
  }

  if (input.tier === "silver") {
    if (!input.githubUrl) {
      return { verified: false, detail: "No GitHub URL was supplied with this application." };
    }
    const viaGithub = await checkGithub(input.githubUrl, input.code);
    if (viaGithub.verified) return viaGithub;

    // A Silver applicant who put the code on their shipped project instead of
    // their bio has still proved they control something they claimed.
    if (input.liveProjectUrl) {
      const viaProject = await checkSite([input.liveProjectUrl], input.code);
      if (viaProject.verified) return viaProject;
    }
    return viaGithub;
  }

  /*
    A founder proves they control the product they claim to have launched, so the
    code goes on the product itself. The evidence page is tried as a fallback —
    somebody who put the code on their public dashboard instead has still
    demonstrated control of something they claimed.
  */
  const goldUrls =
    input.goldTrack === "founder"
      ? [input.liveProjectUrl, input.tractionEvidenceUrl ?? null]
      : [input.portfolioUrl, input.linkedinOrXUrl];

  return checkSite(goldUrls.filter(Boolean) as string[], input.code);
}
