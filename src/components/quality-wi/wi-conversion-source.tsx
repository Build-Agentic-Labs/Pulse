import type { ConversionSource } from "@/domain/quality-wi/conversion";
export function WiConversionSource({ source }: { source: ConversionSource }) {
  const metadata = source.metadata;
  return (
    <details className="rounded border border-line p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Source document
        {source.warnings.length
          ? ` · ${source.warnings.length} review notes`
          : ""}
      </summary>
      <p className="mt-3 text-ink-secondary">{source.fileName}</p>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-xs">
        {(
          [
            ["Original title", metadata.title],
            ["Original author", metadata.author],
            ["Original number", metadata.documentNumber],
            ["Original revision", metadata.revision],
            ["Original date", metadata.date],
            ["Original department", metadata.department],
          ] as const
        )
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-secondary">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
      </dl>
      {source.warnings.length ? (
        <ul className="mt-4 list-disc space-y-2 pl-5 text-xs text-ink-secondary">
          {source.warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}
