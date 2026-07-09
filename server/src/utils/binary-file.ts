import path from "node:path";
import { decodeUploadFileName } from "./filename.js";

const MIME_TO_EXT: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/pdf": ".pdf",
  "application/zip": ".zip",
  "application/octet-stream": "",
};

/** 업로드 파일명에서 확장자를 안정적으로 추출한다 */
export function resolveUploadExtension(originalName: string, mimeType?: string): string {
  const decoded = decodeUploadFileName(originalName);
  let ext = path.extname(decoded);
  if (!ext && originalName !== decoded) {
    ext = path.extname(originalName);
  }
  if (!ext && mimeType) {
    ext = MIME_TO_EXT[mimeType.toLowerCase()] ?? "";
  }
  return ext.toLowerCase();
}

/** 디스크 저장용 고유 파일명 (확장자 유지) */
export function buildStoredFileName(originalName: string, uniquePrefix: string, mimeType?: string): string {
  const ext = resolveUploadExtension(originalName, mimeType);
  return `${uniquePrefix}${ext}`;
}

/** RAG/표시용 파일명 — 확장자는 잘리지 않도록 보존 */
export function sanitizeRagFileName(name: string, maxLength = 120): string {
  const decoded = decodeUploadFileName(name).normalize("NFC");
  const ext = path.extname(decoded);
  const base = path.basename(decoded, ext).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\s+/g, " ").trim();
  const safeBase = base || "upload";
  const maxBaseLen = Math.max(1, maxLength - ext.length);
  return `${safeBase.slice(0, maxBaseLen)}${ext}`;
}

/** 다운로드 Content-Type (바이너리는 octet-stream 우선) */
export function resolveDownloadContentType(fileName: string, messageType: "file" | "image"): string {
  if (messageType === "image") {
    const ext = path.extname(fileName).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".gif") return "image/gif";
    if (ext === ".webp") return "image/webp";
    if (ext === ".bmp") return "image/bmp";
    return "image/jpeg";
  }

  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".xls") return "application/vnd.ms-excel";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".doc") return "application/msword";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

/** 바이너리 복사 후 크기 일치 검증 */
export async function copyBinaryFile(
  sourcePath: string,
  destPath: string,
  fs: typeof import("node:fs/promises")
): Promise<void> {
  const srcStat = await fs.stat(sourcePath);
  await fs.copyFile(sourcePath, destPath);
  const destStat = await fs.stat(destPath);
  if (srcStat.size !== destStat.size) {
    await fs.unlink(destPath).catch(() => undefined);
    throw new Error(`파일 복사 크기 불일치 (원본 ${srcStat.size}, 복사 ${destStat.size})`);
  }
}
