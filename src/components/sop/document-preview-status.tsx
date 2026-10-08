import { LoaderCircle } from "lucide-react";

export function DocumentPreviewStatus({ detail }: { detail: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center text-white">
      <LoaderCircle size={24} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">Loading WI preview…</p>
        <p className="mt-1 text-xs text-white/80">{detail}</p>
      </div>
    </div>
  );
}
