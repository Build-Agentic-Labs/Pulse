import {
  applyWiEdit,
  wiPublishProblems,
  type PendingWiEdit,
  type QualityWi,
  type WiEdit,
} from "@/domain/quality-wi/schema";
import { appendWiEdit } from "@/domain/quality-wi/edit-queue";

type Snapshot = {
  document: QualityWi;
  ready: boolean;
  status: "saved" | "saving" | "error";
  message: string;
  localWarning: string;
  pending: number;
  publishing: boolean;
};
type Confirmation = { id: string; version: number; operation?: string };
export type WiEditorDependencies = {
  loadRecovery: () => Promise<PendingWiEdit[]>;
  storeRecovery: (pending: PendingWiEdit[]) => Promise<void>;
  acknowledge: (entry: PendingWiEdit) => Promise<void>;
  save: (
    entry: PendingWiEdit,
    assertCurrent: () => void,
  ) => Promise<Confirmation>;
  reload: () => Promise<QualityWi>;
  publish: (
    version: number,
    operation: string,
    description: string,
    assertCurrent: () => void,
  ) => Promise<Confirmation>;
};
/** Scope-owned controller. No React, global mutable state, full-document saver or implicit retries. */
export class WiEditorController {
  private server: QualityWi;
  private pending: PendingWiEdit[] = [];
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private disposed = false;
  private running: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private publishIntent: {
    version: number;
    operation: string;
    description: string;
  } | null = null;
  constructor(
    initial: QualityWi,
    private readonly deps: WiEditorDependencies,
  ) {
    this.server = initial;
    this.snapshot = {
      document: initial,
      ready: false,
      status: "saved",
      message: "",
      localWarning: "",
      pending: 0,
      publishing: false,
    };
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private assertCurrent = () => {
    if (this.disposed)
      throw new Error("Editor changed. Your draft has been retained.");
  };
  private emit(patch: Partial<Snapshot> = {}) {
    if (this.disposed) return;
    let document = this.server;
    for (const entry of this.pending) {
      try {
        document = applyWiEdit(document, entry.edit);
      } catch {
        patch = {
          ...patch,
          message:
            "The step list changed. Your pending order is retained; review the saved document before retrying.",
        };
      }
    }
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      document,
      pending: this.pending.length,
    };
    for (const listener of this.listeners) listener();
  }
  private async remember() {
    try {
      await this.deps.storeRecovery(this.pending);
    } catch {
      this.emit({
        localWarning:
          "Browser recovery is unavailable. Keep this page open until Saved.",
      });
    }
  }
  async start() {
    try {
      const entries = await this.deps.loadRecovery();
      this.assertCurrent();
      this.pending = entries;
      this.emit({ ready: true, status: entries.length ? "saving" : "saved" });
      if (entries.length) this.schedule();
    } catch (error) {
      if (this.disposed) return;
      this.emit({
        ready: true,
        localWarning:
          error instanceof Error
            ? error.message
            : "Browser recovery is unavailable.",
      });
    }
  }
  edit(edit: WiEdit) {
    if (this.disposed || !this.snapshot.ready || this.snapshot.publishing)
      return;
    this.publishIntent = null;
    this.pending = appendWiEdit(this.pending, edit, crypto.randomUUID());
    if (
      this.pending.length === 1 &&
      this.pending[0].baseVersion === undefined &&
      this.pending[0].expectedVersion === undefined
    )
      this.pending[0].baseVersion = this.server.version;
    this.emit({ status: "saving", message: "" });
    void this.remember();
    this.schedule();
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 350);
  }
  flush = (): Promise<boolean> => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  };
  private async run() {
    try {
      this.assertCurrent();
      if (this.pending.length) this.emit({ status: "saving", message: "" });
      while (this.pending.length) {
        const entry = this.pending[0];
        if (entry.expectedVersion === undefined)
          entry.expectedVersion = entry.baseVersion ?? this.server.version;
        entry.issued = true;
        await this.remember();
        this.assertCurrent();
        const result = await this.deps.save(
          structuredClone(entry),
          this.assertCurrent,
        );
        this.assertCurrent();
        if (
          result.id !== this.server.id ||
          result.operation !== entry.operation
        )
          throw new Error(
            "Unable to confirm this edit. Your draft has been retained.",
          );
        const fresh = await this.deps.reload();
        this.assertCurrent();
        if (fresh.id !== this.server.id || fresh.version < result.version)
          throw new Error("Unable to confirm the saved draft.");
        await this.deps.acknowledge(entry);
        this.assertCurrent();
        this.server = fresh;
        this.pending = this.pending.filter(
          (e) => e.operation !== entry.operation,
        );
        if (this.pending[0] && this.pending[0].expectedVersion === undefined)
          this.pending[0].baseVersion = result.version;
        await this.remember();
        this.emit({
          status: this.pending.length ? "saving" : "saved",
          message: "",
        });
      }
      return true;
    } catch (error) {
      if (!this.disposed)
        this.emit({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Unable to save. Your draft has been retained.",
        });
      return false;
    }
  }
  publish = async (description: string) => {
    if (this.snapshot.publishing || this.disposed) return false;
    if (
      !(await this.flush()) ||
      this.pending.length ||
      this.snapshot.publishing ||
      this.disposed
    )
      return false;
    const problems = wiPublishProblems(this.server);
    if (problems.length) {
      this.emit({ message: problems.join(" ") });
      return false;
    }
    if (!description.trim()) {
      this.emit({ message: "Add a revision description." });
      return false;
    }
    if (!this.publishIntent || this.publishIntent.description !== description)
      this.publishIntent = {
        version: this.server.version,
        operation: crypto.randomUUID(),
        description,
      };
    const intent = this.publishIntent;
    this.emit({ publishing: true, status: "saving", message: "" });
    try {
      const result = await this.deps.publish(
        intent.version,
        intent.operation,
        intent.description,
        this.assertCurrent,
      );
      this.assertCurrent();
      const fresh = await this.deps.reload();
      this.assertCurrent();
      if (fresh.id !== this.server.id || fresh.version < result.version)
        throw new Error("Unable to confirm publication.");
      this.server = fresh;
      this.publishIntent = null;
      this.emit({ publishing: false, status: "saved" });
      return true;
    } catch (error) {
      if (!this.disposed)
        this.emit({
          publishing: false,
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "Publication could not be confirmed.",
        });
      return false;
    }
  };
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
