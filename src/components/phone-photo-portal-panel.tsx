"use client";

import QRCodeGenerator from "qrcode";
import { useEffect, useMemo, useState } from "react";
import type { PlannerProjectContext } from "@/domain/types";

function projectPortalPath(projectId?: string) {
  return projectId ? `/projects/${projectId}/mobile-photos` : "/mobile-photos";
}

function fallbackPortalUrl(projectId?: string) {
  if (typeof window === "undefined") {
    return projectPortalPath(projectId);
  }

  return `${window.location.origin}${projectPortalPath(projectId)}`;
}

function ensureProjectPortalUrl(url: string, projectId?: string) {
  if (!projectId) {
    return url;
  }

  try {
    const parsed = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    parsed.pathname = projectPortalPath(projectId);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return fallbackPortalUrl(projectId);
  }
}

export function PhonePhotoPortalPanel({ project }: { project?: PlannerProjectContext }) {
  const [phonePortalUrl, setPhonePortalUrl] = useState("");
  const [phonePortalQrDataUrl, setPhonePortalQrDataUrl] = useState("");
  const openPortalHref = useMemo(
    () => (project?.projectId ? projectPortalPath(project.projectId) : phonePortalUrl || "/mobile-photos"),
    [phonePortalUrl, project?.projectId],
  );

  useEffect(() => {
    let mounted = true;
    const projectId = project?.projectId;

    if (!projectId) {
      setPhonePortalUrl(fallbackPortalUrl());
      return () => {
        mounted = false;
      };
    }

    setPhonePortalUrl(fallbackPortalUrl(projectId));

    const phonePortalApiUrl = `/api/phone-portal-url?projectId=${encodeURIComponent(projectId)}`;

    fetch(phonePortalApiUrl, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Unable to resolve phone portal URL.");
        }

        return response.json() as Promise<{ url?: string }>;
      })
      .then((payload) => {
        if (!mounted) {
          return;
        }

        setPhonePortalUrl(ensureProjectPortalUrl(payload.url ?? fallbackPortalUrl(projectId), projectId));
      })
      .catch(() => {
        if (mounted) {
          setPhonePortalUrl(fallbackPortalUrl(projectId));
        }
      });

    return () => {
      mounted = false;
    };
  }, [project?.projectId]);

  useEffect(() => {    let mounted = true;

    if (!phonePortalUrl) {
      return () => {
        mounted = false;
      };
    }

    QRCodeGenerator.toDataURL(phonePortalUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    })
      .then((dataUrl) => {
        if (mounted) {
          setPhonePortalQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (mounted) {
          setPhonePortalQrDataUrl("");
        }
      });

    return () => {
      mounted = false;
    };
  }, [phonePortalUrl]);

  return (
    <section className="ui-settings-section">
      <h3 className="ui-settings-section-title">Phone photo portal</h3>
      <p className="ui-settings-section-desc">
        {project?.projectId
          ? `Open or scan the portal for ${project.projectName}. It loads manufacturing steps from this project only.`
          : "Scan the QR code on a phone to capture step photos in the procedure editor."}
      </p>

      <div className="ui-settings-group p-4">
        <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)] md:items-start">
          <div className="flex justify-center rounded-xl border border-line bg-surface-muted p-3">
            {phonePortalQrDataUrl ? (
              <img src={phonePortalQrDataUrl} alt="Phone photo portal QR code" className="h-48 w-48" />
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
              <a
                href={openPortalHref}
                target="_blank"
                rel="noreferrer"
                className="ui-btn-ghost inline-flex h-8 px-3 text-[10px]"
              >
                Open portal
              </a>
              {project?.projectId ? (
                <span className="text-[10px] font-medium text-steel">
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
