import type { CSSProperties, ReactNode } from "react";

const NAV_ITEM_STEP_PX = 34;

export function NavSelectionTrack({
  activeIndex,
  as: Component = "div",
  inset = false,
  className = "",
  children,
}: {
  activeIndex: number;
  as?: "div" | "nav";
  inset?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const hasActiveItem = activeIndex >= 0;
  const classes = [
    hasActiveItem ? "ui-nav-selection-track" : "",
    inset ? "ui-nav-selection-track-inset" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component
      className={classes}
      style={
        hasActiveItem
          ? ({ "--nav-active-offset": `${activeIndex * NAV_ITEM_STEP_PX}px` } as CSSProperties)
          : undefined
      }
    >
      {children}
    </Component>
  );
}
