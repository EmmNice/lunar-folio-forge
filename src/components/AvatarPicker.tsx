/**
 * AvatarPicker
 *
 * Lets the user either:
 *  1. Upload a photo from their device → Supabase Storage → public URL
 *  2. Pick a Web3-style pixel-art avatar from a curated set (DiceBear)
 *
 * Requires the `avatars` Supabase Storage bucket to be created.
 * See supabase/migrations/20260718_storage_avatars.sql
 */
import { useRef, useState } from "react";
import { Camera, Sparkles, Loader2, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

// DiceBear pixel-art — v7.x is stable
const DB = "https://api.dicebear.com/7.x/pixel-art/svg";

// 24 curated seeds with Web3 culture names — each generates a unique PFP
const NFT_SEEDS = [
  "satoshi",   "vitalik",  "nakamoto", "genesis",
  "defi",      "nouns",    "cryptonaut","wagmi",
  "dao",       "degen",    "gm",        "lfg",
  "hodler",    "fren",     "anon",      "based",
  "alpha",     "sigma",    "zkproof",   "l2giant",
  "ethmaxi",   "builder",  "founder",   "shiller",
];

function nftUrl(seed: string) {
  return `${DB}?seed=${encodeURIComponent(seed)}&backgroundColor=0b0b0c`;
}

export function AvatarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (url: string) => void;
}) {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showNft, setShowNft] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5 MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are allowed.");
      return;
    }

    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${user.id}/${Date.now()}.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadErr) {
      toast.error("Upload failed: " + uploadErr.message);
      setUploading(false);
      return;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("avatars").getPublicUrl(path);

    onChange(publicUrl);
    setUploading(false);
    toast.success("Photo uploaded — save to apply.");

    // Reset file input so same file can be re-selected
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="space-y-3">
      {/* Avatar circle + action row */}
      <div className="flex items-center gap-4">
        {/* Live preview */}
        <div
          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full"
          style={{
            background: "rgba(255,255,255,0.06)",
            boxShadow: "0 0 0 2px rgba(255,255,255,0.12), 0 0 0 3.5px #0B0B0C",
          }}
        >
          {value ? (
            <img
              src={value}
              alt="Avatar preview"
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted-foreground/40">
              <Camera className="h-6 w-6" />
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-2">
          {/* Upload from device */}
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:border-white/20 hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: "rgba(255,255,255,0.10)", color: "#B0B0B8" }}
          >
            <Camera className="h-[13px] w-[13px]" />
            Upload photo
          </button>

          {/* NFT style toggle */}
          <button
            type="button"
            onClick={() => setShowNft((s) => !s)}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-amber-400/5"
            style={{
              borderColor: showNft ? "rgba(251,191,36,0.50)" : "rgba(251,191,36,0.25)",
              color: "#FBBF24",
            }}
          >
            <Sparkles className="h-[13px] w-[13px]" />
            NFT style
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* NFT pixel-art picker */}
      {showNft && (
        <div
          className="rounded-2xl p-3"
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {/* Header */}
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
              Web3 Pixel PFPs
            </p>
            <button
              type="button"
              onClick={() => setShowNft(false)}
              className="text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Grid — 6 columns */}
          <div className="grid grid-cols-6 gap-2">
            {NFT_SEEDS.map((seed) => {
              const url = nftUrl(seed);
              const isSelected = value === url;
              return (
                <button
                  key={seed}
                  type="button"
                  title={`@${seed}`}
                  onClick={() => {
                    onChange(url);
                    setShowNft(false);
                  }}
                  className="group relative aspect-square overflow-hidden rounded-full transition-transform hover:scale-110 active:scale-95"
                  style={{
                    background: "#0B0B0C",
                    boxShadow: isSelected
                      ? "0 0 0 2.5px #FBBF24, 0 0 0 4px #0B0B0C"
                      : "0 0 0 1.5px rgba(255,255,255,0.10)",
                  }}
                >
                  <img
                    src={url}
                    alt={seed}
                    className="h-full w-full"
                    loading="lazy"
                    style={{ imageRendering: "pixelated" }}
                  />
                  {isSelected && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                      <Check className="h-3 w-3 text-amber-400" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <p className="mt-2.5 text-[10px] text-muted-foreground/50">
            Pixel-art avatars generated on-chain style. Select one then hit Save Changes.
          </p>
        </div>
      )}
    </div>
  );
}
