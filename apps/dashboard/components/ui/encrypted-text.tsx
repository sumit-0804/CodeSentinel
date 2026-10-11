"use client";
import React, { useEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Adapted from Aceternity UI "encrypted-text": screen readers get the real text once, the first frame is
// deterministic (no hydration mismatch), and reduced motion shows the text straight away.
type EncryptedTextProps = {
  text: string;
  className?: string;
  /** Milliseconds between revealing each real character. */
  revealDelayMs?: number;
  charset?: string;
  /** Milliseconds between scramble flips for unrevealed characters. */
  flipDelayMs?: number;
  encryptedClassName?: string;
  revealedClassName?: string;
};

const DEFAULT_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-={}[];:,.<>/?";

const randomChar = (charset: string) => charset.charAt(Math.floor(Math.random() * charset.length));
const scramble = (text: string, pick: (i: number) => string) =>
  text.split("").map((ch, i) => (ch === " " ? " " : pick(i)));

export const EncryptedText: React.FC<EncryptedTextProps> = ({
  text,
  className,
  revealDelayMs = 50,
  charset = DEFAULT_CHARSET,
  flipDelayMs = 50,
  encryptedClassName,
  revealedClassName,
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const reduceMotion = useReducedMotion();
  const [frame, setFrame] = useState(() => ({
    count: 0,
    chars: scramble(text, (i) => charset.charAt((i * 7) % charset.length)),
  }));

  useEffect(() => {
    if (!isInView || reduceMotion) return;

    const start = performance.now();
    let lastFlip = -Infinity;
    let chars = scramble(text, () => randomChar(charset));
    let handle = 0;

    const update = (now: number) => {
      const count = Math.min(text.length, Math.floor((now - start) / Math.max(1, revealDelayMs)));
      if (now - lastFlip >= flipDelayMs) {
        chars = chars.map((ch, i) => (i < count || text[i] === " " ? ch : randomChar(charset)));
        lastFlip = now;
      }
      setFrame({ count, chars });
      if (count < text.length) handle = requestAnimationFrame(update);
    };

    handle = requestAnimationFrame(update);
    return () => cancelAnimationFrame(handle);
  }, [isInView, reduceMotion, text, revealDelayMs, charset, flipDelayMs]);

  if (!text) return null;
  const shown = reduceMotion ? text.length : frame.count;

  return (
    <span ref={ref} className={cn(className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split("").map((char, index) => (
          <span key={index} className={cn(index < shown ? revealedClassName : encryptedClassName)}>
            {index < shown ? char : frame.chars[index]}
          </span>
        ))}
      </span>
    </span>
  );
};
