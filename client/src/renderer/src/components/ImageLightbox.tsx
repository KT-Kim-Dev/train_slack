interface Props {
  url: string;
  onClose: () => void;
}

/** 이미지 원본 크기 보기 (FR-21) */
export function ImageLightbox({ url, onClose }: Props): JSX.Element {
  return (
    <div className="lightbox-backdrop" onClick={onClose}>
      <img className="lightbox-img" src={url} alt="원본 이미지" onClick={(e) => e.stopPropagation()} />
      <button className="lightbox-close" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
