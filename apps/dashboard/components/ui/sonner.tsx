"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

// Dark only, matching the app; toasts sit bottom-centre like the mockup's undo toasts.
const Toaster = (props: ToasterProps) => (
  <Sonner
    theme="dark"
    position="bottom-center"
    className="toaster group"
    style={
      {
        "--normal-bg": "var(--cs-panel-3)",
        "--normal-text": "var(--cs-ink)",
        "--normal-border": "var(--cs-line-2)",
        "--border-radius": "14px",
      } as React.CSSProperties
    }
    toastOptions={{ classNames: { toast: "font-semibold", actionButton: "!bg-transparent !text-cyan !font-bold" } }}
    {...props}
  />
)

export { Toaster }
