import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { FILE_EXTENSIONS, type SourceType } from "./formats";

export { CONTENT_TYPES } from "./formats";

/** Prefer durable DB blobs on serverless; local disk only when writable. */
export function storeFilesInDb() {
  return Boolean(process.env.VERCEL) || process.env.KAI_PDF_STORAGE === "db";
}

export async function writeFileToDisk(options: {
  guestId: string;
  documentId: string;
  buffer: Buffer;
  sourceType: SourceType;
}): Promise<string> {
  const root =
    process.env.VERCEL || process.env.KAI_PDF_STORAGE === "tmp"
      ? path.join(os.tmpdir(), "kai-uploads")
      : path.join(process.cwd(), "uploads");

  const uploadDir = path.join(root, options.guestId);
  await mkdir(uploadDir, { recursive: true });

  const storagePath = path.join(
    uploadDir,
    `${options.documentId}.${FILE_EXTENSIONS[options.sourceType]}`,
  );
  await writeFile(storagePath, options.buffer);
  return storagePath;
}

export async function readStoredFile(options: {
  storagePath: string | null;
  fileBytes: string | null;
}): Promise<Buffer | null> {
  if (options.fileBytes) {
    return Buffer.from(options.fileBytes, "base64");
  }
  if (options.storagePath) {
    try {
      return await readFile(options.storagePath);
    } catch {
      return null;
    }
  }
  return null;
}

export async function removeStoredFile(options: {
  storagePath: string | null;
}): Promise<void> {
  if (!options.storagePath) return;
  try {
    await unlink(options.storagePath);
  } catch {
    // ignore missing file
  }
}
