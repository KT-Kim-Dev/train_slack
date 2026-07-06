/**
 * multer 가 multipart 파일명을 latin1 로 받는 경우가 있어 한글이 깨진다.
 * UTF-8 바이트열을 latin1 문자열로 잘못 해석한 경우를 복원한다.
 */
export function decodeUploadFileName(name: string): string {
  if (!name) return name;

  const decoded = Buffer.from(name, "latin1").toString("utf8");
  const hasCjk = /[\u3000-\u9fff\uac00-\ud7af]/.test(decoded);
  const looksMojibake = /[^\u0000-\u007f]/.test(name) && !/[\uac00-\ud7af\u3000-\u9fff]/.test(name);

  if (hasCjk || looksMojibake) {
    return decoded.normalize("NFC");
  }
  return name.normalize("NFC");
}
