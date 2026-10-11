"use client";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

// Adapted from Aceternity UI "loader" (LoaderOne): three cyan dots; MotionConfig stills them for reduced motion.
export const Loader = ({ className, label = "Loading" }: { className?: string; label?: string }) => (
  <span role="status" className={cn("inline-flex items-center gap-1.5", className)}>
    <span className="sr-only">{label}</span>
    {[0, 1, 2].map((i) => (
      <motion.span
        key={i}
        aria-hidden="true"
        className="size-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor]"
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 }}
      />
    ))}
  </span>
);
