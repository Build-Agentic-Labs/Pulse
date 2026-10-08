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
  conflicted: boolean;
};
async function saveStage<T>(label: string, task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out. Your draft has been retained. Retry saving.`)), 15_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Confirmation = { id: string; version: number; operation?: string };
export type WiEditorDependencies = {
  loadRecovery: () => Promise<PendingWiEdit[]>;
  archiveRecovery?: (pending: PendingWiEdit[]) => Promise<void>;
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
  private acceptingOperations: Set<string> | null = null;
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
      conflicted: false,
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
      await saveStage("Browser draft storage", this.deps.storeRecovery(this.pending));
    } catch {
      this.emit({
        localWarning:
          "Browser recovery is unavailable. Keep this page open until Saved.",
      });
    }
  }
  async start() {
    try {
      const entries = await saveStage("Browser draft recovery", this.deps.loadRecovery());
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
    const operation = crypto.randomUUID();
    // Edits typed during replacement belong to the new draft, not the archived batch.
    this.pending = this.acceptingOperations?.has(this.pending.at(-1)?.operation ?? "")
      ? [...this.pending, { operation, edit }]
      : appendWiEdit(this.pending, edit, operation);
    if (
      this.pending.length === 1 &&
      this.pending[0].baseVersion === undefined &&
      this.pending[0].expectedVersion === undefined
    )
      this.pending[0].baseVersion = this.server.version;
    if (this.snapshot.conflicted) this.emit({ status: "error" });
    else this.emit({ status: "saving", message: "" });
    void this.remember();
    if (!this.snapshot.conflicted && !this.acceptingOperations) this.schedule();
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
    if (this.snapshot.conflicted || this.acceptingOperations) return Promise.resolve(false);
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
        const result = await saveStage("Work instruction save", this.deps.save(
          structuredClone(entry),
          this.assertCurrent,
        ));
        this.assertCurrent();
        if (
          result.id !== this.server.id ||
          result.operation !== entry.operation
        )
          throw new Error(
            "Unable to confirm this edit. Your draft has been retained.",
          );
        const fresh = await saveStage("Saved draft confirmation", this.deps.reload());
        this.assertCurrent();
        if (fresh.id !== this.server.id || fresh.version < result.version)
          throw new Error("Unable to confirm the saved draft.");
        await saveStage("Browser draft acknowledgement", this.deps.acknowledge(entry));
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
          conflicted: Boolean(error && typeof error === "object" && "code" in error && error.code === "PT409"),
          message:
            error instanceof Error
              ? error.message
              : "Unable to save. Your draft has been retained.",
        });
      return false;
    }
  }
  acceptSaved = async () => {
    if (this.disposed || this.running || this.snapshot.publishing || this.acceptingOperations || !this.deps.archiveRecovery) return false;
    const replacing = structuredClone(this.pending);
    const operations = new Set(replacing.map(entry => entry.operation));
    this.acceptingOperations = operations;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      const fresh = await saveStage("Saved draft confirmation", this.deps.reload());
      this.assertCurrent();
      if (fresh.id !== this.server.id || fresh.version < this.server.version)
        throw new Error("Unable to confirm the saved draft.");
      await saveStage("Browser draft archive", this.deps.archiveRecovery(replacing));
      this.assertCurrent();
      this.server = fresh;
      this.pending = this.pending.filter(entry => !operations.has(entry.operation));
      if (this.pending[0]) this.pending[0].baseVersion = fresh.version;
      await this.remember();
      this.assertCurrent();
      this.emit({ status: this.pending.length ? "saving" : "saved", conflicted: false, message: "" });
      if (this.pending.length) this.schedule();
      return true;
    } catch (error) {
      this.emit({ status: "error", message: error instanceof Error ? error.message : "Could not load the saved draft." });
      return false;
    } finally {
      this.acceptingOperations = null;
    }
  };
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
      const result = await saveStage("Work instruction publication", this.deps.publish(
        intent.version,
        intent.operation,
        intent.description,
        this.assertCurrent,
      ));
      this.assertCurrent();
      const fresh = await saveStage("Saved draft confirmation", this.deps.reload());
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
