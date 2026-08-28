"use client";

import NextImage from "next/image";
import { QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { PlannerProjectContext } from "@/domain/types";
import { usePhonePortalQr } from "@/lib/phone-portal-qr";

/**
 * Toolbar control that reveals the phone capture portal's QR code.
 *
 * The same QR lives in project settings, but the people who need it are standing in the
 * procedure editor about to walk the line with a phone — making them leave for Settings to
 * find it was the friction. Rendered as a popover rather than a modal to match the Filter
 * control it sits beside.
 */
export function PhonePortalQrButton({ project }: { project?: PlannerProjectContext }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Only mount the hook's work (URL resolve + qrcode chunk) once the popover is first opened,
  // so the procedure page does not pay for a QR nobody asked for.
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setHasOpened(true);
          setIsOpen((open) => !open);
        }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Scan to capture step photos on a phone"
        className="ui-btn-ghost h-9 gap-2 px-3"
      >
        <QrCode size={14} strokeWidth={1.75} />
        Phone
      </button>
      {isOpen && hasOpened ? <PhonePortalQrPopover project={project} /> : null}
    </div>
  );
}

function PhonePortalQrPopover({ project }: { project?: PlannerProjectContext }) {
  const { portalUrl, qrDataUrl, openPortalHref } = usePhonePortalQr(project, 176);

  return (
    <div
      role="dialog"
      aria-label="Phone photo portal"
      className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-line bg-surface-raised p-3 shadow-lg"
    >
      <div className="ui-field-label mb-2">Capture on a phone</div>

      <div className="flex justify-center rounded-sm border border-line bg-canvas p-2">
        {qrDataUrl ? (
          <NextImage
            src={qrDataUrl}
            alt="Phone photo portal QR code"
            width={176}
            height={176}
            unoptimized
            className="h-44 w-44"
          />
        ) : (
          <div className="flex h-44 w-44 items-center justify-center text-[11px] text-ink-tertiary">
            Building QR code...
          </div>
        )}
      </div>

      <p className="mt-2 break-all text-[10px] leading-snug text-ink-tertiary" title={portalUrl}>
        {portalUrl}
      </p>

      <a href={openPortalHref} className="ui-btn-ghost mt-2 inline-flex h-8 w-full justify-center px-3">
        Open on this device
      </a>
    </div>
  );
}
