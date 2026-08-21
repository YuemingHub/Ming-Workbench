# Progressive Integration Policy

AAOP must prefer the smallest integration surface that can satisfy the current outcome.

## Default

**No additional installation is the default.**

Begin with the developer's current host, repository, native tools, existing Skills, existing MCP/apps, and project scripts.

## Escalation ladder

Treat these as increasing operational surface, not as a mandatory stack:

0. AAOP protocol only.
1. Host-native tools and orchestration.
2. Standard extensions: Agent Skills / MCP / local scripts.
3. Discovery and interoperability: ARD / A2A / trusted registries.
4. Specialized runtime: Deep Agents, Microsoft Agent Framework, CAMEL, AutoAgent, or another justified provider.
5. Governed workspace/control plane: AgentSpace or another justified organizational platform.

A task may skip a level, but every added provider needs a concrete reason.

## Escalation gate

Add a provider only if:

1. the capability gap is evidenced;
2. a lower-surface solution cannot satisfy it adequately;
3. expected benefit outweighs installation/operation complexity;
4. provenance, permissions, data exposure, credentials, cost and rollback are understood;
5. verification is defined before integration.

## Provider catalog

`.aaop/registries/providers.json` is a resolver hint catalog, not an allowlist and not a package lockfile.

Entries point to upstream mature standards/projects. Their current state must be re-verified before consequential adoption because external projects evolve independently of AAOP.

## Open-standard preference

Prefer interoperability over copies:

- Agent Skills instead of an AAOP-specific Skill format;
- MCP instead of AAOP-specific tool RPC;
- A2A Agent Cards instead of an AAOP public agent identity format;
- ARD-compatible discovery instead of an AAOP global resource registry;
- mature runtimes/workspaces instead of an AAOP execution engine or control plane.

## One gap, one addition

When possible, add one provider at a time and verify whether it closes the gap before adding another.

If repeated integrations fail to improve the outcome, reconsider the capability diagnosis rather than continuing to add infrastructure.

## De-escalation

Remove or disable integrations that no longer provide material value. A simpler working configuration is preferred over a richer unused stack.

## User experience target

The developer should be able to start with the tool they already use, state the desired outcome, and encounter new installation/authorization steps only when the work actually crosses a capability boundary.
