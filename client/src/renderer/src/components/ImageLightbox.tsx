import { useState } from "react";

interface Props {
  url: string;
  fileName: string;
  fileSize?: number | null;
  onClose: () => void;
}

/** 이미지 원본 크기 보기 + 다운로드 (FR-21, FR-22) */
export function ImageLightbox({ url, fileName, fileSize = null, onClose }: Props): JSX.Element {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    setDownloadError(null);
    try {
      if (window.intraChat?.downloadFile) {
        await window.intraChat.downloadFile({ url, fileName, expectedSize: fileSize });
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`다운로드 실패 (${res.status})`);
      const buffer = await res.arrayBuffer();
      if (fileSize != null && buffer.byteLength !== fileSize) {
        throw new Error("다운로드된 파일 크기가 원본과 일치하지 않습니다.");
      }
      await window.intraChat.saveFile(fileName, buffer);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "다운로드 실패");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <div className="lightbox-panel" onClick={(e) => e.stopPropagation()}>
        <img className="lightbox-img" src={url} alt={fileName} />
        <div className="lightbox-toolbar">
          <span className="lightbox-filename">{fileName}</span>
          <button
            type="button"
            className="lightbox-download-btn"
            onClick={() => void handleDownload()}
            disabled={downloading}
          >
            {downloading ? "저장 중..." : "다운로드"}
          </button>
        </div>
        {downloadError && <div className="lightbox-download-error">{downloadError}</div>}
      </div>
      <button className="lightbox-close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
