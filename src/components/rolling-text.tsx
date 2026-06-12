"use client";

import "slot-text/style.css";
import { useEffect, useRef } from "react";
import { slotText } from "slot-text";

type RollingTextProps = {
  text: string;
  className?: string;
  /** Play the roll-in once when the component first mounts (for static labels). */
  rollOnMount?: boolean;
};

/**
 * Slot-machine roll for tiny labels, via slot-text's vanilla controller. The
 * label rolls when `text` changes; `rollOnMount` adds a one-time roll-in for
 * static text like the brand mark.
 */
export function RollingText({ text, className, rollOnMount = false }: RollingTextProps) {
  const elementRef = useRef<HTMLSpanElement>(null);
  const controllerRef = useRef<ReturnType<typeof slotText>>(null);
  const firstTextEffectRef = useRef(true);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const controller = slotText(element, text);
    controllerRef.current = controller;

    if (rollOnMount) {
      controller.set(text, { skipUnchanged: false });
    }

    return () => {
      controller.destroy();
      controllerRef.current = null;
      firstTextEffectRef.current = true;
    };
    // Mount-only: text updates are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (firstTextEffectRef.current) {
      firstTextEffectRef.current = false;
      return;
    }
    controllerRef.current?.set(text);
  }, [text]);

  return <span ref={elementRef} className={className} aria-label={text} />;
}
