"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./member-access-drawer.css";

export function MemberAccessDrawer({ name, description, onClose, children }: { name: string; description: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { clearTimeout(timer.current); element?.close(); };
  }, []);
  function close() {
    if (closing) return;
    setClosing(true);
    timer.current = setTimeout(onClose, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180);
  }
  return createPortal(<dialog ref={dialog} aria-labelledby="member-access-title" className="member-access-drawer" data-closing={closing}
    onMouseDown={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      pressedOutside.current = event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    }}
    onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      if (pressedOutside.current && event.target === event.currentTarget && outside) close();
      pressedOutside.current = false;
    }}
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line px-6 py-5">
      <div className="min-w-0"><p className="text-[11px] text-ink-tertiary">Member access</p><h2 id="member-access-title" className="mt-1 break-words text-lg font-medium">{name}</h2><p className="mt-2 break-words text-xs leading-5 text-ink-secondary">{description}</p></div>
      <button type="button" className="ui-btn-ghost h-8 w-8 shrink-0 p-0" aria-label="Close member access" onClick={close}><X size={18} /></button>
    </header>
    <div className="ui-settings-content min-h-0 flex-1 overflow-y-auto p-6"><div className="ui-settings-page">{children}</div></div>
  </dialog>, document.body);
}
