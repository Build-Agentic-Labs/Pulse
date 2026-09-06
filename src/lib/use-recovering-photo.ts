"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshSignedMediaUrl } from "@/domain/supabase-planner";

export function photoUrlNeedsRefresh(url: string, now = Date.now()) {
  try {
    const token = new URL(url).searchParams.get("token");
    if (!token) return false;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" && payload.exp * 1000 < now + 120_000;
  } catch { return false; }
}
const requests = new Map<string, Promise<string | undefined>>();
function sign(path: string) {
  let request = requests.get(path);
  if (!request) {
    request = refreshSignedMediaUrl(path, "photo").catch(() => undefined).finally(() => requests.delete(path));
    requests.set(path, request);
  }
  return request;
}

export function useRecoveringPhoto(url: string, storagePath?: string) {
  const identity = `${storagePath ?? ""}|${url}`;
  const current = useRef({ identity, source: url, attempted: "" });
  if (current.current.identity !== identity) current.current = {identity, source: url, attempted: ""};
  const [state, setState] = useState({identity, source: url, failed: false, loading: false});
  const visible = state.identity === identity ? state : {identity, source:url, failed:false, loading:false};
  const failedRef = useRef(visible.failed);
  failedRef.current = visible.failed;
  const recover = useCallback(async (force = false) => {
    const snapshot = current.current;
    if (!storagePath) {
      if (force) setState({identity, source:snapshot.source, failed:false, loading:false});
      return snapshot.source;
    }
    if (!force && !photoUrlNeedsRefresh(snapshot.source)) return snapshot.source;
    setState({identity, source:snapshot.source, failed:false, loading:true});
    const fresh = await sign(storagePath);
    if (current.current !== snapshot) return fresh;
    if (fresh) snapshot.source = fresh;
    setState({identity, source:snapshot.source, failed:!fresh, loading:false});
    return fresh;
  }, [identity, storagePath]);
  const onError = useCallback(() => {
    const snapshot = current.current;
    if (!storagePath || snapshot.attempted === snapshot.source) {
      setState({identity, source:snapshot.source, failed:true, loading:false});
      return;
    }
    snapshot.attempted = snapshot.source;
    void recover(true).then(fresh => { if (fresh && current.current === snapshot) snapshot.attempted = fresh; });
  }, [identity, recover, storagePath]);
  const retry = useCallback(() => { current.current.attempted = ""; return recover(true); }, [recover]);
  useEffect(() => {
    const resume = () => { if (document.visibilityState !== "hidden") { current.current.attempted = ""; void recover(failedRef.current); } };
    const online = () => { void retry(); };
    void recover();
    const timer = window.setInterval(resume, 60_000);
    window.addEventListener("focus", resume);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", resume);
    return () => { clearInterval(timer); window.removeEventListener("focus",resume); window.removeEventListener("online",online); document.removeEventListener("visibilitychange",resume); };
  }, [recover, retry]);
  return { source:visible.source, failed:visible.failed, loading:visible.loading, recover, retry, onError };
}
