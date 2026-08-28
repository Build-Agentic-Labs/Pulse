"use client";

import NextImage from "next/image";

import { usePhonePortalQr } from "@/lib/phone-portal-qr";
import type { PlannerProjectContext } from "@/domain/types";

export function PhonePhotoPortalPanel({ project }: { project?: PlannerProjectContext }) {
  const { portalUrl: phonePortalUrl, setPortalUrl: setPhonePortalUrl, qrDataUrl: phonePortalQrDataUrl, openPortalHref } =
    usePhonePortalQr(project);

  return (
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">Phone photo portal</h3>
      <p className="ui-settings-section-desc">
        {project?.projectId
          ? `Open or scan the portal for ${project.projectName}. It loads manufacturing steps from this project only.`
          : "Scan the QR code on a phone to capture step photos in the procedure editor."}
      </p>

      <div className="ui-settings-group">
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
          <div className="flex justify-center rounded-sm border border-line p-3">
            {phonePortalQrDataUrl ? (
              <NextImage
                src={phonePortalQrDataUrl}
                alt="Phone photo portal QR code"
                width={192}
                height={192}
                unoptimized
                className="h-48 w-48"
              />
            ) : (
              <div className="flex h-48 w-48 items-center justify-center text-[11px] text-ink-tertiary">
                Building QR code...
              </div>
            )}
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="ui-field-label">Portal URL for phone</span>
              <input
                className="ui-field-standalone"
                value={phonePortalUrl}
                onChange={(event) => setPhonePortalUrl(event.target.value)}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.location.assign(openPortalHref)}
                className="ui-btn-ghost inline-flex h-8 px-3"
              >
                Open portal
              </button>
              {project?.projectId ? (
                <span className="ui-settings-group-row-desc font-medium text-steel">
                  Opens `/projects/{project.projectId}/mobile-photos`
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
