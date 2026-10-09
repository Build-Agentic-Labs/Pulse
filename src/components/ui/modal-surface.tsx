"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./modal-surface.css";

/** Owns the browser modal layer; callers retain layout, actions and close policy. */
export function ModalSurface({ children, labelledBy, label, active = true, modal = true, onCancel }: {
  children: ReactNode;
  labelledBy?: string;
  label?: string;
  active?: boolean;
  modal?: boolean;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !active || !modal) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-modal-initial-focus]")?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [active, modal]);

  if (!modal) return children;
  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog ref={ref} className="ui-modal-surface" aria-labelledby={labelledBy} aria-label={label}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
        if (event.key !== "Tab" || event.defaultPrevented) return;
        event.stopPropagation();
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], audio[controls], iframe, [contenteditable="true"], [tabindex]',
        )).filter((element) => (element.tabIndex >= 0 || (!element.hasAttribute("tabindex") && element.matches('video[controls], audio[controls], iframe, [contenteditable="true"]'))) && element.getClientRects().length > 0 && !element.closest('[inert], [hidden]'));
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}>
      {children}
    </dialog>, document.body,
  );
}
