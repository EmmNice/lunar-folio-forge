import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

const MAX_SKILLS = 20;
const MAX_SKILL_LENGTH = 30;

/**
 * Tag input for languages, frameworks and tools.
 *
 * Normalises to lowercase and de-duplicates, matching the `normalise_skills`
 * trigger exactly — so what the member sees after adding a tag is what the database
 * will store, rather than a value that quietly changes on save.
 *
 * Deliberately free text with no autocomplete against a curated list. A fixed
 * vocabulary would be tidier to query and would also be wrong on day one: the point
 * of this field is to find out what people actually build with. The cost, which is
 * real, is that `nodejs` and `node` are two skills until there is enough data to
 * justify canonicalising them.
 */
export function SkillsInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const skill = raw.trim().toLowerCase().slice(0, MAX_SKILL_LENGTH);
    if (!skill) return;
    if (value.includes(skill)) {
      setDraft("");
      return;
    }
    if (value.length >= MAX_SKILLS) return;
    onChange([...value, skill]);
    setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Comma as well as Enter: people paste "rust, postgres, react".
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
      return;
    }
    // Backspace on an empty field removes the last tag, which is what every other
    // tag input does and what fingers expect.
    if (e.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const full = value.length >= MAX_SKILLS;

  return (
    <div className="space-y-1.5">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-xl p-2"
        style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}
      >
        {value.map((skill) => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium"
            style={{
              background: "rgba(251,191,36,0.12)",
              color: "var(--gold)",
              border: "1px solid rgba(251,191,36,0.22)",
            }}
          >
            {skill}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((s) => s !== skill))}
              aria-label={`Remove ${skill}`}
              className="transition-opacity hover:opacity-70"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          disabled={disabled || full}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          /* Committing on blur too: a half-typed tag left in the box when someone
             hits Save would otherwise be silently discarded. */
          onBlur={() => add(draft)}
          maxLength={MAX_SKILL_LENGTH}
          placeholder={
            full
              ? `${MAX_SKILLS} is the limit`
              : value.length === 0
                ? "rust, postgres, react…"
                : "Add another"
          }
          aria-label="Add a skill"
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-tertiary"
        />
      </div>
      <p className="text-[11px] text-tertiary">
        Enter or comma to add. {value.length}/{MAX_SKILLS} — these are what people search by.
      </p>
    </div>
  );
}
