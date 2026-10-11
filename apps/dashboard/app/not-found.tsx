import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="grid max-w-md justify-items-start gap-4">
        <Logo />
        <h1 className="text-display text-[clamp(28px,4vw,40px)]">Nothing reviewed here.</h1>
        <p className="text-ink-2">This page doesn&apos;t exist, or it moved. Head back to your overview.</p>
        <Button asChild variant="default">
          <Link href="/overview">Go to overview</Link>
        </Button>
      </div>
    </main>
  );
}
