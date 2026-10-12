"use client";

import type { ComponentProps } from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "cn";

/** The mockup's neon switch: cyan with a glow when on. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative h-6 w-[42px] flex-none cursor-pointer rounded-full border border-line-2 bg-panel-3 p-0 transition-[background-color,box-shadow,border-color] duration-150 outline-none",
        "focus-visible:ring-2 focus-visible:ring-cyan/60 disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:border-cyan data-[state=checked]:bg-cyan/18 data-[state=checked]:shadow-[0_0_14px_-2px_rgb(61_240_255/0.6)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-[3px] rounded-full bg-ink-3 transition-[transform,background-color] duration-150 data-[state=checked]:translate-x-[21px] data-[state=checked]:bg-cyan" />
    </SwitchPrimitive.Root>
  );
}
