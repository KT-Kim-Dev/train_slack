/** 원형 프로필용 정사각형 이미지를 canvas 로 잘라 Blob 으로 반환 */
export async function cropImageToBlob(
  image: HTMLImageElement,
  params: {
    viewportSize: number;
    outputSize: number;
    scale: number;
    offsetX: number;
    offsetY: number;
    mimeType?: string;
    quality?: number;
  }
): Promise<Blob> {
  const {
    viewportSize,
    outputSize,
    scale,
    offsetX,
    offsetY,
    mimeType = "image/jpeg",
    quality = 0.92,
  } = params;

  const srcX = (0 - offsetX) / scale;
  const srcY = (0 - offsetY) / scale;
  const srcW = viewportSize / scale;
  const srcH = viewportSize / scale;

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지 편집을 시작할 수 없습니다.");

  ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, outputSize, outputSize);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("이미지 자르기에 실패했습니다."));
      },
      mimeType,
      quality
    );
  });
}

/** 이미지가 뷰포트를 덮도록 하는 최소 배율 */
export function minCoverScale(imgW: number, imgH: number, viewport: number): number {
  return Math.max(viewport / imgW, viewport / imgH);
}

/** 드래그 후에도 크롭 영역 안에 이미지가 남도록 오프셋 보정 */
export function clampOffset(
  offsetX: number,
  offsetY: number,
  imgW: number,
  imgH: number,
  scale: number,
  viewport: number
): { x: number; y: number } {
  const dispW = imgW * scale;
  const dispH = imgH * scale;
  const minX = viewport - dispW;
  const minY = viewport - dispH;
  const maxX = 0;
  const maxY = 0;
  return {
    x: Math.min(maxX, Math.max(minX, offsetX)),
    y: Math.min(maxY, Math.max(minY, offsetY)),
  };
}

/** 배율 변경 시 중심을 유지하도록 오프셋 조정 */
export function offsetForZoom(
  offsetX: number,
  offsetY: number,
  prevScale: number,
  nextScale: number,
  viewport: number
): { x: number; y: number } {
  const cx = viewport / 2;
  const cy = viewport / 2;
  return {
    x: cx - ((cx - offsetX) * nextScale) / prevScale,
    y: cy - ((cy - offsetY) * nextScale) / prevScale,
  };
}
