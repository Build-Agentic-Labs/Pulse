"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { ThemedFeedbackLayer, type FeedbackConfirm, type FeedbackTone } from "./themed-feedback";

/** Options for a single confirmation, minus the imperative onConfirm wiring the hook supplies. */
export type ConfirmOptions = {
  title: string;
  body?: string;
  tone?: FeedbackTone;
  confirmLabel?: string;
  cancelLabel?: string;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * App-wide confirmation dialog. Mounted once in the root layout so every surface —
 * galleries, SOP list, the portal, placeholders — resolves destructive actions through
 * the same themed dialog (Escape + backdrop to cancel) instead of native window.confirm.
 *
 * The planner and sidebar keep their own richer ThemedFeedbackLayer instances (they also
 * drive toasts); those render the identical dialog, so the experience is uniform.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<FeedbackConfirm>();
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);

  const settle = useCallback(
    (value: boolean) => {
      setPending(undefined);
      setResolver((current: ((value: boolean) => void) | null) => {
        current?.(value);
        return null;
      });
    },
    [],
  );

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setResolver(() => resolve);
        setPending({
          title: options.title,
          body: options.body,
          tone: options.tone ?? "danger",
          confirmLabel: options.confirmLabel,
          cancelLabel: options.cancelLabel,
          placement: "center",
          onConfirm: () => undefined,
        });
      }),
    [],
  );

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <ThemedFeedbackLayer
        confirm={pending}
        toasts={[]}
        onDismissToast={() => undefined}
        onCancelConfirm={() => settle(false)}
        onConfirm={() => settle(true)}
      />
    </ConfirmContext.Provider>
  );
}

/**
 * Returns an async confirm() — `await confirm({ title, tone })` resolves true on confirm,
 * false on cancel/Escape/backdrop. Falls back to window.confirm if used outside the
 * provider so a stray caller never silently no-ops.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return useMemo<ConfirmFn>(() => {
    if (ctx) {
      return ctx;
    }
    return async ({ title, body }) =>
      typeof window !== "undefined" && window.confirm(body ? `${title}\n\n${body}` : title);
  }, [ctx]);
}
