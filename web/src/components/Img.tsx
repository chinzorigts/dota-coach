import { useState } from "react";

/** Steam CDN 이미지가 안 뜨면(오프라인·차단) 깨진 아이콘 대신 이름 머리글자를 보여 준다 */
export function Img({ src, label, className, width, height }: { src: string; label: string; className?: string; width?: number; height?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken || !src) {
    return (
      <span className={`img-fallback ${className ?? ""}`} style={{ width, height }} role="img" aria-label={label} title={label}>
        {label.replace(/[^A-Za-z0-9가-힣 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt={label} title={label} className={className} width={width} height={height} onError={() => setBroken(true)} />;
}
