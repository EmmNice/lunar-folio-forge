/**
 * How a person's name and handle are shown together.
 *
 * Most members pick a display name that differs from their handle — "Godson" and
 * `@emmynice` — and showing both is useful. But nothing stops the two being the
 * same, and when they are, the interface reads "itzemmyn @itzemmyn": the same word
 * twice, which looks like a rendering bug even though both values are correct.
 *
 * So the handle is treated as *secondary* information, shown only when it adds
 * something. The comparison ignores case, spacing and punctuation, because
 * "Itz Emmyn" beside "@itzemmyn" is still the same name to whoever is reading it.
 */
export function secondaryHandle(
  displayName: string | null | undefined,
  handle: string,
): string | null {
  const name = (displayName ?? "").trim();
  // No display name to compare against: the handle is all there is to show.
  if (!name) return `@${handle}`;

  const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  return flatten(name) === flatten(handle) ? null : `@${handle}`;
}

/**
 * The name to lead with.
 *
 * Falls back to the handle so a profile with an empty display name still renders
 * something, rather than a badge floating next to nothing.
 */
export function primaryName(displayName: string | null | undefined, handle: string): string {
  const name = (displayName ?? "").trim();
  return name || handle;
}
