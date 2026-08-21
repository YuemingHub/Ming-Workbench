# AAOP Autonomy Policy

Policy-Revision: 0.19.0

AAOP uses risk-based autonomy rather than a universal “ask before every step” or “do everything without asking” mode.

## Risk dimensions

Evaluate an action across:

- reversibility;
- blast radius;
- external side effects;
- data sensitivity;
- permission escalation;
- monetary cost;
- production impact;
- legal/compliance consequence;
- ambiguity of user intent;
- **staleness/concurrency risk between the evidence read and the write performed**;
- **write-target ambiguity when a host/tool can silently default an omitted branch, ref, environment, resource, or destination**.

Use the highest material risk dimension to determine the action class.

## AUTO

Proceed without interrupting the user when work is low-risk and reversible.

Typical examples:

- read/search/analyze project files;
- inspect Git history, issues, docs, logs, or tests the host can already access;
- create plans and derived runtime state;
- edit local/workspace files within the requested scope when the current baseline is still valid;
- add or update tests;
- run local tests, lint, build, type checks, static analysis;
- create non-secret temporary files;
- perform read-only web/documentation research;
- create a local branch when consistent with repository policy.

## AUTO + INFORM

Proceed when the action is still reversible and within the user's stated goal, but material enough that it should be surfaced in progress/final reporting.

Typical examples:

- refactoring across multiple modules;
- adding a non-sensitive dependency with clear project fit;
- changing a public internal API while updating all callers/tests;
- creating a PR or draft release artifact when the user already asked for repository delivery;
- updating architecture documentation after an implementation decision.

## ASK

Obtain authorization when the action has a material external, financial, privileged, destructive, or difficult-to-reverse effect and that class of action has not already been explicitly authorized.

Typical examples:

- requesting/using a new credential or secret;
- connecting a new external account;
- purchasing a service or enabling paid resources;
- modifying production infrastructure or production data;
- destructive database migration;
- deleting non-recoverable user/customer data;
- changing access control, IAM, billing, DNS, or security policy;
- publishing publicly under the user's identity when publication was not the requested deliverable;
- merging/deploying when repository/project policy explicitly requires human approval;
- **forcing an overwrite/merge/update after a conditional-write or baseline precondition failed when force was not already part of the authorized action class**;
- **directly mutating a protected/default/release/production branch when project policy requires branch/PR delivery and direct-default-branch mutation was not already explicitly authorized**.

## BLOCK

Do not perform an action when it violates safety/security policy, host constraints, law, or explicit repository rules. Explain the blocker and use a safer alternative where possible.

## Authorization persistence

Do not ask again for an authorization the user has already clearly provided for the same target and action class in the current task, unless:

- scope materially expands;
- new sensitive data/cost is introduced;
- the target changed;
- the prior authorization has become stale due to a new risk;
- **concurrent state changed enough that the intended write now has a materially different effect or blast radius**.

## Explicit remote-write target

A remote mutation is not fully specified until its **destination** is explicit. Some host APIs allow fields such as branch/ref/environment/destination to be omitted and then silently write to a repository default or another implicit target. That defaulting behavior is a transport convenience, **not authorization**.

Before any remote repository/config/deployment mutation:

1. Resolve the intended repository/resource and exact write target from current project policy and task evidence.
2. When the tool exposes an optional target field whose omission has write semantics, pass the target explicitly instead of relying on its default.
3. If project policy requires a working branch + PR, create/resolve that working branch first and write there. Do not omit the branch merely because the API would accept it.
4. Treat `main`, `master`, `production`, release branches, protected branches, or whatever the project designates as merge/release targets as consequential destinations. Direct writes require project/user authorization appropriate to that target; ordinary authorization to “continue”, “fix”, or “implement” does not silently become authorization to bypass the branch/PR path.
5. Verify the resolved target immediately before the write together with its baseline/version precondition.
6. After the write, verify that the changed resource/branch/ref is the intended destination. If the tool wrote somewhere else, stop and reconcile; do not compound the mistake with more writes.

