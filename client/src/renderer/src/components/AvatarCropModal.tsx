import { useCallback, useRef, useState } from "react";
import {
  clampOffset,
  cropImageToBlob,
  minCoverScale,
  offsetForZoom,
} from "../utils/cropAvatar";

const VIEWPORT = 280;
const OUTPUT = 256;
const MAX_ZOOM_FACTOR = 3;

interface Props {
  imageUrl: string;
  fileName: string;
  onClose: () => void;
  onConfirm: (file: File) => Promise<void>;
}

export function AvatarCropModal({ imageUrl, fileName, onClose, onConfirm }: Props): JSX.Element {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(
    null
  );

  const applyOffset = useCallback(
    (x: number, y: number, s: number) => {
      if (imgSize.w === 0) return { x, y };
      return clampOffset(x, y, imgSize.w, imgSize.h, s, VIEWPORT);
    },
    [imgSize]
  );

  function handleImageLoad(): void {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const cover = minCoverScale(w, h, VIEWPORT);
    setImgSize({ w, h });
    setMinScale(cover);
    setScale(cover);
    setOffset({
      x: (VIEWPORT - w * cover) / 2,
      y: (VIEWPORT - h * cover) / 2,
    });
  }

  function handleZoom(next: number): void {
    const clamped = Math.min(minScale * MAX_ZOOM_FACTOR, Math.max(minScale, next));
    setOffset((prev) => {
      const shifted = offsetForZoom(prev.x, prev.y, scale, clamped, VIEWPORT);
      return applyOffset(shifted.x, shifted.y, clamped);
    });
    setScale(clamped);
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: offset.x,
      baseY: offset.y,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const next = applyOffset(drag.baseX + dx, drag.baseY + dy, scale);
    setOffset(next);
  }

  function onPointerUp(): void {
    dragRef.current = null;
  }

  async function handleApply(): Promise<void> {
    const img = imgRef.current;
    if (!img || imgSize.w === 0) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await cropImageToBlob(img, {
        viewportSize: VIEWPORT,
        outputSize: OUTPUT,
        scale,
        offsetX: offset.x,
        offsetY: offset.y,
      });
      const ext = fileName.toLowerCase().endsWith(".png") ? "png" : "jpg";
      const mime = ext === "png" ? "image/png" : "image/jpeg";
      const cropped = new File([blob], `avatar.${ext}`, { type: mime });
      await onConfirm(cropped);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "프로필 사진 적용에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const zoomPercent = minScale > 0 ? Math.round((scale / minScale) * 100) : 100;

  return (
    <div className="modal-backdrop avatar-crop-backdrop" onClick={onClose}>
      <div className="modal avatar-crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>프로필 사진 편집</h2>
          <button className="modal-close" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>

        <p className="settings-desc">
          원 안에 보일 영역을 드래그로 이동하고, 확대/축소로 맞춘 뒤 적용하세요.
        </p>

        <div
          className="avatar-crop-stage"
          style={{ width: VIEWPORT, height: VIEWPORT }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imgRef}
            src={imageUrl}
            alt=""
            draggable={false}
            className="avatar-crop-image"
            style={{
              width: imgSize.w * scale,
              height: imgSize.h * scale,
              transform: `translate(${offset.x}px, ${offset.y}px)`,
            }}
            onLoad={handleImageLoad}
          />
          <div className="avatar-crop-mask" aria-hidden="true" />
          <div className="avatar-crop-ring" aria-hidden="true" />
        </div>

        <label className="avatar-crop-zoom">
          <span>확대/축소 ({zoomPercent}%)</span>
          <input
            type="range"
            min={minScale}
            max={minScale * MAX_ZOOM_FACTOR}
            step={minScale * 0.02}
            value={scale}
            disabled={busy || imgSize.w === 0}
            onChange={(e) => handleZoom(Number(e.target.value))}
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn-primary" onClick={() => void handleApply()} disabled={busy || imgSize.w === 0}>
            {busy ? "적용 중..." : "적용"}
          </button>
        </div>
      </div>
    </div>
  );
}
