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

function contextMenuStyle(anchorRect: DOMRect, menuWidth: number): CSSProperties {
  const padding = 12;
  const left = Math.max(
    padding,
    Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - padding),
  );
  const belowTop = anchorRect.bottom + 4;
  const estimatedHeight = 88;
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
  ariaLabel = "Project actions",
}: {
  anchorRect: DOMRect;
  items: ContextMenuItem[];
  onClose: () => void;
  menuWidth?: number;
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
        className="ui-context-menu"
        style={contextMenuStyle(anchorRect, menuWidth)}
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