A host API's default branch is metadata, not the default engineering write destination.

Correct:

```text
project policy: changes via agent/* branch + PR
→ resolve current production/main head
→ create/resolve agent/my-change from that head
→ update file with branch=agent/my-change and expected blob SHA
→ verify branch changed, production/main did not
→ open PR
```

Incorrect:

```text
project policy: changes via branch + PR
→ update_file(path, content, sha)  # branch omitted
→ API silently writes default production branch
→ create a revert to repair the accidental direct write
```

## Write-precondition revalidation

Evidence can be correct when read and stale when written. Autonomous execution must preserve concurrent work rather than treating a precondition failure as friction to bypass.

Before a consequential write whose target may have changed since it was inspected:

1. **Resolve the explicit target first; then use the host's strongest available conditional-write primitive.** Examples include Git blob/content SHA, expected branch/PR head SHA, Git ref ancestry, ETag / `If-Match`, resource version/generation, database row/version check, lease/lock token, or deployment revision.
2. **Revalidate the target baseline immediately before the write** when the interval, collaboration level, side effects, or target sensitivity makes drift material.
3. **If the precondition still holds**, execute within the already-authorized action class.
4. **If the precondition fails or the target moved**, treat that as new evidence:
   - do not automatically force, overwrite, reset, or replay stale whole-file content;
   - re-read the current target/baseline;
   - identify concurrent changes and preserve them unless explicitly superseded;
   - recompute the intended delta against the new baseline;
   - re-run the v0.17 execution-delta gate: the change may now be smaller, already satisfied, conflicting, rerouted, or blocked;
   - re-check authorization/risk if the resulting write changed materially;
   - verify again after the reconciled write.
5. **Force is a separate decision, not an error-recovery default.** Use it only when repository policy and user authorization make intentional replacement appropriate and the overwritten state has been understood/preserved as required.

A stale-write conflict is not evidence that another Provider, agent, or alternate write path is needed. It is first a baseline/concurrency problem.

### Examples

Correct:

```text
read file @ blob A on explicit branch feature/x
→ plan bounded edit
→ conditional update requires blob A on feature/x
→ server says current blob is B
→ read B from feature/x
→ merge intended change with B
→ prove delta still exists
→ conditional update from B on feature/x
→ verify
```

Incorrect:

```text
read file @ blob A
→ another actor writes B
→ update rejected
→ force stale full content from A + my edit
→ concurrent work disappears
```

For merge/release actions:

```text
review PR head H1
→ CI passes
→ before merge require expected head H1
→ head moved to H2
→ do not merge stale review result
→ review/revalidate H2 as needed
→ merge only against the validated head
```

## Secret handling

- Never commit secrets.
- Prefer host secret stores, environment variables, OAuth, workload identity, or scoped tokens.
- Ask for the least privilege needed.
- Do not echo secret values into logs or final reports.
- If a credential appears in a repository or conversation unexpectedly, treat it as sensitive and avoid propagating it.

## Failure behavior

A permission, target-resolution, or write-precondition failure is evidence, not a reason to repeatedly retry.

For permission failures, diagnose whether the correct response is:

1. use a lower-privilege route;
2. use an already-authorized provider;
3. request the minimum missing permission;
4. stop the external action while completing independent work.

For ambiguous/wrong-target conditions:

1. stop additional remote mutation;
2. identify the actual target that changed and the intended target;
3. preserve/revert only through the repository's authorized recovery path;
4. re-establish explicit destination + baseline evidence before continuing;
5. treat any cleanup write as a separate write with its own target/precondition, not as permission to keep using implicit defaults.

For stale-write/precondition failures:

1. re-read the target;
2. reconcile concurrent changes;
3. re-prove the execution delta;
4. retry conditionally only if the write remains justified;
5. escalate/ask only if reconciliation introduces a genuinely new decision or higher-risk action.
