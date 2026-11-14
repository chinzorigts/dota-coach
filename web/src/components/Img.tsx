import { useState } from "react";

/** If a Steam CDN image fails (offline/blocked), show initials instead of a broken icon */
export function Img({ src, label, className, width, height }: { src: string; label: string; className?: string; width?: number; height?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken || !src) {
    return (
      <span className={`img-fallback ${className ?? ""}`} style={{ width, height }} role="img" aria-label={label} title={label}>
        {label.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
      </span>
    );
  }
  return <img src={src} alt={label} title={label} className={className} width={width} height={height} onError={() => setBroken(true)} />;
}
