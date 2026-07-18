export function RouteLoadingState({ label = "Loading workspace" }: { label?: string }) {
  return (
    <main className="flex h-full min-h-[360px] w-full items-center justify-center bg-canvas px-6">
      <div className="flex items-center gap-3 text-ink-secondary" role="status" aria-live="polite">
        <span className="h-5 w-1 animate-pulse bg-accent" aria-hidden="true" />
        <span className="ui-mono-label">{label}</span>
      </div>
    </main>
  );
}
