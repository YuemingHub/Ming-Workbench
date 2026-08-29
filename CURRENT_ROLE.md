# Ming Workbench · Current Role

> Current coordination fact: 2026-08-29

## 1. Role

Ming Workbench is **not a primary life-product construction front**.

Its useful responsibility is narrower:

> When a person has already formed a sufficiently clear intention, help find/use an appropriate execution capability, control consequential actions, and verify that reality actually changed as intended.

Canonical principle remains:

> **Reuse Before Build.**

Workbench should prefer an existing capable agent/tool/runtime over expanding its own platform.

## 2. Relationship to current product lines

```text
Family-Space = 我和我家
Return-to-oneself = 我和自己
Gui = Return formal frontend

confirmed intention
      ↓ only when execution is actually needed
best-fit external capability
      ↓
optional Workbench control / evidence boundary when it adds real value
```

Family-Space and Return must remain complete products without requiring Workbench.

## 3. What Workbench may still own

Keep the parts that are difficult to get safely and reliably from a generic executor when they are genuinely needed:

- translate a confirmed outcome into a bounded execution request;
- explicit authorization for consequential operations;
- isolate credentials and writable scope;
- independent readback of produced artifacts or repository/runtime reality;
- evidence-backed completion rather than trusting provider self-report;
- human acceptance/rejection where the consequence belongs to the human;
- replaceable executor/provider seams.

These are **capabilities**, not reasons to build a universal platform.

## 4. What is frozen by default

Do not continue by default with:

- a universal capability marketplace;
- a new general workflow engine;
- a second agent protocol when an existing one works;
- deeper AAOP protocol work without a concrete software-execution failure;
- deeper Harness integration merely to prove more Harness integration;
- a broad desktop product roadmap;
- a mandatory `Return → Workbench` or `Family → Workbench` chain;
- a new cross-product memory/profile system;
- execution features whose only evidence is that they are technically interesting.

## 5. Route selection rule

For each confirmed real-world intention:

```text
1. What outcome does the person actually want?
2. What is the smallest execution capability required?
3. Is there already a trusted tool/agent/service that can do it?
4. What authority does it need?
5. What independent evidence can prove the outcome?
6. Does Workbench add enough value to justify being in the path?
```

If #6 is no, use the external capability directly.

## 6. AAOP and Harness

AAOP and DeepSeek Harness are implementation options for bounded software execution, not product identity.

Retain existing research, adapters and validation evidence as engineering assets. Do not advance them as a standing roadmap unless a current real execution case demonstrates a gap that cannot be solved more simply.

## 7. Status of historical Draft PRs

The open Stage 3 / P6.3 / three-product / Handoff / Creation Route Drafts were useful experiments and contain valid evidence, but they no longer constitute the active product queue after the 2026-08-29 product-line correction.

Closing a Draft does not mean its findings were wrong. It means:

- evidence is preserved;
- branches remain recoverable;
- implementation can be selectively reused later;
- no experiment silently becomes a required architecture dependency.

## 8. Current development policy

Workbench receives new engineering work only from one of these triggers:

1. a real product has a confirmed intention that needs execution and existing direct tools are insufficient;
2. an execution attempt fails in a reproducible way that Workbench is specifically positioned to solve;
3. independent verification/authorization is materially missing and cannot be obtained more simply;
4. a better external capability appears and Workbench needs a thin adapter to use it safely.

Otherwise, maintenance and evidence preservation are the correct state.

## 9. Success condition

Workbench succeeds when users do **not** have to understand Workbench, AAOP, Harness, ACP, provider routing or Git machinery.

The human owns reality, intention, values and final responsibility. The execution layer should disappear behind the result as much as possible.
