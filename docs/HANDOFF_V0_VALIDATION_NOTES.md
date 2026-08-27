# Handoff V0 validation checklist

Before this branch can be considered ready:

- [ ] package/test build includes `src/handoff/*.ts`;
- [ ] test import path matches the repository's real test build output;
- [ ] package root export is reconciled with current `src/index.ts` without dropping existing exports;
- [ ] CI proves approved packet PASS;
- [ ] CI proves unapproved packet FAIL;
- [ ] CI proves unexpected private-context field FAIL;
- [ ] no source-product history read is introduced;
- [ ] no MingOS Core schema change is required for V0.

This checklist intentionally prevents a documentation-only or compile-broken contract from being mistaken for a completed product boundary.
