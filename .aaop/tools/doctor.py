#!/usr/bin/env python3
"""Inspect an AAOP-enabled project without installing or modifying providers.

The doctor is deliberately recipe-driven: integration recipes declare how an
upstream provider can be recognized, while this tool evaluates those hints in a
uniform way. Adding a provider should normally require a recipe update, not a
new hard-coded branch in the doctor.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import shutil
from pathlib import Path
from typing import Any

HOST_COMMANDS = {
    "codex": "Codex CLI",
    "claude": "Claude Code",
    "cursor": "Cursor CLI",
}

TOOLCHAIN_COMMANDS = [
    "git",
    "gh",
    "python",
    "python3",
    "uv",
    "pipx",
    "node",
    "npm",
    "pnpm",
    "yarn",
    "bun",
    "docker",
]

MCP_CONFIGS = [
    ".mcp.json",
    ".cursor/mcp.json",
    ".claude/mcp.json",
]

SKILL_PATHS = [
    ".aaop/skills",
    ".agents/skills",
    ".claude/skills",
    ".cursor/skills",
]

INSTRUCTION_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    ".github/copilot-instructions.md",
]

MANIFEST_PATTERNS = [
    "package.json",
    "pyproject.toml",
    "requirements*.txt",
    "uv.lock",
    "poetry.lock",
    "Pipfile",
    "Cargo.toml",
    "go.mod",
    "pom.xml",
    "build.gradle*",
    "composer.json",
    "Gemfile",
]

TEST_PATTERNS = [
    "playwright.config.*",
    "pytest.ini",
    "tox.ini",
    "jest.config.*",
    "vitest.config.*",
    "cypress.config.*",
    "tests",
    "test",
    "__tests__",
]

CI_PATTERNS = [
    ".github/workflows/*.yml",
    ".github/workflows/*.yaml",
    ".gitlab-ci.yml",
    "Jenkinsfile",
]

DEPLOY_PATTERNS = [
    "Dockerfile*",
    "docker-compose*.yml",
    "docker-compose*.yaml",
    "compose*.yml",
    "compose*.yaml",
    "vercel.json",
    "netlify.toml",
    "fly.toml",
    "render.yaml",
    "k8s",
    "kubernetes",
    "helm",
]


def package_root() -> Path:
    return Path(__file__).resolve().parents[1]


def existing_paths(root: Path, candidates: list[str]) -> list[str]:
    return [item for item in candidates if (root / item).exists()]


def glob_paths(root: Path, patterns: list[str], limit: int = 200) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for pattern in patterns:
        try:
            matches = root.glob(pattern)
        except (ValueError, OSError):
            continue
        for path in matches:
            try:
                relative = path.relative_to(root).as_posix()
            except ValueError:
                continue
            if relative not in seen:
                seen.add(relative)
                found.append(relative)
            if len(found) >= limit:
                return sorted(found)
    return sorted(found)


def command_paths(commands: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for command in commands:
        path = shutil.which(command)
        if path:
            found[command] = path
    return found


def count_skills(root: Path, paths: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for relative in paths:
        directory = root / relative
        if directory.exists():
            counts[relative] = len(list(directory.glob("*/SKILL.md")))
    return counts


def load_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def node_dependencies(root: Path) -> dict[str, str]:
    package = load_json(root / "package.json")
    if not package:
        return {}
    found: dict[str, str] = {}
    for section in ("dependencies", "devDependencies", "optionalDependencies", "peerDependencies"):
        values = package.get(section)
        if not isinstance(values, dict):
            continue
        for name, version in values.items():
            if isinstance(name, str):
                found[name] = str(version)
    return found


def python_distribution_evidence(names: list[str]) -> list[dict[str, str]]:
    """Resolve either distribution names or top-level import package names."""
    evidence: list[dict[str, str]] = []
    package_map = importlib.metadata.packages_distributions()
    for name in names:
        if not isinstance(name, str) or not name:
            continue
        try:
            version = importlib.metadata.version(name)
            evidence.append({"requested": name, "distribution": name, "version": version})
            continue
        except importlib.metadata.PackageNotFoundError:
            pass
        distributions = package_map.get(name, [])
        for distribution in distributions:
            try:
                version = importlib.metadata.version(distribution)
            except importlib.metadata.PackageNotFoundError:
                version = "unknown"
            evidence.append({"requested": name, "distribution": distribution, "version": version})
    return evidence


def recipe_catalog() -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    root = package_root() / "recipes"
    if not root.exists():
        return recipes
    for path in sorted(root.glob("*.json")):
        payload = load_json(path)
        if payload:
            recipes.append(payload)
    return recipes


def provider_levels() -> dict[str, int]:
    payload = load_json(package_root() / "registries" / "providers.json") or {}
    rows = payload.get("providers", [])
    levels: dict[str, int] = {}
    if not isinstance(rows, list):
        return levels
    for row in rows:
        if isinstance(row, dict) and isinstance(row.get("id"), str) and isinstance(row.get("adoption_level"), int):
            levels[row["id"]] = row["adoption_level"]
    return levels


def detect_recipe(root: Path, recipe: dict[str, Any], node_deps: dict[str, str]) -> dict[str, Any]:
    provider_id = str(recipe.get("provider_id") or recipe.get("id") or "unknown")
    detect = recipe.get("detect")
    if not isinstance(detect, dict):
        detect = {}

    command_names = [x for x in detect.get("commands", []) if isinstance(x, str)]
    commands = command_paths(command_names)

    file_patterns = [x for x in detect.get("files", []) if isinstance(x, str)]
    files = glob_paths(root, file_patterns)

    python_names = [x for x in detect.get("python_packages", []) if isinstance(x, str)]
    python_packages = python_distribution_evidence(python_names)

    node_names = [x for x in detect.get("node_packages", []) if isinstance(x, str)]
    node_packages = {name: node_deps[name] for name in node_names if name in node_deps}

    has_detector = bool(command_names or file_patterns or python_names or node_names)
    detected = bool(commands or files or python_packages or node_packages)

    evidence: dict[str, Any] = {}
    if commands:
        evidence["commands"] = commands
    if files:
        evidence["files"] = files
    if python_packages:
        evidence["python_packages"] = python_packages
    if node_packages:
        evidence["node_packages"] = node_packages

    return {
        "provider_id": provider_id,
        "status": "detected" if detected else ("not_detected" if has_detector else "no_detector"),
        "detected": detected,
        "evidence": evidence,
        "source_of_truth": recipe.get("source_of_truth"),
        "last_verified": recipe.get("last_verified"),
    }


def route_context(route_id: str | None, detections: dict[str, dict[str, Any]]) -> dict[str, Any] | None:
    if not route_id:
        return None
    path = package_root() / "routes" / f"{route_id}.json"
    payload = load_json(path)
    if not payload:
        available = ", ".join(sorted(p.stem for p in (package_root() / "routes").glob("*.json")))
        raise SystemExit(f"Unknown route {route_id!r}. Available: {available}")

    candidate_ids: list[str] = []
    for escalation in payload.get("escalations", []):
        if not isinstance(escalation, dict):
            continue
        for provider_id in escalation.get("provider_candidates", []):
            if isinstance(provider_id, str) and provider_id not in candidate_ids:
                candidate_ids.append(provider_id)

    return {
        "route_id": route_id,
        "objective": payload.get("objective"),
        "provider_candidates": [
            detections.get(
                provider_id,
                {"provider_id": provider_id, "status": "no_recipe", "detected": False, "evidence": {}},
            )
            for provider_id in candidate_ids
        ],
        "policy": "Candidate presence does not prove the route needs the provider. Evaluate the route escalation condition and capability gap first.",
    }


def infer_surface(
    host_commands: dict[str, str],
    mcp: list[str],
    skills: dict[str, int],
    detections: dict[str, dict[str, Any]],
    levels: dict[str, int],
) -> int:
    level = 1 if host_commands else 0
    external_skills = any(relative != ".aaop/skills" and value > 0 for relative, value in skills.items())
    if mcp or external_skills:
        level = max(level, 2)
    for provider_id, detection in detections.items():
        # AAOP's own canonical SKILL.md files use the Agent Skills format but do
        # not mean the developer adopted a separate Level-2 provider surface.
        if provider_id == "agent-skills":
            continue
        if detection.get("detected"):
            level = max(level, levels.get(provider_id, 0))
    return min(level, 5)


def inspect(root: Path, selected_route: str | None = None) -> dict[str, Any]:
    instructions = existing_paths(root, INSTRUCTION_FILES)
    mcp = existing_paths(root, MCP_CONFIGS)
    skill_dirs = existing_paths(root, SKILL_PATHS)
    skills = count_skills(root, skill_dirs)
    hosts = command_paths(list(HOST_COMMANDS))
    toolchain = command_paths(TOOLCHAIN_COMMANDS)
    node_deps = node_dependencies(root)

    detections_list = [detect_recipe(root, recipe, node_deps) for recipe in recipe_catalog()]
    detections = {item["provider_id"]: item for item in detections_list}
    levels = provider_levels()
    surface = infer_surface(hosts, mcp, skills, detections, levels)

    project_signals = {
        "manifests": glob_paths(root, MANIFEST_PATTERNS),
        "test_signals": glob_paths(root, TEST_PATTERNS),
        "ci_signals": glob_paths(root, CI_PATTERNS),
        "deployment_signals": glob_paths(root, DEPLOY_PATTERNS),
        "node_dependencies": node_deps,
    }

    report: dict[str, Any] = {
        "project_root": str(root),
        "instruction_files": instructions,
        "mcp_configs": mcp,
        "skill_counts": skills,
        "host_commands": hosts,
        "toolchain_commands": toolchain,
        "project_signals": project_signals,
        "provider_detection": detections,
        "observed_surface_level": surface,
        "policy": "Presence is not a recommendation. Start with what is present; prove a route capability gap before adding or activating a provider.",
        "next_action": "Use developer intake to select the current route, then match that Route Capability Pack against this environment evidence.",
    }

    context = route_context(selected_route, detections)
    if context:
        report["route_context"] = context
    return report


def render(report: dict[str, Any]) -> None:
    print("AAOP environment doctor")
    print(f"  project: {report['project_root']}")
    print(f"  observed surface: Level {report['observed_surface_level']}")
    print(f"  instructions: {', '.join(report['instruction_files']) or 'none detected'}")
    print(f"  MCP configs: {', '.join(report['mcp_configs']) or 'none detected'}")

    skill_counts = report.get("skill_counts", {})
    if isinstance(skill_counts, dict) and skill_counts:
        rendered = ", ".join(f"{key}={value}" for key, value in skill_counts.items())
    else:
        rendered = "none detected"
    print(f"  skills: {rendered}")

    hosts = report.get("host_commands", {})
    print(f"  hosts: {', '.join(hosts) if isinstance(hosts, dict) and hosts else 'none detected'}")
    toolchain = report.get("toolchain_commands", {})
    print(f"  toolchain: {', '.join(toolchain) if isinstance(toolchain, dict) and toolchain else 'none detected'}")

    detections = report.get("provider_detection", {})
    if isinstance(detections, dict):
        detected = sorted(provider_id for provider_id, item in detections.items() if isinstance(item, dict) and item.get("detected"))
        print(f"  detected providers: {', '.join(detected) or 'none detected'}")

    route = report.get("route_context")
    if isinstance(route, dict):
        print(f"  route: {route.get('route_id')}")
        candidates = route.get("provider_candidates", [])
        if isinstance(candidates, list):
            for candidate in candidates:
                if isinstance(candidate, dict):
                    print(f"    candidate {candidate.get('provider_id')}: {candidate.get('status')}")

    print("  decision: presence is not a recommendation; install nothing from this report alone")
    print(f"  next: {report['next_action']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect the current AAOP environment and provider surface")
    parser.add_argument("root", nargs="?", type=Path, default=Path.cwd())
    parser.add_argument("--route", help="Optionally show provider presence relevant to one current Route Capability Pack")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    root = args.root.expanduser().resolve()
    report = inspect(root, args.route)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0

    render(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
