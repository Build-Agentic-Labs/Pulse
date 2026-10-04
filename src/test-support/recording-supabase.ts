// A scripted Supabase stand-in that records every request in the order it is SENT (when the query is
// awaited), with its filters, modifiers and payload. Tests use it to pin request order, scoping and
// failure behaviour of the REAL persistence functions. Replies come from a test-supplied function;
// anything it does not answer gets an empty success. Unsupported query methods are absent on purpose:
// a new query shape fails loudly instead of being silently accepted.

export type RecordedRequest = {
  kind: "from" | "rpc" | "storage" | "auth";
  /** Table, RPC name, storage bucket, or "auth". */
  target: string;
  /** select / insert / upsert / update / delete, "rpc", a storage method, or an auth method. */
  op: string;
  columns?: string;
  payload?: unknown;
  options?: unknown;
  filters: string[];
  modifiers: string[];
};

export type ScriptedReply = { data?: unknown; error?: { message: string; code?: string } | null };

const show = (value: unknown) => (Array.isArray(value) ? `[${value.join(",")}]` : String(value));

export function createRecordingSupabase(options: {
  userId?: string | null;
  user?: Record<string, unknown>;
  reply?: (request: RecordedRequest) => ScriptedReply | undefined;
} = {}) {
  const requests: RecordedRequest[] = [];
  const user = options.user ?? (options.userId ? { id: options.userId } : null);

  const defaultReply = (request: RecordedRequest): ScriptedReply => {
    if (request.kind === "from" && request.op === "select" &&
        !request.modifiers.includes("single") && !request.modifiers.includes("maybeSingle")) {
      return { data: [], error: null };
    }
    return { data: null, error: null };
  };

  const send = (request: RecordedRequest) => {
    requests.push(request);
    const reply = options.reply?.(request) ?? defaultReply(request);
    return { data: reply.data ?? null, error: reply.error ?? null };
  };

  class Builder {
    private sent = false;
    readonly request: RecordedRequest;
    constructor(kind: "from" | "rpc", target: string, op = "select", payload?: unknown) {
      this.request = { kind, target, op, payload, filters: [], modifiers: [] };
    }
    private write(op: string, payload?: unknown, writeOptions?: unknown) {
      this.request.op = op;
      this.request.payload = payload;
      if (writeOptions !== undefined) this.request.options = writeOptions;
      return this;
    }
    select(columns = "*") {
      if (this.request.kind === "from" && this.request.op === "select") this.request.columns = columns;
      else this.request.modifiers.push(`returning(${columns})`);
      return this;
    }
    insert(payload: unknown) { return this.write("insert", payload); }
    upsert(payload: unknown, upsertOptions?: unknown) { return this.write("upsert", payload, upsertOptions); }
    update(payload: unknown) { return this.write("update", payload); }
    delete() { return this.write("delete"); }
    eq(column: string, value: unknown) { this.request.filters.push(`${column}=${show(value)}`); return this; }
    neq(column: string, value: unknown) { this.request.filters.push(`${column}!=${show(value)}`); return this; }
    lt(column: string, value: unknown) { this.request.filters.push(`${column}<${show(value)}`); return this; }
    is(column: string, value: unknown) { this.request.filters.push(`${column} is ${show(value)}`); return this; }
    in(column: string, values: unknown[]) { this.request.filters.push(`${column} in ${show(values)}`); return this; }
    or(filter: string) { this.request.filters.push(`or(${filter})`); return this; }
    order(column: string, orderOptions?: { ascending?: boolean; nullsFirst?: boolean }) {
      const direction = orderOptions?.ascending === false ? " desc" : "";
      const nulls = orderOptions?.nullsFirst === false ? " nullslast" : "";
      this.request.modifiers.push(`order(${column}${direction}${nulls})`);
      return this;
    }
    limit(count: number) { this.request.modifiers.push(`limit(${count})`); return this; }
    range(from: number, to: number) { this.request.modifiers.push(`range(${from},${to})`); return this; }
    single() { this.request.modifiers.push("single"); return this; }
    maybeSingle() { this.request.modifiers.push("maybeSingle"); return this; }
    then<A, B>(onFulfilled?: (value: { data: unknown; error: ScriptedReply["error"] }) => A, onRejected?: (reason: unknown) => B) {
      if (this.sent) throw new Error(`Request awaited twice: ${describeRequest(this.request)}`);
      this.sent = true;
      return Promise.resolve(send(this.request)).then(onFulfilled, onRejected);
    }
  }

  const storage = {
    from(bucket: string) {
      const call = (method: string, payload: unknown) =>
        Promise.resolve(send({ kind: "storage", target: bucket, op: method, payload, filters: [], modifiers: [] }));
      return {
        upload: (path: string) => call("upload", [path]),
        remove: (paths: string[]) => call("remove", paths),
        createSignedUrl: (path: string) => call("createSignedUrl", [path]),
        createSignedUrls: (paths: string[]) => call("createSignedUrls", paths),
      };
    },
  };

  const auth = (op: string, payload?: unknown) =>
    requests.push({ kind: "auth", target: "auth", op, payload, filters: [], modifiers: [] });

  const client = {
    from: (table: string) => new Builder("from", table),
    rpc: (name: string, args?: unknown) => new Builder("rpc", name, "rpc", args),
    storage,
    auth: {
      async getSession() {
        auth("getSession");
        return { data: { session: user ? { user } : null }, error: null };
      },
      async getUser() {
        auth("getUser");
        return { data: { user }, error: null };
      },
      async updateUser(attributes: unknown) {
        auth("updateUser", attributes);
        const reply = options.reply?.({ kind: "auth", target: "auth", op: "updateUser", payload: attributes, filters: [], modifiers: [] });
        return { data: { user }, error: reply?.error ?? null };
      },
    },
  };

  return {
    client,
    requests,
    /** One line per request, in send order: `table.op(columns) filters | modifiers`. */
    lines: () => requests.map(describeRequest),
    writes: () => requests.filter((request) => request.kind === "from" && request.op !== "select"),
  };
}

export function describeRequest(request: RecordedRequest): string {
  if (request.kind === "auth") return `auth.${request.op}`;
  if (request.kind === "storage") return `storage:${request.target}.${request.op}(${show(request.payload)})`;
  if (request.kind === "rpc") return `rpc:${request.target}`;
  const columns = request.op === "select" ? `(${request.columns ?? "*"})` : "";
  const filters = request.filters.length ? ` ${request.filters.join(" ")}` : "";
  const modifiers = request.modifiers.length ? ` | ${request.modifiers.join(" ")}` : "";
  return `${request.target}.${request.op}${columns}${filters}${modifiers}`;
}
