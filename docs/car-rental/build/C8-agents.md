# C8 · Agents: platform, boundaries, three pilot agents (weeks 6–31, parallel)

Branch: `cars/agents`, merged in slices. Needs C0. Design references:
[agent-boundaries.md](../agent-boundaries.md) (all), [architecture.md](../architecture.md) §9,
§13.15.

**Track exit**
- In the boundary suite, no forbidden action reaches a command.
- Every violation ends its run in the same request and appears in the audit trail.
- A suspended agent cannot act until a person reinstates it.
- The reservation agent books correctly in ≥ 95% of eval conversations with zero policy
  violations.

---

## Boundaries first (steps B1–B8)

### [ ] C8-01 · Job charters (B1)
- Size: M
- Change: `packages/platform/src/agents/`: the charter schema (purpose, tools by name and
  version, data scope, limits, needs-approval list, never list, topics, channels and hours,
  hand-off), table `platform.agent_charters` (platform versions) and
  `platform.agent_charter_overrides` (a workspace may only narrow). `agent_principals` per
  workspace with autonomy level and status. Charters for the ops copilot, document extraction
  and the reservation agent.
- Done when: an override that adds a tool or raises a limit is refused; charters are versioned
  and audited.

### [ ] C8-02 · Tool gateway and run tokens (B2)
- Size: L
- Depends on: C8-01, C0-03
- Change: generate tool schemas from the contract registry for the tools in a charter only. Each
  run gets a short-lived token bound to agent, charter version, workspace, subject (customer or
  staff member) and tool list. The gateway is the only path from a model to a command; it
  validates input by the command's zod schema and rejects any tool not in the token.
- Done when: a call to a tool outside the token never reaches a handler (asserted with a spy on
  the handler registry).

### [ ] C8-03 · Policy check, dry run and approvals (B3)
- Size: L
- Depends on: C8-02, C0-19, C0-20
- Change: before a write, evaluate the charter limits and the workspace's agent rules. Outcomes:
  allow, needs approval (create a proposal in the approvals inbox with the dry-run diff, the
  reason and the evidence), or deny. Commands run with the agent's tenant, branch and subject
  scope set in the database.
- Done when: a discount above the cap becomes a proposal, not a write; an approved proposal
  executes exactly once.

### [ ] C8-04 · Violations, termination and hand-off (B4)
- Size: L
- Depends on: C8-03
- Change: classify violations (S1, S2, S3 as in `agent-boundaries.md` §3). On any violation, in
  the same request: block, revoke the run token, mark the run `terminated`, write
  `platform.agent_violations` and an audit row, hand the conversation to the staff inbox with
  the transcript, send the customer the hand-off message, and alert.
- Done when: after a violation, a further tool call with the same token fails; the record holds
  the attempted call and the input that led to it.

### [ ] C8-05 · Suspension, reinstatement and kill switches (B5)
- Size: M
- Depends on: C8-04
- Change: S1 suspends the agent for the workspace; S2 for the customer, and for the workspace
  after three in 24 hours; S3 lowers autonomy after repeats. A platform switch disables an agent
  version everywhere. Reinstatement is a permission-bound, audited command with an optional
  narrower override. Workspace and platform kill switches in Settings and the console.
- Done when: fake-clock tests cover each rule; a suspended agent's runs are refused at start.

### [ ] C8-06 · Output check and canary tools (B6)
- Size: M
- Depends on: C8-04
- Change: a check on every outgoing customer message (on-topic for the charter, no personal data
  of other people, no promises outside policy, no secrets), with a safe replacement and an S3
  record on failure. Canary tools registered in the gateway only; any call is S1.
- Done when: tests cover a blocked reply and a canary call.

### [ ] C8-07 · Boundary suite, shadow mode and dashboards (B7)
- Size: L
- Depends on: C8-04
- Change: an eval harness run in CI on any change to prompts, charters or tools: forbidden tool
  attempts, cross-customer and cross-workspace requests, limit breaches, instructions hidden in
  messages and documents, in English and Arabic. Shadow mode: the agent proposes, nothing
  executes, proposals are compared with what staff did. Dashboards for blocked calls,
  terminations, hand-offs and rejected proposals.
- Done when: the suite fails the build on any breach that reaches a handler.

## Platform

### [ ] C8-08 · Runs, logging and cost
- Size: M
- Change: `platform.agent_runs` and `agent_steps` (model, prompt version, charter version, tool,
  input hash, outcome, latency, tokens, cost). Limits on steps per run, runs per customer and
  cost per day. Cost is metered (C7-02) once that exists.
- Done when: a run that exceeds its step limit is terminated and recorded.

### [ ] C8-09 · Subject binding
- Size: M
- Change: a customer conversation is bound to a customer only after a one-time code to the phone
  or email on file (limits from C4-11). Until then the agent has search and quote tools only.
- Done when: an unbound conversation cannot read or change any booking.

### [ ] C8-10 · Model adapter and routing
- Size: M
- Blocked by: D14 (for Gulf personal data)
- Change: an `ai` adapter over the Claude API with model routing by task (a fast model for
  classification and extraction, a general model for conversations, the most capable model for
  complex back-office reasoning), prompt caching, timeouts and retries. Each agent feature
  declares the data classes it sends; a workspace with residency on only runs features whose
  endpoint is in its region. Use the `claude-api` skill for current model ids and SDK usage.
- Done when: a feature that would send personal data out of region is refused for a residency
  workspace.

### [ ] C8-11 · Knowledge store
- Size: M
- Change: `pgvector` table per cell with RLS holding chunks of the workspace's **published**
  policies and FAQs only, with a retrieval query used as an agent tool.
- Done when: retrieval never returns another workspace's text or an unpublished draft.

## Agents for the pilot

### [ ] C8-12 · Ops copilot (read-only)
- Size: L
- Blocked by: design
- Change: a staff chat panel whose tools are queries only, run with the asking member's own
  permissions and scopes.
- Done when: it cannot return data the member could not open themselves (tested per role).

### [ ] C8-13 · Document extraction assistant
- Size: M
- Depends on: C4-03, C8-10
- Change: propose fields from an uploaded ID or licence image as unverified proposals. It cannot
  set verification status and does not keep the image.
- Done when: extracted fields never reach `verified` without a person or the KYC vendor.

### [ ] C8-14 · Reservation agent: web chat
- Size: L
- Blocked by: design
- Depends on: C2-07, C8-07, C8-09
- Change: the agent with the reservation charter on the booking site's chat, in shadow mode
  first, then acting with approval, then within limits per workspace.
- Done when: ≥ 95% correct outcomes on the eval conversations; zero boundary breaches.

### [ ] C8-15 · Reservation agent: WhatsApp inbox
- Size: L
- Depends on: C4-10, C8-14
- Change: the same agent in the inbox, with hand-off to and from staff, hours set by the
  workspace, and payment and upload by secure link only.
- Done when: a staff member can take over mid-conversation and the agent stops at once.

### [ ] C8-16 · Track check
- Size: S
- Do: confirm the track exit lines; record the autonomy level each pilot agent starts at.
