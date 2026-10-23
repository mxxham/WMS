"use client";

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePersonName } from "@/components/app/person-name";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { cn, fmtNum } from "@/lib/utils";
import { X, Image as ImageIcon, AlertCircle, CheckCircle, Camera } from "lucide-react";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface EvidenceUploadProps {
  jobId: string;
  kind: "BEFORE" | "AFTER" | "OTHER";
  /** Person to record as uploader (required: typed name on shared account, else account name). */
  byName?: string;
  disabled?: boolean;
  onError?: (msg: string) => void;
}

export function EvidenceUpload({ jobId, kind, byName, disabled = false, onError }: EvidenceUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Device-remembered name (shared account keeps the typed, device-remembered name)
  const [personName] = usePersonName();
  const uploaderName = (byName ?? personName ?? "").trim();

  // Object URL for a real thumbnail; revoked when the file changes or unmounts.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const validateFile = useCallback((f: File): string | null => {
    if (!ALLOWED_TYPES.includes(f.type)) {
      return "Format file tidak didukung. Gunakan JPEG, PNG, atau WebP.";
    }
    if (f.size > MAX_FILE_SIZE) {
      return `Ukuran file melebihi batas 10 MB (${fmtNum(f.size / 1024 / 1024, 1)} MB).`;
    }
    return null;
  }, []);

  const sanitizeFileName = useCallback((name: string): string => {
    return name
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .substring(0, 100);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setSuccess(false);
    const f = e.target.files?.[0];
    if (!f) return;
    const err = validateFile(f);
    if (err) {
      setError(err);
      onError?.(err);
      return;
    }
    setFile(f);
  };

  const handleUpload = async () => {
    if (!file) return setError("Pilih file terlebih dahulu.");
    if (uploaderName.length < 2) return setError("Nama petugas minimal 2 karakter.");
    setUploading(true);
    setError(null);

    try {
      const safeName = sanitizeFileName(file.name);
      const path = `${jobId}/${kind}/${Date.now()}-${safeName}`;

      const supabase = createClient();

      // Upload to private bucket
      const { error: uploadError } = await supabase.storage
        .from("ckb-rebagging")
        .upload(path, file, { cacheControl: "3600", upsert: false });

      if (uploadError) throw uploadError;

      // Record evidence via RPC
      const { error: rpcError } = await supabase.rpc("add_rebagging_evidence", {
        p_job_id: jobId,
        p_kind: kind,
        p_storage_path: path,
        p_mime: file.type,
        p_size: file.size,
        p_note: note.trim() || null,
        p_by_name: uploaderName,
      });

      if (rpcError) throw rpcError;

      setSuccess(true);
      setFile(null);
      setNote("");
      // Reset both file inputs (gallery picker + camera)
      for (const id of [`evidence-file-${jobId}-${kind}`, `evidence-cam-${jobId}-${kind}`]) {
        const input = document.getElementById(id) as HTMLInputElement | null;
        if (input) input.value = "";
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      onError?.(msg);
    } finally {
      setUploading(false);
    }
  };

  const kindLabels: Record<"BEFORE" | "AFTER" | "OTHER", string> = {
    BEFORE: "Sebelum",
    AFTER: "Sesudah",
    OTHER: "Lainnya",
  };

  return (
    <div className="space-y-3 p-4 border border-steel-100 rounded-lg bg-white">
      <div className="flex items-center gap-2">
        <Label className="font-medium text-steel-700">{kindLabels[kind]}</Label>
        {success && <CheckCircle className="h-5 w-5 text-ok" />}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-bad bg-bad/5 p-2 rounded">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {file && !success && (
        <div className="flex items-center gap-3 p-2 bg-steel-100 rounded border border-steel-100">
          {previewUrl ? (
            /* Local file preview; no optimizer involved. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={previewUrl} alt={file.name} className="h-12 w-12 flex-shrink-0 rounded object-cover" />
          ) : (
            <ImageIcon className="h-10 w-10 flex-shrink-0 rounded bg-steel-100" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs text-steel-500">{fmtNum(file.size / 1024)} KB</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setFile(null)} disabled={uploading}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {!file && !success && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg transition-colors cursor-pointer border-steel-300 hover:border-ckb hover:bg-ckb/5 text-steel-500">
            <input
              id={`evidence-file-${jobId}-${kind}`}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              disabled={disabled || uploading}
              className="sr-only"
            />
            <ImageIcon className="h-8 w-8" />
            <span className="text-sm">Pilih dari galeri / berkas</span>
            <span className="text-xs text-steel-500">Maks 10 MB · JPEG, PNG, WebP</span>
          </label>
          <label
            className={cn(
              "flex items-center justify-center gap-2 px-4 py-3 border border-steel-300 rounded-lg text-sm font-medium transition-colors cursor-pointer",
              disabled || uploading
                ? "text-steel-500 bg-steel-100 cursor-not-allowed"
                : "text-ckb hover:bg-ckb/5 hover:border-ckb"
            )}
          >
            <input
              id={`evidence-cam-${jobId}-${kind}`}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              disabled={disabled || uploading}
              className="sr-only"
            />
            <Camera className="h-4 w-4" /> Buka kamera
          </label>
        </div>
      )}

      {file && !success && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={`evidence-note-${jobId}-${kind}`}>Catatan (opsional)</Label>
            <Input
              id={`evidence-note-${jobId}-${kind}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Catatan untuk foto ini…"
              disabled={uploading}
            />
          </div>
          <Button
            size="lg"
            variant="accent"
            onClick={handleUpload}
            disabled={uploading || disabled}
            className="w-full"
          >
            {uploading ? "Mengunggah…" : `Unggah Foto ${kindLabels[kind]}`}
          </Button>
        </div>
      )}

      {success && (
        <Button variant="outline" size="sm" onClick={() => setSuccess(false)} className="w-full">
          Unggah foto lain
        </Button>
      )}
    </div>
  );
}

/** Signed URL helper for gallery images — private bucket, never public URLs. */
export async function getEvidenceSignedUrl(storagePath: string): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from("ckb-rebagging").createSignedUrl(storagePath, 600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/** Client component to display an evidence image with signed URL, loading, and error states. */
export function EvidenceImage({ storagePath, alt = "Bukti foto", className }: { storagePath: string; alt?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Load the signed URL on mount and whenever the path changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSrc(null);
    setFailed(false);
    getEvidenceSignedUrl(storagePath).then((url) => {
      if (!alive) return;
      if (url) setSrc(url);
      else setFailed(true);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [storagePath]);

  return (
    <div className={cn("relative aspect-square bg-steel-100 rounded-lg overflow-hidden", className)}>
      {loading && !src && !failed && (
        <div className="absolute inset-0 flex items-center justify-center text-steel-500">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-ckb border-t-transparent" />
        </div>
      )}
      {src && (
        // Signed URLs are short-lived, so they bypass next/image's optimizer.
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => {
            setFailed(true);
            setSrc(null);
          }}
        />
      )}
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center text-steel-300">
          <ImageIcon className="h-8 w-8 opacity-50" />
        </div>
      )}
    </div>
  );
}