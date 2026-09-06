"use client";
import { useRecoveringPhoto } from "@/lib/use-recovering-photo";

export function RecoveringPhoto({url, storagePath, alt, width, height, svg = false}: {
  url:string; storagePath?:string; alt:string; width?:number; height?:number; svg?:boolean;
}) {
  const media = useRecoveringPhoto(url, storagePath);
  const fallback = <div className="flex h-full min-h-16 flex-col items-center justify-center text-xs text-ink-secondary" role="status">
    <span>Photo unavailable</span>
    <button type="button" className="underline" disabled={media.loading} onClick={event => {event.stopPropagation(); void media.retry();}}>Retry photo</button>
  </div>;
  if (svg) return media.failed
    ? <foreignObject width={width} height={height}><div className="flex h-full items-center justify-center text-ink-secondary" style={{fontSize: Math.max(12, Math.min(width ?? 1280, height ?? 960) / 160 * 12)}} role="status">Photo unavailable</div></foreignObject>
    : <image href={media.source} width={width} height={height} preserveAspectRatio="none" onError={media.onError} />;
  // eslint-disable-next-line @next/next/no-img-element -- signed source also used by the print document
  return media.failed ? fallback : <img src={media.source} alt={alt} onError={media.onError} />;
}
