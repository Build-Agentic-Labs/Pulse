import { expect, it, vi } from "vitest";
import { createCoalescedRefresh } from "./coalesced-refresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it("shares overlapping reads and performs one trailing read for mutation bursts", async () => {
  const old = deferred<number>();
  const read = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(2);
  const refresh = createCoalescedRefresh(read);
  const first = refresh.run({});
  await Promise.resolve();
  expect(refresh.run({})).toBe(first);
  const mutation = refresh.run({ force: true });
  refresh.run({ force: true });
  expect(read).toHaveBeenCalledTimes(1);
  old.resolve(1);
  expect(await mutation).toBe(2);
  expect(await first).toBe(2);
  expect(read).toHaveBeenCalledTimes(2);
  await refresh.run({});
  expect(read).toHaveBeenCalledTimes(3); // No settled permission/data cache.
});

it("invalidates old results and queued work on scope cleanup without blocking the next load", async () => {
  const old = deferred<number>();
  const checks: (() => boolean)[] = [];
  const read = vi.fn((_options, isCurrent: () => boolean) => {
    checks.push(isCurrent);
    return checks.length === 1 ? old.promise : Promise.resolve(2);
  });
  const refresh = createCoalescedRefresh(read);
  const first = refresh.run({});
  await Promise.resolve();
  refresh.run({ force: true });
  refresh.cancel();
  expect(checks[0]()).toBe(false);
  expect(await refresh.run({})).toBe(2);
  old.resolve(1);
  await first;
  expect(read).toHaveBeenCalledTimes(2);
  expect(checks[1]()).toBe(true);
});
