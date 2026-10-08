"use client";

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode, type HTMLAttributes } from "react";

type Position = { top: number; left: number; width: number; height: number };
function createSelectionPositions() {
  const positions = new Map<string, Position>();
  return { get: (key: string) => positions.get(key) ?? null, set: (key: string, next: Position) => { positions.set(key, next); } };
}
const SelectionPositions = createContext<ReturnType<typeof createSelectionPositions> | null>(null);
const SelectionOwner = createContext(false);

/** Retain each panel's selector position across route and loading boundaries. */
export function NavSelectionProvider({ children }: { children: ReactNode }) {
  const [positions] = useState(createSelectionPositions);
  return <SelectionPositions.Provider value={positions}>{children}</SelectionPositions.Provider>;
}

const transform = (position: Position) => `translate(${position.left}px, ${position.top}px)`;

/** One measured indicator for every section, including dynamically sized or nested navigation. */
export function NavSelectionTrack({
  children, activeIndex, as: Component = "div", inset = false, className = "", persistenceKey, ...props
}: HTMLAttributes<HTMLElement> & {
  activeIndex?: number;
  as?: "div" | "nav";
  inset?: boolean;
  persistenceKey?: string;
}) {
  const [localPositions] = useState(createSelectionPositions);
  const sharedPositions = useContext(SelectionPositions);
  const positions = persistenceKey && sharedPositions ? sharedPositions : localPositions;
  const positionKey = persistenceKey ?? "local";
  const nested = useContext(SelectionOwner);
  const rootRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const indicator = indicatorRef.current;
    if (!root || !indicator || nested) return;
    let animation: Animation | undefined;
    let current: Position | null = null;
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const measure = () => {
      const active = Array.from(root.querySelectorAll<HTMLElement>(".ui-nav-item-active, .ui-settings-subnav-item-active"))
        .find(item => !item.closest('[inert], [aria-hidden="true"]') && item.getBoundingClientRect().width > 0);
      if (!active) {
        indicator.hidden = true;
        root.removeAttribute("data-nav-selection-ready");
        return;
      }
      const bounds = root.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (!item.width || !item.height) return;
      const next = { top: item.top - bounds.top + root.scrollTop - root.clientTop, left: item.left - bounds.left + root.scrollLeft - root.clientLeft, width: item.width, height: item.height };
      indicator.hidden = false;
      indicator.style.borderRadius = getComputedStyle(active).borderRadius;
      root.setAttribute("data-nav-selection-ready", "");
      if (current && Object.keys(next).every(key => next[key as keyof Position] === current![key as keyof Position])) return;
      let previous = current ?? positions.get(positionKey);
      if (animation?.playState === "running") {
        const visible = indicator.getBoundingClientRect();
        previous = { top: visible.top - bounds.top + root.scrollTop - root.clientTop, left: visible.left - bounds.left + root.scrollLeft - root.clientLeft, width: visible.width, height: visible.height };
      }
      animation?.cancel();
      Object.assign(indicator.style, { transform: transform(next), width: `${next.width}px`, height: `${next.height}px` });
      current = next;
      positions.set(positionKey, next);
      if (previous && !motion?.matches && indicator.animate &&
        (previous.top !== next.top || previous.left !== next.left || previous.width !== next.width || previous.height !== next.height)) {
        animation = indicator.animate([
          { transform: transform(previous), width: `${previous.width}px`, height: `${previous.height}px` },
          { transform: transform(next), width: `${next.width}px`, height: `${next.height}px` },
        ], { duration: 280, easing: "cubic-bezier(0.34, 1.45, 0.64, 1)" });
      }
    };
    measure();
    // Child components can change their active item without rerendering the shell.
    const mutations = new MutationObserver(measure);
    mutations.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "inert", "aria-hidden"] });
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    resize?.observe(root);
    for (const item of root.querySelectorAll(".ui-nav-item, .ui-settings-subnav-item")) resize?.observe(item);
    const reduceMotion = () => { if (motion?.matches) animation?.cancel(); };
    motion?.addEventListener("change", reduceMotion);
    return () => {
      if (animation?.playState === "running") {
        const bounds = root.getBoundingClientRect();
        const visible = indicator.getBoundingClientRect();
        positions.set(positionKey, { top: visible.top - bounds.top + root.scrollTop - root.clientTop, left: visible.left - bounds.left + root.scrollLeft - root.clientLeft, width: visible.width, height: visible.height });
      }
      animation?.cancel();
      mutations.disconnect();
      resize?.disconnect();
      motion?.removeEventListener("change", reduceMotion);
    };
  }, [positions, positionKey, nested, activeIndex]);

  return <Component {...props} ref={rootRef as React.Ref<HTMLDivElement>}
    className={`${nested ? "" : "ui-nav-selection-track"} ${inset ? "ui-nav-selection-track-inset" : ""} ${className}`}
    data-nav-selection-owner={nested ? undefined : ""}>
    <SelectionOwner.Provider value={true}>{children}</SelectionOwner.Provider>
    {!nested ? <div ref={indicatorRef} hidden aria-hidden="true" className="ui-nav-selection-indicator" /> : null}
  </Component>;
}
