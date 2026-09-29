import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * An HTTP GET of a URL that a *member* chose, which is a different and more
 * dangerous thing than an HTTP GET of a URL we chose.
 *
 * Verification asks applicants to publish a proof code on a page they control,
 * and then the server goes and reads that page. That makes this server an agent
 * acting on an untrusted address — the classic server-side request forgery
 * setup. From inside the container, `http://169.254.169.254/...` is the cloud
 * metadata endpoint, `http://127.0.0.1:54321` is whatever else is listening
 * locally, and `http://10.x` is the rest of the private network. None of those
 * are reachable from the applicant's browser, which is exactly why they are
 * worth attacking through ours.
 *
 * So the address is checked rather than trusted:
 *
 *   - https only. A proof page served over plaintext could be rewritten in
 *     flight by anyone on the path, which would make the "proof" meaningless
 *     even setting SSRF aside.
 *   - Port 443 only. There is no legitimate proof page on port 22.
 *   - Every IP the hostname resolves to must be a public unicast address. All of
 *     them, not the first — a host with one public and one loopback A record
 *     would otherwise pass.
 *   - Redirects are followed by hand, each hop re-validated from scratch. A
 *     permitted host that 302s to 169.254.169.254 is the standard bypass, and
 *     `fetch`'s automatic redirect following would walk straight into it.
 *   - The body is read through the stream with a byte cap, so a multi-gigabyte
 *     response cannot exhaust memory. `Content-Length` is checked first but not
 *     relied on; it is supplied by the same untrusted server.
 *   - Whole thing is on a timeout.
 *
 * Residual risk, stated rather than papered over: between the DNS check and the
 * TCP connect, the name could be re-resolved to a private address (DNS
 * rebinding). Closing that completely means pinning the validated IP into the
 * socket via a custom dispatcher. The window is small and the practical payoff
 * for an attacker is a blind GET whose body is only ever substring-matched
 * against a proof code and never returned to them, so this is documented as a
 * known limit instead of hidden behind a comment claiming it is airtight.
 */

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 512 * 1024;

export type SafeFetchResult =
  | { ok: true; body: string; finalUrl: string }
  | { ok: false; reason: string };

/**
 * True for addresses that must never be reached on a member's behalf: loopback,
 * RFC1918 private space, link-local (which is where cloud metadata lives),
 * carrier NAT, multicast, and the reserved blocks.
 */
function isBlockedAddress(ip: string): boolean {
  const version = isIP(ip);

  if (version === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b, c] = parts;
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true; // unparseable is not provably public
    }
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local — cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 carrier NAT
    if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
    if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast, reserved, broadcast
    return false;
  }

  if (version === 6) {
    const normalised = ip.toLowerCase();
    if (normalised === "::" || normalised === "::1") return true; // unspecified, loopback
    if (normalised.startsWith("fe8") || normalised.startsWith("fe9")) return true; // link-local
    if (normalised.startsWith("fea") || normalised.startsWith("feb")) return true; // link-local
    if (normalised.startsWith("fc") || normalised.startsWith("fd")) return true; // unique-local
    if (normalised.startsWith("ff")) return true; // multicast
    /*
      IPv4-mapped (::ffff:127.0.0.1) and NAT64 (64:ff9b::/96) both smuggle a v4
      address through a v6 literal, so the embedded address is checked as v4
      rather than assumed safe for being written in v6.
     */
    const embedded = normalised.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (embedded) return isBlockedAddress(embedded[1]);
    if (normalised.startsWith("64:ff9b")) return true;
    if (normalised.startsWith("2002:")) return true; // 6to4
    if (normalised.startsWith("2001:0:") || normalised.startsWith("2001::")) return true; // Teredo
    return false;
  }

  return true; // not an IP at all
}

/** Parses and vets one URL. Returns the reason it was refused, or null if it passed. */
async function refuseReason(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "that does not look like a URL";
  }

  if (url.protocol !== "https:") {
    return "the page must be served over https";
  }
  if (url.port && url.port !== "443") {
    return "only the standard https port is supported";
  }
  if (url.username || url.password) {
    // Credentials in the authority are also how `https://evil.com@10.0.0.1/` gets
    // misread by a human reviewer glancing at the link.
    return "remove the credentials from the URL";
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  // A bare IP literal skips DNS entirely, so it is vetted directly.
  if (isIP(hostname)) {
    return isBlockedAddress(hostname) ? "that address is not publicly reachable" : null;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dnsLookup(hostname, { all: true });
  } catch {
    return "that domain could not be resolved";
  }
  if (addresses.length === 0) return "that domain could not be resolved";

  // Every answer must be public, not merely the first one.
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    return "that address is not publicly reachable";
  }

  return null;
}

/** Reads at most MAX_BODY_BYTES of a response body as UTF-8 text. */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    // Saves pulling the bytes at all when the server is honest about the size.
    // Not a substitute for the streaming cap below: this header is attacker-set.
    return "";
  }

  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        chunks.push(value.subarray(0, value.byteLength - (total - MAX_BODY_BYTES)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

/**
 * GETs a member-supplied URL, or explains why it would not.
 *
 * `reason` is written to be shown to the applicant, so it says what to fix
 * without describing the internal network it just declined to touch.
 */
export async function safeFetchText(rawUrl: string): Promise<SafeFetchResult> {
  let target = rawUrl.trim();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const refused = await refuseReason(target);
    if (refused) return { ok: false, reason: refused };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(target, {
        method: "GET",
        // Followed by hand so every hop goes back through refuseReason above.
        redirect: "manual",
        signal: controller.signal,
        headers: {
          // Identifies the caller honestly. A site owner reading their logs and
          // wondering who fetched their homepage deserves an answer.
          "User-Agent": "TheLedger-VerificationBot/1.0 (+https://theledger.app)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        },
      });
    } catch (error) {
      clearTimeout(timer);
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        reason: aborted ? "that page took too long to respond" : "that page could not be reached",
      };
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "that page redirected to nowhere" };
      // Relative redirects are normal and fine; resolving against the current hop
      // is what makes them safe to re-validate.
      target = new URL(location, target).toString();
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        reason:
          response.status === 404
            ? "that page returned 404 — check the link"
            : `that page returned HTTP ${response.status}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/^(text\/|application\/(json|xhtml\+xml|xml))/i.test(contentType)) {
      return { ok: false, reason: "that link is not a web page" };
    }

    return { ok: true, body: await readCapped(response), finalUrl: target };
  }

  return { ok: false, reason: "that page redirected too many times" };
}

/** Exported for the unit checks in scripts/check-ssrf-guard.mjs. */
export const __ssrfInternals = { isBlockedAddress, refuseReason };
