/** Share reads, but never lose a refresh requested after a mutation. No settled cache. */
export interface RefreshOptions { background?: boolean; force?: boolean }

export function createCoalescedRefresh<T>(
  read: (options: RefreshOptions, isCurrent: () => boolean) => Promise<T>,
) {
  let generation = 0;
  let pending: { promise: Promise<T>; next?: RefreshOptions } | undefined;
  return {
    cancel() {
      generation += 1;
      pending = undefined;
    },
    run(options: RefreshOptions): Promise<T> {
      if (pending) {
        if (options.force) pending.next = options;
        return pending.promise;
      }
      const started = generation;
      const current = { promise: undefined as unknown as Promise<T>, next: undefined as RefreshOptions | undefined };
      pending = current;
      current.promise = Promise.resolve().then(async () => {
        let next = options;
        for (;;) {
          let result: T;
          try {
            result = await read(next, () => generation === started);
          } catch (error) {
            if (generation !== started || !current.next) throw error;
            next = current.next;
            current.next = undefined;
            continue;
          }
          if (generation !== started || !current.next) return result;
          next = current.next;
          current.next = undefined;
        }
      }).finally(() => {
        if (pending === current) pending = undefined;
      });
      return current.promise;
    },
  };
}
