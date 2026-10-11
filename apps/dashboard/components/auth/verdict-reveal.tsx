"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { EncryptedText } from "@/components/ui/encrypted-text";

/** "Blocked." decrypts once the lanes have risen; reduced motion shows it at once. */
export function VerdictReveal({ text, delayMs }: { text: string; delayMs: number }) {
  const reduceMotion = useReducedMotion();
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (reduceMotion) return;
    const timer = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, reduceMotion]);

  if (reduceMotion) return <>{text}</>;
  if (!started) {
    return (
      <span className="opacity-0">
        <span className="sr-only">{text}</span>
        <span aria-hidden="true">{text}</span>
      </span>
    );
  }
  return <EncryptedText text={text} revealDelayMs={90} flipDelayMs={40} encryptedClassName="text-crit/70" />;
}
