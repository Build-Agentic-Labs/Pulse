"use client";

import { useEffect, useMemo, useState } from "react";
import { createPlannerSupabaseClient } from "@/domain/supabase-planner";
import type { PlannerProjectContext } from "@/domain/types";

const PORTAL_URL_SESSION_CACHE_PREFIX = "pulse:phone-portal-url-v1:";

// qrcode stays out of the main client bundle (loaded on demand), but the chunk doesn't
// depend on the resolved URL — warming it while the portal-URL fetch runs means the QR
// appears after the slower of the two instead of their sum.
let qrcodeModulePromise: Promise<typeof import("qrcode")> | null = null;

function loadQrcodeModule() {
  qrcodeModulePromise ??= import("qrcode");
  return qrcodeModulePromise;
}

function readCachedPortalUrl(projectId: string) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(`${PORTAL_URL_SESSION_CACHE_PREFIX}${projectId}`) ?? "";
  } catch {
    return "";
  }
}

function writeCachedPortalUrl(projectId: string, url: string) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(`${PORTAL_URL_SESSION_CACHE_PREFIX}${projectId}`, url);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

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
  // The QR is built only from the settled URL. The first effect seeds the input
  // field with a provisional fallback, but we don't encode that — otherwise the
  // QR flickers from a localhost/origin code to the resolved one on every open.
  const [isUrlResolved, setIsUrlResolved] = useState(false);
  const openPortalHref = useMemo(
    () => (project?.projectId ? projectPortalPath(project.projectId) : phonePortalUrl || "/mobile-photos"),
    [phonePortalUrl, project?.projectId],
  );

  useEffect(() => {
    let mounted = true;
    const projectId = project?.projectId;

    // New resolve cycle: hold the QR until we have the final URL.
    setIsUrlResolved(false);

    if (!projectId) {
      setPhonePortalUrl(fallbackPortalUrl());
      setIsUrlResolved(true);
      return () => {
        mounted = false;
      };
    }

    // Warm the QR encoder chunk in parallel with the URL resolve below.
    void loadQrcodeModule().catch(() => undefined);

    // The resolved LAN URL rarely changes within a browser session: paint (and encode)
    // the cached value immediately and revalidate in the background. Without a cached
    // value, seed the input field with the fallback but leave the QR gated until the
    // API (or its fallback) settles the real URL.
    const cachedPortalUrl = readCachedPortalUrl(projectId);
    if (cachedPortalUrl) {
      setPhonePortalUrl(cachedPortalUrl);
      setIsUrlResolved(true);
    } else {
      setPhonePortalUrl(fallbackPortalUrl(projectId));
    }

    const phonePortalApiUrl = `/api/phone-portal-url?projectId=${encodeURIComponent(projectId)}`;

    const resolvePortalUrl = async () => {
      const supabase = createPlannerSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        throw new Error("Sign in before resolving the phone portal URL.");
      }

      const response = await fetch(phonePortalApiUrl, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new Error("Unable to resolve phone portal URL.");
      }

      const payload = (await response.json()) as { url?: string };
      const resolvedUrl = ensureProjectPortalUrl(payload.url ?? fallbackPortalUrl(projectId), projectId);
      writeCachedPortalUrl(projectId, resolvedUrl);
      if (mounted) {
        // Identical to the cached value in the common case, which React treats as a
        // no-op; a changed LAN address re-encodes the QR once.
        setPhonePortalUrl(resolvedUrl);
        setIsUrlResolved(true);
      }
    };

    resolvePortalUrl().catch(() => {
      // With a cached URL already painted, a failed refresh keeps it; otherwise fall
      // back to the origin-based URL so the panel still works.
      if (mounted && !cachedPortalUrl) {
        setPhonePortalUrl(fallbackPortalUrl(projectId));
        setIsUrlResolved(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, [project?.projectId]);

  useEffect(() => {
    let mounted = true;

    // Wait for the settled URL before encoding — prevents the provisional
    // fallback from producing a throwaway QR that's immediately replaced.
    if (!phonePortalUrl || !isUrlResolved) {
      return () => {
        mounted = false;
      };
    }

    // qrcode is only needed once this settings panel is open — loaded on demand (and
    // pre-warmed by the URL-resolve effect) instead of shipping in the main bundle.
    loadQrcodeModule()
      .then((qrcodeModule) =>
        qrcodeModule.toDataURL(phonePortalUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 200,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        }),
      )
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
  }, [phonePortalUrl, isUrlResolved]);

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
              <button
                type="button"
                onClick={() => window.location.assign(openPortalHref)}
                className="ui-btn-ghost inline-flex h-8 px-3 text-[10px]"
              >
                Open portal
              </button>
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
