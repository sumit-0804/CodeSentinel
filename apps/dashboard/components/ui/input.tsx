import * as React from "react"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-11 w-full min-w-0 rounded-xl border border-line-2 bg-panel px-3.5 text-[15px] font-medium text-ink transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-ink-3 focus-visible:border-cyan focus-visible:shadow-glow disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-crit aria-invalid:shadow-[0_0_0_1px_rgb(255_77_115/0.5),0_0_18px_-4px_rgb(255_77_115/0.5)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
