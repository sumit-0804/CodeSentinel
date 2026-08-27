Code-Sentinel — UI/UX mockups (Deliverable 4)
14 frames, PNG, 3840x2160 (2x of a 1920x1080 design canvas)

Scenario shared by every screen: pull request #482 "Add payment retry logic"
on acme/payments-api. The run is PARTIAL — the Logic agent exceeded its
90-second budget, the other four agents completed, and the report ships
with the gap stated rather than hidden.

Severity scale follows docs/design/schema/schema.sql: critical / warning / info.
Ordering inside a severity level comes from the agent's confidence score.

02  Design language            Tokens: surfaces, brand, severity, type scale, agent marks, controls.
03  Dashboard                  Cross-repo view. What needs me across 14 repositories,
                               ordered by blocked merges rather than recency.
04  Review in progress         Agents report independently. Four have returned, Logic is
                               over budget; findings are already readable.
05  Review overview            The verdict, the five-agent matrix, the priority queue.
                               Answers "can I merge this".
06  Three-panel code review    Files / diff / findings. Findings stay anchored to the
                               line that produced them.
07  Finding detail & fix       Evidence, reasoning, proposed patch, confidence, rule
                               provenance. Apply, branch, or reject with a reason.
08  Review history             Filterable record of past reviews. Answers "is the
                               codebase getting better".
09  Repository detail          One repository in context: active agents, recurring
                               problems, where its rules came from.
10  Agents                     Agents as operational objects: success rate, p95 latency,
                               acceptance rate, cost per review.
11  Repository & agent config  Per-agent mode (blocking / advisory), scope, thresholds,
                               triggers, ignore paths, and the budget that caused the timeout.
12  Pull request check         The merge check and two inline comments — where most
                               developers meet the product.
14  Empty & error states       First run, clean pass, degraded run, revoked access.
                               Each names its cause and offers one next action.
15  Screen index               Reference table of frames 03-14.
