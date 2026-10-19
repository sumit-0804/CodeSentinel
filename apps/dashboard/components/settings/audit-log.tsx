import Link from "next/link";
import type { AuditEvent } from "@code-sentinel/contracts";
import { describeAuditEvent } from "@/lib/audit-view";
import { describeDevice } from "@/lib/user-agent";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(iso));

/** Settings → Audit log (admins): who did what, from where, newest first (WP6). */
export function AuditLog({ organizationName, events, nextBefore }: { organizationName: string; events: AuditEvent[]; nextBefore?: string }) {
  return (
    <section className="grid min-w-0 gap-3.5" aria-labelledby="audit-h">
      <div>
        <h2 id="audit-h" className="text-base font-bold">
          Audit log
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[14.5px] text-ink-2">
          Changes and fix decisions in {organizationName}, with who made them and from where. Only admins see this.
        </p>
      </div>
      <div className="panel overflow-x-auto">
        {events.length === 0 ? (
          <p className="px-5 py-[18px] text-sm text-ink-2">Nothing yet. Configuration changes, fix decisions and re-runs show up here.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-line text-[12.5px] font-semibold text-ink-3">
              <tr>
                <th className="px-5 py-3 font-semibold">When (UTC)</th>
                <th className="px-3 py-3 font-semibold">Who</th>
                <th className="px-3 py-3 font-semibold">What</th>
                <th className="px-5 py-3 font-semibold">From</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.eventId} className="border-b border-line last:border-b-0">
                  <td className="px-5 py-3 whitespace-nowrap text-ink-2 tabular-nums">{when(event.createdAt)}</td>
                  <td className="px-3 py-3 font-semibold">{event.actor ?? "Someone on GitHub"}</td>
                  <td className="px-3 py-3">{describeAuditEvent(event)}</td>
                  <td className="px-5 py-3 text-ink-2">
                    {event.ip || event.userAgent ? [event.ip, event.userAgent ? describeDevice(event.userAgent) : undefined].filter(Boolean).join(" · ") : "GitHub"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {nextBefore ? (
        <Link href={`/settings?section=audit&before=${encodeURIComponent(nextBefore)}`} className="justify-self-start text-sm font-semibold text-cyan hover:underline">
          Older events
        </Link>
      ) : null}
    </section>
  );
}
