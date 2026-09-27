import type { ReactNode } from "react";

function Line({ className = "" }: { className?: string }) {
  return <span className={`ui-skeleton-line block ${className}`} />;
}

/** Shared Quality loading language. Only placeholders animate; navigation stays still. */
export function QualitySkeleton({
  label = "Loading content", active = true, variant = "list", reserveClassName = "min-h-[260px]",
}: { label?: string; active?: boolean; variant?: "list" | "document" | "form" | "dashboard"; reserveClassName?: string }) {
  let content: ReactNode;
  if (variant === "document") {
    content = <div className="flex justify-center gap-6 p-4 md:p-6">
      <div className="min-h-[1056px] w-full max-w-[816px] shrink bg-canvas px-8 py-12 shadow-sm md:px-[72px]">
        <div className="mb-6 flex h-28 border border-line"><div className="flex flex-1 flex-col items-center justify-center gap-4"><Line className="h-7 w-24" /><Line className="h-2.5 w-3/5" /></div><div className="flex w-1/4 flex-col justify-around border-l border-line px-3"><Line className="h-2 w-3/4" /><Line className="h-2 w-full" /><Line className="h-2 w-4/5" /></div></div>
        {["w-11/12", "w-3/4", "w-2/5", "w-4/5", "w-1/2"].map((width, i) => <div key={width} className="mb-6 space-y-2.5"><Line className="h-2.5 w-24" /><Line className={`h-1.5 ${width}`} />{i < 2 ? <Line className="h-1.5 w-3/5" /> : null}</div>)}
      </div>
      <div className="hidden w-[320px] shrink-0 space-y-4 pt-14 xl:block"><Line className="h-3 w-24" /><div className="space-y-3 rounded-xl border-2 border-line p-4"><Line className="h-3 w-32" /><Line className="h-2 w-full" /><Line className="h-2 w-3/4" /></div></div>
    </div>;
  } else if (variant === "dashboard") {
    content = <div className="space-y-8"><Line className="h-5 w-40" /><div className="grid grid-cols-2 gap-6 lg:grid-cols-4">{[0,1,2,3].map(i => <div key={i} className="space-y-4 border-b border-line pb-5"><Line className="h-3 w-24" /><Line className="h-8 w-16" /></div>)}</div><Rows /></div>;
  } else if (variant === "form") {
    content = <div className="max-w-3xl space-y-7">{[0,1,2].map(i => <div key={i} className="space-y-3"><Line className="h-3 w-28" /><div className="h-20 rounded border border-line bg-surface-muted/30" /></div>)}</div>;
  } else content = <Rows />;
  return <div className={reserveClassName} aria-busy={active || undefined} role={active ? "status" : undefined} aria-label={active ? label : undefined}>
    {active ? <div className={`quality-skeleton${variant === "document" ? " quality-skeleton-document" : ""}`} aria-hidden="true">{content}</div> : null}
  </div>;
}

function Rows() {
  return <div className="overflow-hidden rounded-md border border-line">
    <div className="flex gap-8 border-b border-line px-5 py-4"><Line className="h-2 w-20" /><Line className="h-2 w-32" /></div>
    {[0,1,2,3].map(i => <div key={i} className="flex items-center gap-8 border-b border-line px-5 py-5 last:border-0"><Line className="h-2 w-20 shrink-0" /><Line className={`h-3 ${i % 2 ? "w-2/5" : "w-1/2"}`} /><Line className="ml-auto h-4 w-16 shrink-0" /></div>)}
  </div>;
}
