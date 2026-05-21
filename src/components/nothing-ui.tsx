"use client";

export function NothingSpinner({ className = "", inline = false }: { className?: string; inline?: boolean }) {
  return (
    <div
      className={`nd-spinner-segments ${inline ? "nd-spinner-inline" : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      <span className="nd-spinner-segment" />
      <span className="nd-spinner-segment" />
      <span className="nd-spinner-segment" />
      <span className="nd-spinner-segment" />
    </div>
  );
}

export function NothingStatus({
  children,
  error = false,
  className = "",
}: {
  children: string;
  error?: boolean;
  className?: string;
}) {
  return (
    <span className={`nd-status ${error ? "nd-status-error" : ""} ${className}`.trim()}>[{children}]</span>
  );
}

export function NothingLoadingBlock({
  title = "Loading",
  body,
  compact = false,
}: {
  title?: string;
  body?: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-4 ${compact ? "" : "py-2"}`}>
      <NothingSpinner />
      <div>
        <NothingStatus>{title.toUpperCase()}</NothingStatus>
        {body ? <p className="nd-caption mt-2">{body}</p> : null}
      </div>
    </div>
  );
}

export function NothingLoadingShell({
  title = "Loading workspace",
  body = "Reading the latest planner data.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <main className="ui-flow-shell">
      <section className="ui-auth-card">
        <div className="ui-auth-card-body">
          <NothingLoadingBlock title={title} body={body} />
        </div>
      </section>
    </main>
  );
}
