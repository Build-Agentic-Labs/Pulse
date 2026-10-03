import { AwiDirectoryShell } from "./awi-directory-shell";

export function AwiDirectoryColumns() {
  return <div className="grid grid-cols-[minmax(110px,0.5fr)_minmax(0,2fr)_minmax(100px,1fr)_24px] gap-4 border-b border-line px-2 py-3 text-[10px] uppercase tracking-wider text-ink-tertiary">
    <span>Document number</span><span>Instruction</span><span>Status</span><span />
  </div>;
}

export function AwiDirectoryLoadingContent() {
  return <>
    <div className="flex items-start justify-between gap-4 border-b border-line pb-5">
      <div><h1 className="ui-section-title">AWI Master List</h1>
        <p className="ui-section-subtitle mt-1">Common assembly work instructions across the product portfolio.</p></div>
      <span className="ui-transition-status" role="status" aria-live="polite">Opening AWI Master List</span>
    </div>
    <div className="mt-5">
      <AwiDirectoryColumns />
      <div aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="grid grid-cols-[minmax(110px,0.5fr)_minmax(0,2fr)_minmax(100px,1fr)_24px] items-center gap-4 border-b border-line px-2 py-4">
          <span className="ui-skeleton-line block h-2 w-20" />
          <span className="ui-skeleton-line block h-2 w-48 max-w-full" />
          <span className="ui-skeleton-line block h-2 w-16" /><span />
        </div>)}
      </div>
    </div>
  </>;
}

export function AwiDirectoryLoadingState() {
  return <AwiDirectoryShell loading><AwiDirectoryLoadingContent /></AwiDirectoryShell>;
}
