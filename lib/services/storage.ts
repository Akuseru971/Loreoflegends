import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { env } from "@/lib/config";
import { createServiceClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type StoredAsset = {
  storagePath: string;
  publicUrl: string;
  mimeType: string;
};

const publicRoot = path.join(process.cwd(), "public", "generated");

export async function storeBuffer(
  buffer: Buffer,
  options: {
    folder: string;
    extension: string;
    mimeType: string;
    nameHint?: string;
  },
): Promise<StoredAsset> {
  const digest = createHash("sha1").update(buffer).digest("hex").slice(0, 10);
  const fileName = `${options.nameHint ?? nanoid(8)}-${digest}.${options.extension}`;
  const storagePath = `${options.folder}/${fileName}`;

  if (isSupabaseConfigured) {
    const supabase = createServiceClient();
    const { error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).upload(storagePath, buffer, {
      contentType: options.mimeType,
      upsert: true,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(storagePath);
    return { storagePath, publicUrl: data.publicUrl, mimeType: options.mimeType };
  }

  const localPath = path.join(publicRoot, storagePath);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, buffer);
  return { storagePath, publicUrl: `/generated/${storagePath}`, mimeType: options.mimeType };
}

export async function uploadLocalFile(localPath: string, storagePath: string, mimeType: string): Promise<StoredAsset> {
  const buffer = await readFile(localPath);
  if (isSupabaseConfigured) {
    const supabase = createServiceClient();
    const { error } = await supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(env.SUPABASE_STORAGE_BUCKET).getPublicUrl(storagePath);
    return { storagePath, publicUrl: data.publicUrl, mimeType };
  }

  const destination = path.join(publicRoot, storagePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, buffer);
  return { storagePath, publicUrl: `/generated/${storagePath}`, mimeType };
}
