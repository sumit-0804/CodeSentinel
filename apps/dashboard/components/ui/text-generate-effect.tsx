"use client";
import { useEffect } from "react";
import { motion, stagger, useAnimate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

// Adapted from Aceternity UI "text-generate-effect": inherits our type styles, plays once on mount,
// and skips the blur for reduced motion.
export const TextGenerateEffect = ({
  words,
  className,
  duration = 0.5,
}: {
  words: string;
  className?: string;
  duration?: number;
}) => {
  const [scope, animate] = useAnimate();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    animate(
      "span",
      { opacity: 1, filter: "blur(0px)" },
      { duration: reduceMotion ? 0 : duration, delay: reduceMotion ? 0 : stagger(0.12) },
    );
  }, [animate, duration, reduceMotion]);

  return (
    <span ref={scope} className={cn(className)}>
      {words.split(" ").map((word, index) => (
        <motion.span key={word + index} className="opacity-0" style={{ filter: "blur(10px)" }}>
          {word}{" "}
        </motion.span>
      ))}
    </span>
  );
};
