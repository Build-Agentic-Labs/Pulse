"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";

/**
 * Textarea that grows to fit its content so the full body text stays visible.
 * Pass `maxHeight` (px) to cap the growth and scroll past it — useful in tight
 * columns where unbounded growth would make a very tall row.
 */
export function AutoTextarea({
  value,
  className = "",
  maxHeight,
  ...props
}: ComponentProps<"textarea"> & { maxHeight?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    // border-box + 1px borders: scrollHeight omits the border, so add it back
    // to avoid clipping the last line.
    const styles = window.getComputedStyle(el);
    const border = parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
    el.style.height = "auto";
    const next = el.scrollHeight + border;
    if (maxHeight && next > maxHeight) {
      el.style.height = `${maxHeight}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.height = `${next}px`;
      el.style.overflowY = "hidden";
    }
  }

  useLayoutEffect(resize, [value, maxHeight]);
  useEffect(() => {
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      className={`resize-none ${className}`.trim()}
      {...props}
    />
  );
}
