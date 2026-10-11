import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] border font-semibold whitespace-nowrap transition-[border-color,background-color,box-shadow,color] duration-150 outline-none select-none disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default:
          "border-cyan bg-cyan text-cyan-ink shadow-glow-btn hover:bg-[#6ff4ff] hover:shadow-[0_0_32px_-2px_rgb(61_240_255/0.75)]",
        outline: "border-line-2 bg-panel-2 text-ink hover:border-[#46507e] hover:bg-panel-3",
        secondary: "border-line-2 bg-panel-2 text-ink hover:border-[#46507e] hover:bg-panel-3",
        ghost: "border-transparent bg-transparent text-ink-2 hover:bg-panel-2 hover:text-ink",
        destructive: "border-line-2 bg-panel-2 text-crit hover:border-crit/50",
        link: "border-transparent text-cyan underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[38px] px-4 text-sm",
        sm: "h-8 px-3 text-[13px]",
        lg: "h-[46px] rounded-xl px-5 text-[15px]",
        icon: "size-[38px]",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "outline",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "outline",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
