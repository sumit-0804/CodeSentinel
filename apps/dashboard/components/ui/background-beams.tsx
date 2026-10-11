"use client";
import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Adapted from Aceternity UI "background-beams": paths generated instead of inlined, neon colours,
// deterministic timings (no Math.random in render) and a still frame for reduced motion.
const beamPath = (k: number) => {
  const x = -380 + 7 * k;
  const y = -189 - 8 * k;
  return `M${x} ${y}C${x} ${y} ${x + 68} ${y + 405} ${x + 532} ${y + 532}C${x + 996} ${y + 659} ${x + 1064} ${y + 1064} ${x + 1064} ${y + 1064}`;
};

const BEAMS = Array.from({ length: 50 }, (_, k) => beamPath(k));
const BACKDROP = Array.from({ length: 58 }, (_, k) => beamPath(k)).join("");
// Golden-ratio spread gives varied but stable per-beam timings.
const spread = (k: number) => (k * 0.618034) % 1;

export const BackgroundBeams = React.memo(({ className }: { className?: string }) => {
  const reduceMotion = useReducedMotion();
  return (
    <div className={cn("pointer-events-none absolute inset-0 flex h-full w-full items-center justify-center", className)}>
      <svg
        className="pointer-events-none absolute z-0 h-full w-full"
        width="100%"
        height="100%"
        viewBox="0 0 696 316"
        fill="none"
        aria-hidden="true"
      >
        <path d={BACKDROP} stroke="url(#cs-beams-backdrop)" strokeOpacity="0.05" strokeWidth="0.5" />
        {BEAMS.map((d, index) => (
          <path key={index} d={d} stroke={`url(#cs-beam-${index})`} strokeOpacity="0.4" strokeWidth="0.5" />
        ))}
        <defs>
          {BEAMS.map((_, index) => (
            <motion.linearGradient
              id={`cs-beam-${index}`}
              key={index}
              initial={{ x1: "0%", x2: "0%", y1: "0%", y2: "0%" }}
              animate={
                reduceMotion
                  ? { x1: "40%", x2: "38%", y1: "40%", y2: "45%" }
                  : { x1: ["0%", "100%"], x2: ["0%", "95%"], y1: ["0%", "100%"], y2: ["0%", `${93 + spread(index) * 8}%`] }
              }
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 10 + spread(index + 7) * 10, ease: "easeInOut", repeat: Infinity, delay: spread(index + 3) * 10 }
              }
            >
              <stop stopColor="#3df0ff" stopOpacity="0" />
              <stop stopColor="#3df0ff" />
              <stop offset="32.5%" stopColor="#9b6cff" />
              <stop offset="100%" stopColor="#9b6cff" stopOpacity="0" />
            </motion.linearGradient>
          ))}
          <radialGradient
            id="cs-beams-backdrop"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="translate(352 34) rotate(90) scale(555 1560.62)"
          >
            <stop offset="0.0666667" stopColor="#d4d4d4" />
            <stop offset="0.243243" stopColor="#d4d4d4" />
            <stop offset="0.43594" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
});

BackgroundBeams.displayName = "BackgroundBeams";
