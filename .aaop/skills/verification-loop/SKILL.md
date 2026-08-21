---
name: verification-loop
description: Define acceptance evidence, execute the strongest practical checks, review independently, and replan when evidence contradicts the implementation. Use before declaring any non-trivial task complete, especially code, architecture, deployment, migration, or externally visible changes.
license: Apache-2.0
---

# Verification Loop

## Goal

Prove the requested outcome to the strongest practical degree. “Work was done” is not evidence that it works.

## Before implementation

Define acceptance evidence early enough that implementation can be shaped around it.

Examples:

- behavior-level test passes;
- API contract is satisfied;
- UI flow works in a browser;
- schema migration preserves required data invariants;
- build and static checks pass;
- deployment smoke test succeeds;
- produced artifact contains required content/format;
- independent reviewer cannot reproduce the prior failure.

## Verification ladder

Use the highest relevant layers, not every layer mechanically:

1. structural/schema validation;
2. lint/type/static checks;
3. unit tests;
4. integration/contract tests;
5. end-to-end/runtime/browser checks;
6. security/privacy review;
7. independent intent review;
8. release/deployment smoke validation when authorized.

## Independent review

For material changes, review from a fresh objective:

> Does the evidence demonstrate the user's intended outcome under the project's constraints?

Check specifically for:

- correct problem solved;
- hidden regressions;
- missing edge cases;
- mismatch between docs and runtime;
- overengineering / unnecessary restrictions;
- unsafe permissions or secret handling;
- tests that only assert implementation details;
- claims not supported by executed evidence.

## Failure classification

When a check fails, classify it before acting:

- implementation defect;
- incorrect assumption;
- stale/incorrect test;
- environment/tooling failure;
- missing permission/capability;
- architecture mismatch;
- ambiguous requirement.

Then change the plan appropriately. Do not repeatedly patch symptoms without revisiting the failed assumption.

## Completion report

Report:

- checks actually executed or evidence actually observed;
- what each proves;
- failures fixed;
- checks not possible and why;
- residual risks that remain material.

Never say “verified” when verification was only inferred from reading code.
