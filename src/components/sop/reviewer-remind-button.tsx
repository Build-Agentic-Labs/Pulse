"use client";

import { BellRing, Check, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatDateTime } from "@/domain/formatting";
import { reminderCoolingDown } from "@/domain/sop/reviewer-reminder";
import { ReminderCooldownError, remindSopReviewer } from "@/lib/sop/review";

/**
 * "Remind" for one reviewer who hasn't returned their draft review. Guard rails:
 * a synchronous in-flight lock (a double click fires once), a disabled
 * "Reminded" state until the 24-hour window ends, and the database refusing
 * anything the button lets through (another tab, a stale panel).
 */
export function ReviewerRemindButton({
  sopId,
  reviewerId,
  reviewerName,
  nextAllowedAt,
  onReminded,
}: {
  sopId: string;
  reviewerId: string;
  reviewerName: string;
  /** When this reviewer may next be reminded; null when never reminded. */
  nextAllowedAt: string | null;
  onReminded: (nextAllowedAt: string) => void;
}) {
  const inFlight = useRef(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  // Re-enable on its own when the window closes while the panel stays open.
  useEffect(() => {
    if (!nextAllowedAt) return;
    const wait = new Date(nextAllowedAt).getTime() - Date.now();
    if (!(wait > 0)) return;
    const id = window.setTimeout(() => setNow(new Date()), Math.min(wait + 500, 2_147_000_000));
    return () => window.clearTimeout(id);
  }, [nextAllowedAt]);

  const coolingDown = reminderCoolingDown(nextAllowedAt, now);

  async function remind() {
    if (inFlight.current || coolingDown) return;
    inFlight.current = true;
    setSending(true);
    setError("");
    try {
      const next = await remindSopReviewer(sopId, reviewerId);
      setNow(new Date());
      onReminded(next);
    } catch (caught) {
      if (caught instanceof ReminderCooldownError) {
        // Someone (another tab) already reminded them; adopt the database's window.
        if (caught.nextAllowedAt) onReminded(caught.nextAllowedAt);
        else setError(caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : "Could not send the reminder.");
      }
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  const title = coolingDown
    ? `Reminded. You can remind ${reviewerName} again after ${formatDateTime(nextAllowedAt)}.`
    : `Email ${reviewerName} a reminder to return their review`;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="ui-btn-ghost inline-flex h-7 items-center gap-1.5 px-2.5 text-[12px] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={sending || coolingDown}
        aria-busy={sending}
        title={title}
        aria-label={title}
        onClick={() => void remind()}
      >
        {sending ? (
          <Loader2 size={13} className="animate-spin" />
        ) : coolingDown ? (
          <Check size={13} />
        ) : (
          <BellRing size={13} />
        )}
        {sending ? "Sending…" : coolingDown ? "Reminded" : "Remind"}
      </button>
      {error ? <p className="max-w-[16rem] text-right text-[11px] leading-4 text-danger">{error}</p> : null}
    </div>
  );
}
