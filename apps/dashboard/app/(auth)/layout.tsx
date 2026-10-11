import type { ReactNode } from "react";
import Link from "next/link";
import { AuthHero } from "@/components/auth/auth-hero";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 min-[821px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section className="flex flex-col gap-9 px-[clamp(16px,6vw,88px)] py-9">
        <Link href="/sign-in" className="self-start rounded-md">
          <Logo />
        </Link>
        <main className="my-auto grid w-full max-w-[384px] gap-4">{children}</main>
      </section>
      <AuthHero />
    </div>
  );
}
