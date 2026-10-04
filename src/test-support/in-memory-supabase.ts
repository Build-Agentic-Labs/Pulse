// A small in-memory stand-in for the Supabase client, for tests that run the REAL persistence functions
// and assert on what ends up stored (rows, storage objects, signing calls) rather than on mocks.
// Supports the query shapes the planner persistence code uses: select/insert/upsert/update/delete,
// eq/in/is/neq filters, order/range/limit, single/maybeSingle, rpc, auth.getSession, and storage.

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "upsert" | "update" | "delete";

export type StorageCall = { bucket: string; method: string; paths: string[] };

export function createInMemorySupabase(options: {
  /** Answer for every project-resolving RPC (task_project_id, scenario_project_id, ...). */
  projectId?: string | null;
  /** The signed-in user returned by auth.getSession. */
  userId?: string | null;
  /** Storage paths whose signing fails (createSignedUrl(s) returns no URL for them). */
  unsignablePaths?: string[];
  /** Same, for paths only known at run time (e.g. generated ids). */
  isUnsignable?: (path: string) => boolean;
} = {}) {
  const tables = new Map<string, Row[]>();
  const storageObjects = new Map<string, Blob | string>();
  const storageCalls: StorageCall[] = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const writes: Array<{ table: string; op: Op }> = [];
  let getUserCalls = 0;
  const rows = (table: string) => tables.get(table) ?? [];
  const unsignableSet = new Set(options.unsignablePaths ?? []);
  const unsignable = { has: (path: string) => unsignableSet.has(path) || Boolean(options.isUnsignable?.(path)) };

  class Query {
    private op: Op = "select";
    private payload: unknown;
    private filters: Array<(row: Row) => boolean> = [];
    private one: "single" | "maybe" | null = null;
    private rangeArgs: [number, number] | null = null;
    private returning = false;
    constructor(private readonly table: string) {}
    select() { if (this.op !== "select") this.returning = true; return this; }
    insert(payload: unknown) { this.op = "insert"; this.payload = payload; return this; }
    upsert(payload: unknown) { this.op = "upsert"; this.payload = payload; return this; }
    update(payload: unknown) { this.op = "update"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => String(row[column]) === String(value)); return this; }
    neq(column: string, value: unknown) { this.filters.push((row) => String(row[column]) !== String(value)); return this; }
    is(column: string, value: unknown) { this.filters.push((row) => (row[column] ?? null) === value); return this; }
    in(column: string, values: unknown[]) {
      const allowed = new Set(values.map(String));
      this.filters.push((row) => allowed.has(String(row[column])));
      return this;
    }
    or() { return this; }
    order() { return this; }
    limit() { return this; }
    range(from: number, to: number) { this.rangeArgs = [from, to]; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    private run() {
      const matches = (row: Row) => this.filters.every((filter) => filter(row));
      let data: unknown = null;
      if (this.op === "select") {
        let found = rows(this.table).filter(matches);
        if (this.rangeArgs) found = found.slice(this.rangeArgs[0], this.rangeArgs[1] + 1);
        data = this.one ? found[0] ?? null : found;
        if (this.one === "single" && !found[0]) {
          return { data: null, error: { message: `No ${this.table} row` } };
        }
        return { data, error: null };
      }
      writes.push({ table: this.table, op: this.op });
      if (this.op === "insert" || this.op === "upsert") {
        const incoming = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        const next = [...rows(this.table)];
        const saved = incoming.map((row) => {
          const index = next.findIndex((existing) => existing.id === row.id);
          if (index >= 0 && this.op === "insert") throw new Error(`duplicate ${this.table}.id ${String(row.id)}`);
          const merged = { ...(index >= 0 ? next[index] : {}), ...row };
          if (index >= 0) next[index] = merged; else next.push(merged);
          return merged;
        });
        tables.set(this.table, next);
        data = this.returning ? (this.one ? saved[0] : saved) : null;
      } else if (this.op === "update") {
        const updated: Row[] = [];
        tables.set(this.table, rows(this.table).map((row) => {
          if (!matches(row)) return row;
          const next = { ...row, ...(this.payload as Row) };
          updated.push(next);
          return next;
        }));
        data = this.returning ? (this.one ? updated[0] ?? null : updated) : null;
      } else {
        tables.set(this.table, rows(this.table).filter((row) => !matches(row)));
      }
      return { data, error: null };
    }
    then<A, B>(onFulfilled?: (value: { data: unknown; error: { message: string } | null }) => A, onRejected?: (reason: unknown) => B) {
      return Promise.resolve().then(() => this.run()).then(onFulfilled, onRejected);
    }
  }

  const signed = (bucket: string, path: string) => `https://signed.test/${bucket}/${path}?token=1`;
  const storage = {
    from(bucket: string) {
      const record = (method: string, paths: string[]) => storageCalls.push({ bucket, method, paths });
      return {
        async upload(path: string, body: Blob | string) {
          record("upload", [path]);
          storageObjects.set(`${bucket}/${path}`, body);
          return { data: { path }, error: null };
        },
        async copy(from: string, to: string) {
          record("copy", [from, to]);
          storageObjects.set(`${bucket}/${to}`, storageObjects.get(`${bucket}/${from}`) ?? "");
          return { data: { path: to }, error: null };
        },
        async remove(paths: string[]) {
          record("remove", paths);
          paths.forEach((path) => storageObjects.delete(`${bucket}/${path}`));
          return { data: paths.map((name) => ({ name })), error: null };
        },
        async createSignedUrl(path: string) {
          record("createSignedUrl", [path]);
          return unsignable.has(path)
            ? { data: null, error: { message: "cannot sign" } }
            : { data: { signedUrl: signed(bucket, path) }, error: null };
        },
        async createSignedUrls(paths: string[]) {
          record("createSignedUrls", paths);
          return { data: paths.map((path) => ({ path, signedUrl: unsignable.has(path) ? null : signed(bucket, path), error: null })), error: null };
        },
      };
    },
  };

  const client = {
    from: (table: string) => new Query(table),
    rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: options.projectId ?? null, error: null });
    },
    storage,
    auth: {
      async getSession() {
        return { data: { session: options.userId ? { user: { id: options.userId } } : null }, error: null };
      },
      async getUser() {
        getUserCalls += 1;
        return { data: { user: options.userId ? { id: options.userId } : null }, error: null };
      },
    },
  };

  return {
    client,
    rows,
    seed(table: string, data: Row[]) { tables.set(table, [...rows(table), ...data]); },
    storageCalls,
    storageObjects,
    rpcCalls,
    writes,
    getUserCalls: () => getUserCalls,
    signedUrlFor: signed,
  };
}
