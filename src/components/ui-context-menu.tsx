"use client";

import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type ContextMenuItem = {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

function contextMenuStyle(anchorRect: DOMRect, menuWidth: number, itemCount: number, comfortable: boolean): CSSProperties {
  const padding = 12;
  const left = Math.max(
    padding,
    Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - padding),
  );
  const belowTop = anchorRect.bottom + 4;
  const estimatedHeight = itemCount * (comfortable ? 32 : 22) + (comfortable ? 10 : 8);
  const top =
    belowTop + estimatedHeight > window.innerHeight - padding
      ? Math.max(padding, anchorRect.top - estimatedHeight - 6)
      : belowTop;

  return {
    top,
    left,
    width: menuWidth,
  };
}

export function UiContextMenu({
  anchorRect,
  items,
  onClose,
  menuWidth = 168,
  density = "compact",
  ariaLabel = "Project actions",
}: {
  anchorRect: DOMRect;
  items: ContextMenuItem[];
  onClose: () => void;
  menuWidth?: number;
  density?: "compact" | "comfortable";
  ariaLabel?: string;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        className="ui-context-menu-backdrop"
        onClick={onClose}
        aria-label="Close menu"
      />
      <div
        className={`ui-context-menu ${density === "comfortable" ? "ui-context-menu-comfortable" : ""}`}
        style={contextMenuStyle(anchorRect, menuWidth, items.length, density === "comfortable")}
        role="menu"
        aria-label={ariaLabel}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`ui-context-menu-item ${item.danger ? "ui-context-menu-item-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) {
                return;
              }

              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  );
}
