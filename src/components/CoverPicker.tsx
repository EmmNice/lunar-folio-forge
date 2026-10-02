/**
 * Profile cover photo — the wide banner across the top of a profile, as on X.
 *
 * Uploaded to the existing `avatars` bucket under `{user_id}/cover/`. The bucket's
 * policies already confine writes to the member's own `{user_id}/` folder, and the
 * `cover/` subfolder keeps covers apart from avatars, so AvatarPicker's sweep of
 * old avatar files can never delete the current cover (and vice versa).
 */
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { MAX_AVATAR_BYTES } from "@/lib/limits";
import { tierVisual, type Tier } from "@/lib/tier-style";

export function CoverPicker({
  value,
  onChange,
  tier,
}: {
  value: string;
  onChange: (url: string) => void;
  tier: Tier;
}) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file || !user) return;

    // Same ceiling and the same types the bucket itself enforces.
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(`Image must be under ${Math.round(MAX_AVATAR_BYTES / 1024 / 1024)} MB.`);
      return;
    }
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      toast.error("Use a JPEG, PNG, WebP or GIF image.");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const folder = `${user.id}/cover`;
    const path = `${folder}/${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (uploadErr) {
      setUploading(false);
      toast.error("Upload failed: " + uploadErr.message);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);

    // Remove older covers. The bucket is public, so a replaced cover would
    // otherwise stay reachable at its old URL forever. Best-effort only.
    try {
      const { data: existing } = await supabase.storage.from("avatars").list(folder);
      const stale = (existing ?? [])
        .filter((obj) => obj.id) // folders come back with a null id
        .map((obj) => `${folder}/${obj.name}`)
        .filter((p) => p !== path);
      if (stale.length > 0) await supabase.storage.from("avatars").remove(stale);
    } catch (err) {
      console.warn("[cover] cleanup failed:", err);
    }

    onChange(publicUrl);
    setUploading(false);
    toast.success("Cover uploaded — save to apply.");
  }

  return (
    <div>
      <div
        className="relative aspect-[3/1] w-full overflow-hidden rounded-xl"
        style={{
          background: tierVisual(tier).cover,
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        {value ? (
          <img
            src={value}
            alt="Cover preview"
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : null}
        {uploading ? (
          <div className="absolute inset-0 grid place-items-center bg-black/55">
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          </div>
        ) : null}
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-white/20 hover:bg-white/5 disabled:opacity-50"
          style={{ borderColor: "rgba(255,255,255,0.10)", color: "#B0B0B8" }}
        >
          <ImagePlus className="h-[13px] w-[13px]" />
          {value ? "Change cover" : "Add cover photo"}
        </button>
        {value ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => onChange("")}
            className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[12px] font-medium text-tertiary transition-colors hover:text-red-400 disabled:opacity-50"
          >
            <Trash2 className="h-[13px] w-[13px]" />
            Remove
          </button>
        ) : null}
        <span className="ml-auto text-[11px] text-tertiary">Wide images work best (3:1)</span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

/**
 * The banner itself, used on both the owner's and the public profile view so
 * the two can't drift. Falls back to the tier gradient when no cover is set.
 */
export function ProfileCover({ url, tier }: { url: string | null | undefined; tier: Tier }) {
  return (
    <div
      className="relative aspect-[3/1] max-h-52 w-full overflow-hidden"
      style={{ background: tierVisual(tier).cover }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          // The banner is the first thing painted on a profile; don't lazy-load it.
          loading="eager"
        />
      ) : null}
    </div>
  );
}
