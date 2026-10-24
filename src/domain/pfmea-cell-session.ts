import type { PfmeaDocument } from './pfmea';
import { buildPfmeaCellChanges, type PfmeaCellChange, type PfmeaCellVersions } from './pfmea-cell-changes';
import { buildPfmeaDocumentCommand } from './pfmea-document-command';

type CellAcknowledgement = { document: PfmeaDocument; versions: PfmeaCellVersions };
export type PfmeaPendingCellMutation = { mutationId: string; changes: PfmeaCellChange[]; snapshot: PfmeaDocument; command?: { base: PfmeaDocument; document: PfmeaDocument } };

/** One editor's acknowledged baseline. Other editors' cells never become local changes. */
export function createPfmeaCellSession(options: {
  document: PfmeaDocument;
  versions: PfmeaCellVersions;
  mutationId: () => string;
  send: (mutationId: string, changes: PfmeaCellChange[]) => Promise<CellAcknowledgement>;
  sendCommand?: (mutationId: string, base: PfmeaDocument, document: PfmeaDocument) => Promise<CellAcknowledgement>;
  pending?: PfmeaPendingCellMutation;
  retain?: (pending: PfmeaPendingCellMutation) => void;
  acknowledge?: (snapshot: PfmeaDocument, baseline: PfmeaDocument) => void;
}) {
  let baseline = structuredClone(options.document);
  let versions = structuredClone(options.versions);
  let remote = structuredClone(options.document);
  let pending = options.pending ? structuredClone(options.pending) : undefined;
  let flight: Promise<CellAcknowledgement> | undefined;

  async function save(snapshot: PfmeaDocument): Promise<CellAcknowledgement> {
    // Serialize callers. A failed request retains its exact ID and payload for safe retries.
    if (flight) { await flight; return save(snapshot); }
    if (!pending) {
      let changes: PfmeaCellChange[];
      try { changes = buildPfmeaCellChanges(baseline, snapshot, versions); }
      catch (error) {
        if (!options.sendCommand) throw error;
        pending = { mutationId: options.mutationId(), changes: [], snapshot: structuredClone(snapshot), command: { base: structuredClone(remote), document: buildPfmeaDocumentCommand(baseline, snapshot, remote) } };
        changes = [];
      }
      if (!pending && !changes.length) {
        options.acknowledge?.(snapshot, { ...snapshot, cellVersions: versions });
        return { document: structuredClone(remote), versions: structuredClone(versions) };
      }
      pending ??= { mutationId: options.mutationId(), changes, snapshot: structuredClone(snapshot) };
    }
    const request = pending;
    options.retain?.(request);
    const send = request.command
      ? options.sendCommand!(request.mutationId, request.command.base, request.command.document)
      : options.send(request.mutationId, request.changes);
    flight = send.then(ack => {
      if (ack.document.id !== baseline.id || ack.document.productId !== baseline.productId) throw new Error('PFMEA acknowledgement scope changed.');
      baseline = request.snapshot;
      versions = structuredClone(ack.versions);
      remote = structuredClone(ack.document);
      options.acknowledge?.(request.snapshot, { ...request.snapshot, cellVersions: ack.versions });
      pending = undefined;
      return ack;
    });
    try { await flight; }
    finally { flight = undefined; }
    // A retry may also carry newer typing. Only send that delta after the old edit is confirmed.
    return save(snapshot);
  }

  return { save, hasPending: () => Boolean(pending || flight) };
}
