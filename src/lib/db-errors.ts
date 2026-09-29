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
  return message;
}
