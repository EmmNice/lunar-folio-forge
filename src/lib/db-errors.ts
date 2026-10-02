/**
 * Turns a Postgres/PostgREST error into something a member can act on.
 *
 * Several write paths used to surface `error.message` verbatim, which meant a
 * blocked action reported itself as "new row violates row-level security policy
 * for table \"posts\"". That is precise and unusable. Now that RLS carries real
 * product rules — moderation state, post audience, closed comment threads — these
 * messages are something a normal member can actually hit, so they need to say
 * what happened.
 */
export function describeWriteError(message: string, action: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("row-level security") || lower.includes("violates row-level")) {
    return `Your account isn't allowed to ${action} right now.`;
  }
  if (lower.includes("duplicate key")) {
    return "You've already done that.";
  }
  if (lower.includes("background_kind")) {
    return "That card theme isn't available.";
  }
  if (lower.includes("posts_visibility_valid") || lower.includes("can_publish_to")) {
    return "Your verification tier doesn't cover that audience.";
  }
  if (lower.includes("content_len")) {
    return "That's too long to post.";
  }
  if (lower.includes("_scheme")) {
    return "Links must start with http:// or https://";
  }
  // Edit window and pinning (20260930001000, 20260930001100). Matched before the
  // generic RLS case would never see them — these are raised by triggers with
  // 42501, not by a policy, so the RLS text above does not apply.
  if (lower.includes("can only be edited within")) {
    return "Posts can only be edited for 10 minutes after publishing. You can still delete it.";
  }
  if (lower.includes("only pin your own post")) {
    return "You can only pin your own post.";
  }
  if (lower.includes("only a public post can be pinned")) {
    return "Only a public post can be pinned to your profile.";
  }
  // Verification application rules (20260930000300). A member who trips one of
  // these was previously shown the constraint name.
  if (lower.includes("vr_silver_needs_github")) {
    return "Silver verification needs a link to your GitHub profile.";
  }
  // Tier and track requirements (20260930000700).
  if (lower.includes("vr_silver_needs_something_shipped")) {
    return "Silver needs something you have shipped — a live project URL or a deployed contract address.";
  }
  if (lower.includes("vr_gold_track_required") || lower.includes("vr_gold_track_valid")) {
    return "Choose whether you are applying to Gold as a founder or as a backer.";
  }
  if (lower.includes("vr_gold_founder_needs_evidence")) {
    return "The founder track needs the product's URL plus evidence of real usage — analytics, a store listing, a block explorer link, or a deployed contract address.";
  }
  if (lower.includes("vr_gold_backer_needs_evidence")) {
    return "The backer track needs your fund or company name plus a link we can check.";
  }
  if (lower.includes("vr_traction_summary_len")) {
    return "The traction summary is too long — keep it under 280 characters.";
  }
  if (lower.includes("link_primary_len") || lower.includes("link_secondary_len")) {
    return "One of those links is too long.";
  }
  if (lower.includes("recent_ship_desc_len")) {
    return "The description of what you shipped is too long.";
  }
  if (lower.includes("reapply") || lower.includes("7 days after a rejection")) {
    return message; // already a sentence written for the applicant
  }
  return message;
}
