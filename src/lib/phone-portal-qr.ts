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

export function projectPortalPath(projectId?: string) {
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

export interface PhonePortalQr {
  /** The LAN URL a phone should open. Editable so the settings panel can offer an override. */
  portalUrl: string;
  setPortalUrl: (url: string) => void;
  /** Empty until the URL has settled — see the note on isUrlResolved below. */
  qrDataUrl: string;
  /** Same-origin path for an "open on this device" link. */
  openPortalHref: string;
}

/**
 * Resolves the phone capture portal's URL for a project and encodes it as a QR data URL.
 *
 * Extracted from PhonePhotoPortalPanel so the procedure toolbar's QR popover shares one
 * implementation: the caching, chunk pre-warming and settle-before-encode behaviour below are
 * subtle enough that a second copy would drift.
 *
 * @param size QR edge length in px. The settings panel renders larger than the popover.
 */
export function usePhonePortalQr(project?: PlannerProjectContext, size = 200): PhonePortalQr {
  const [portalUrl, setPortalUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  // The QR is built only from the settled URL. The first effect seeds the field with a
  // provisional fallback, but we don't encode that — otherwise the QR flickers from a
  // localhost/origin code to the resolved one on every open.
  const [isUrlResolved, setIsUrlResolved] = useState(false);

  const openPortalHref = useMemo(
    () => (project?.projectId ? projectPortalPath(project.projectId) : portalUrl || "/mobile-photos"),
    [portalUrl, project?.projectId],
  );

  useEffect(() => {
    let mounted = true;
    const projectId = project?.projectId;

    // New resolve cycle: hold the QR until we have the final URL.
    setIsUrlResolved(false);

    if (!projectId) {
      setPortalUrl(fallbackPortalUrl());
      setIsUrlResolved(true);
      return () => {
        mounted = false;
      };
    }

    // Warm the QR encoder chunk in parallel with the URL resolve below.
    void loadQrcodeModule().catch(() => undefined);

    // The resolved LAN URL rarely changes within a browser session: paint (and encode)
    // the cached value immediately and revalidate in the background. Without a cached
    // value, seed the field with the fallback but leave the QR gated until the API
    // (or its fallback) settles the real URL.
    const cachedPortalUrl = readCachedPortalUrl(projectId);
    if (cachedPortalUrl) {
      setPortalUrl(cachedPortalUrl);
      setIsUrlResolved(true);
    } else {
      setPortalUrl(fallbackPortalUrl(projectId));
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
        setPortalUrl(resolvedUrl);
        setIsUrlResolved(true);
      }
    };

    resolvePortalUrl().catch(() => {
      // With a cached URL already painted, a failed refresh keeps it; otherwise fall
      // back to the origin-based URL so the panel still works.
      if (mounted && !cachedPortalUrl) {
        setPortalUrl(fallbackPortalUrl(projectId));
        setIsUrlResolved(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, [project?.projectId]);

  useEffect(() => {
    let mounted = true;

    // Wait for the settled URL before encoding — prevents the provisional fallback from
    // producing a throwaway QR that's immediately replaced.
    if (!portalUrl || !isUrlResolved) {
      return () => {
        mounted = false;
      };
    }

    loadQrcodeModule()
      .then((qrcodeModule) =>
        qrcodeModule.toDataURL(portalUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: size,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
        }),
      )
      .then((dataUrl) => {
        if (mounted) {
          setQrDataUrl(dataUrl);
        }
      })
      .catch(() => {
        if (mounted) {
          setQrDataUrl("");
        }
      });

    return () => {
      mounted = false;
    };
  }, [portalUrl, isUrlResolved, size]);

  return { portalUrl, setPortalUrl, qrDataUrl, openPortalHref };
}
