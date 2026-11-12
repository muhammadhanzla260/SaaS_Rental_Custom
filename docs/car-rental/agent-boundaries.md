# Agent boundaries: each agent does its job and nothing else

Status: plan, for review. Written 12 Nov 2026.
Related: [architecture.md §9](./architecture.md#9-agentic-architecture-agents-as-governed-principals)
(agent controls), [security.md](./security.md) and [dev-plan.md](./dev-plan.md) (track C8).

**The rule:** every agent has a written job. It can only do what that job lists. Any attempt to go
beyond it is blocked before it has any effect, the run is terminated at once, and a person takes
over.

**How it is enforced:** by code outside the model. The model can be tricked or can make mistakes,
so the limits never depend on the model choosing to obey them.

---

## 1. The job charter

Each agent type has a charter. It is data, versioned, and approved by a person. The agent cannot
read or change its own charter.

| Charter field | Meaning | Example: reservation agent |
| --- | --- | --- |
| Purpose | One sentence | Quote, book and change self-drive rentals for one verified customer |
| Tools allowed | The exact commands and queries, by name and version | `cars.search.offers`, `cars.reservations.hold`, `update`, `confirm`, `readiness`, payment-link and upload-link commands |
| Data scope | Whose records it may touch | Only the bound customer's bookings, in the workspace and branches it is assigned |
| Limits | Numbers it cannot exceed | Discount ≤ the workspace cap; money per action; actions per conversation; steps per run; cost per day |
| Needs approval | Actions it may propose, not perform | Cancelling a confirmed rental, waiving a fee |
| Never | Things outside the job | Refunds, damage charges, reading ID documents, settings, other customers, exports, other agents' work |
| Topics | What it may talk about | The workspace's cars, prices, policies and the customer's bookings |
| Channels and hours | Where and when it runs | Web chat and WhatsApp; hours set by the workspace |
| Hand-off | Who takes over | The branch's staff inbox |

Charters for the other agents follow the same form. Examples of their "never" lists:

| Agent | Its job | Never |
| --- | --- | --- |
| Ops copilot | Answer staff questions from data; draft messages | Any write; any data the asking staff member cannot see |
| Document extraction | Read a document image and propose fields | Verify a document; approve a driver; keep the image |
| Readiness chaser | Remind customers of missing items | Change a booking; accept documents in chat; decide eligibility |
| Fines and tolls matcher | Match statement lines to rentals; draft charges | Charge above its cap; close a dispute; edit a statement |
| Damage assistant | Compare photos and propose damage | Create a charge; change a condition report |
| Fleet and yield advisor | Propose prices, moves and assignments | Change a rate or assignment without approval |
| Collections | Send payment reminders under the dunning policy | Change amounts; threaten; contact outside allowed hours |

A workspace may **narrow** a charter (fewer tools, lower limits). It can never widen one beyond the
platform's version.

---

## 2. Enforcement: five walls outside the model

| Wall | What it does |
| --- | --- |
| 1. Tool list | The agent is only shown the tools in its charter. Other tools do not exist for it |
| 2. Run token | Each run gets a short-lived credential bound to one agent, one workspace, one customer or staff member, and the charter's tools. The gateway rejects anything else |
| 3. Policy check | Every call is checked against the charter's limits and the workspace's rules before the command runs. Dry-run first for writes |
| 4. Database scope | The command runs with the agent's tenant, branch and subject scope. Row-level security refuses other records even if every earlier wall failed |
| 5. Output check | Every reply to a customer is checked before sending: on-topic, no promises outside policy, no personal data of others, no secrets |

Also:
- **No self-change.** No tool lets an agent edit charters, prompts, permissions, policies or
  budgets.
- **No free delegation.** An agent cannot start another agent or pass it instructions. Work moves
  only through defined hand-offs and the shared approvals inbox.
- **Canary tools.** A few fake tools that no job needs (for example "export all customers") are
  visible to the gateway only. A call to one is treated as the most serious violation.
- **Untrusted text.** Customer messages, uploads and web pages are data. They cannot grant
  permissions or change the job.

---

## 3. What counts as going beyond the job

| Class | Example | Severity |
| --- | --- | --- |
| Forbidden tool | Calls a tool not in its charter, or a canary tool | S1 |
| Scope breach | Asks for another customer's booking, another branch, another workspace | S1 |
| Self-change or escalation | Tries to change its permissions, limits or instructions; tries to reach another agent | S1 |
| Data misuse | Tries to read ID documents or payment details it has no need for; puts others' data in a reply | S1 |
| Limit breach | Discount, amount, step or cost above the charter | S2 |
| Approval bypass | Performs an action that needs approval, or retries a denied action in another form | S2 |
| Off-job output | Gives advice or makes promises outside its topics | S3 |

An action that is in the charter but needs approval is **not** a violation. It goes to the approvals
inbox as designed.

---

## 4. What happens on a violation

**Always, within the same request:**
1. The action is blocked. It never reaches the command, so nothing changes.
2. The run is terminated. Its token is revoked, and no further step runs.
3. The conversation goes to a person, with the transcript. The customer sees a short hand-off
   message.
4. A violation record is written to the audit trail: agent, version, charter version, what was
   attempted, the input that led to it, and the severity.
5. The workspace's managers are alerted. S1 also alerts the platform team.

**Then, by severity:**

| Severity | Further action |
| --- | --- |
| S1 | The agent is **suspended for that workspace** until a person reviews and reinstates it. If the same agent version shows S1 in several workspaces, that version is switched off everywhere |
| S2 | The agent is suspended for that customer or conversation. Three S2 events in 24 hours suspend it for the workspace |
| S3 | The reply is replaced with a safe one and the event is counted. Repeated S3 events lower the agent's autonomy level by one step |

**Why suspension is scoped.** A customer can try to provoke a violation on purpose, by typing
instructions into the chat. If one such message switched the agent off for everyone, that would
itself be an attack. So the run always ends and that conversation always goes to a person, while
wider suspension needs an S1 event or repetition. Abusive senders are rate-limited and can be
blocked.

**Reinstatement.** A suspended agent comes back only when a person with the right permission has
read the violation record and chosen: reinstate, reinstate with a narrower charter, or keep off.
The decision is audited.

---

## 5. Keeping agents inside their job over time

- **Before release:** each agent version must pass a boundary test suite. It includes attempts to
  call forbidden tools, reach other customers, exceed limits, and follow instructions hidden in
  messages and documents. The pass mark is zero boundary breaches reaching a command.
- **Shadow first:** a new version runs alongside people without acting, and its proposed actions
  are compared with theirs.
- **In production:** dashboards per agent for blocked calls, terminations, hand-offs and approvals
  rejected. A rising rate triggers a review.
- **Regular review:** each charter is re-approved every quarter, and after any change to the
  commands it lists.
- **Records:** every run and step is kept with model, prompt version, charter version, tool, cost
  and outcome.

---

## 6. Build plan (inside track C8)

| Step | Work | When |
| --- | --- | --- |
| B1 | Charter schema, storage and versioning; charters for the three pilot agents | With the agent platform (weeks 6–9) |
| B2 | Run tokens bound to agent, workspace, subject and tools; gateway rejects everything else | Weeks 8–11 |
| B3 | Policy check with limits; dry-run; approvals routing | Weeks 10–13 |
| B4 | Violation classes, immediate termination, hand-off, audit record, alerts | Weeks 12–15 |
| B5 | Suspension and reinstatement flows; workspace and platform kill switches | Weeks 14–17 |
| B6 | Output check and canary tools | Weeks 16–19 |
| B7 | Boundary test suite in CI; shadow mode; dashboards | Weeks 18–22, then ongoing |
| B8 | Charters for the post-pilot agents | With wave P6 |

**Exit for the pilot:**
- In the boundary suite, no forbidden action reaches a command.
- Every violation ends its run in the same request and appears in the audit trail.
- A suspended agent cannot act until a person reinstates it.
