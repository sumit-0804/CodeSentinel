import { Suspense } from "react";
import { safeNextPath } from "@/lib/safe-next-path";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function NextInput({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  return <input type="hidden" name="next" value={safeNextPath(next)} />;
}

/** Hidden `next` input read from the URL; streamed so the rest of the form stays in the static shell. */
export function NextField({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={null}>
      <NextInput searchParams={searchParams} />
    </Suspense>
  );
}
