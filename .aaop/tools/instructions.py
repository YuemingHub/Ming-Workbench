#!/usr/bin/env python3
"""Inventory project instruction topology without modifying rules.

The tool reports instruction files/surfaces that documented coding hosts may use.
It does not decide which conflicting instruction is semantically correct and does
not rewrite project rules. Host behavior can change; see adapters/ and the host
bootstrap conformance document for the last verified source facts.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

IGNORED_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    "vendor",
}

AAOP_BEGIN = "<!-- AAOP:BEGIN -->"
AAOP_END = "<!-- AAOP:END -->"


def relative(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def depth(root: Path, path: Path) -> int:
    try:
        return max(0, len(path.parent.relative_to(root).parts))
    except ValueError:
        return 0


def has_aaop_block(path: Path) -> bool:
    if not path.is_file():
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return False
    return text.count(AAOP_BEGIN) == 1 and text.count(AAOP_END) == 1


def walk_files(root: Path, names: set[str] | None = None, suffix: str | None = None) -> list[Path]:
    found: list[Path] = []
    for current, dirs, files in os.walk(root):
        dirs[:] = [item for item in dirs if item not in IGNORED_DIRS]
        base = Path(current)
        for name in files:
            if names is not None and name not in names:
                continue
            if suffix is not None and not name.endswith(suffix):
                continue
            found.append(base / name)
    return sorted(found, key=lambda item: relative(root, item))


def parse_mdc_frontmatter(path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        return result
    if not lines or lines[0].strip() != "---":
        return result
    for raw in lines[1:]:
        if raw.strip() == "---":
            break
        if ":" not in raw or raw[:1].isspace():
            continue
        key, value = raw.split(":", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key == "alwaysApply":
            result[key] = value.lower() == "true"
        elif key in {"description", "globs"}:
            result[key] = value
    return result


def codex_topology(root: Path) -> dict[str, Any]:
    files = walk_files(root, names={"AGENTS.md", "AGENTS.override.md"})
    rows: list[dict[str, Any]] = []
    by_directory: dict[str, set[str]] = {}
    for path in files:
        directory = relative(root, path.parent)
        if directory == ".":
            directory = ""
        by_directory.setdefault(directory, set()).add(path.name)
        rows.append(
            {
                "path": relative(root, path),
                "kind": "override" if path.name == "AGENTS.override.md" else "agents",
                "depth": depth(root, path),
                "aaop_block": has_aaop_block(path),
            }
        )

    same_directory_pairs = [
        directory or "."
        for directory, names in sorted(by_directory.items())
        if {"AGENTS.md", "AGENTS.override.md"} <= names
    ]
    nested = [row["path"] for row in rows if row["depth"] > 0]
    return {
        "documented_behavior": "Codex aggregates project instructions from the project root toward the current working directory; more-specific instructions appear later. AGENTS.override.md is a documented instruction filename alongside AGENTS.md.",
        "files": rows,
        "nested_files": nested,
        "same_directory_agents_and_override": same_directory_pairs,
        "note": "Topology does not compute an effective prompt for an arbitrary cwd or custom project_doc_fallback_filenames; inspect the active Codex session/config when that matters.",
    }


def claude_topology(root: Path) -> dict[str, Any]:
    files = walk_files(root, names={"CLAUDE.md", "CLAUDE.local.md"})
    rows: list[dict[str, Any]] = []
    for path in files:
        rows.append(
            {
                "path": relative(root, path),
                "kind": "local-deprecated" if path.name == "CLAUDE.local.md" else "claude",
                "depth": depth(root, path),
                "aaop_block": has_aaop_block(path),
                "deprecated": path.name == "CLAUDE.local.md",
            }
        )
    return {
        "documented_behavior": "Claude Code reads CLAUDE.md/CLAUDE.local.md along the cwd ancestor path and can discover nested CLAUDE.md files when it reads files in those subtrees; CLAUDE.local.md is deprecated in favor of imports.",
        "files": rows,
        "nested_files": [row["path"] for row in rows if row["depth"] > 0],
        "deprecated_files": [row["path"] for row in rows if row["deprecated"]],
        "note": "Topology is filesystem evidence only; it does not resolve @imports, user-level ~/.claude/CLAUDE.md, or which nested subtree the current task will access.",
    }


def cursor_topology(root: Path) -> dict[str, Any]:
    root_agents = root / "AGENTS.md"
    root_claude = root / "CLAUDE.md"
    legacy = root / ".cursorrules"

    rules: list[dict[str, Any]] = []
    for path in walk_files(root, suffix=".mdc"):
        if ".cursor" not in path.parts:
            continue
        parts = path.parts
        try:
            cursor_index = max(i for i, value in enumerate(parts) if value == ".cursor")
        except ValueError:
            continue
        if cursor_index + 1 >= len(parts) or parts[cursor_index + 1] != "rules":
            continue
        metadata = parse_mdc_frontmatter(path)
        rules.append(
            {
                "path": relative(root, path),
                "scope_directory": relative(root, Path(*parts[:cursor_index])) if cursor_index else ".",
                "description": metadata.get("description"),
                "globs": metadata.get("globs"),
                "always_apply": metadata.get("alwaysApply"),
            }
        )

    nested_rules = [row["path"] for row in rules if not row["path"].startswith(".cursor/rules/")]
    return {
        "documented_behavior": "Cursor supports project rules in .cursor/rules, including nested .cursor/rules directories scoped near subtrees. Root AGENTS.md is a simple project instruction alternative; Cursor CLI also reads root CLAUDE.md. Root .cursorrules remains supported but deprecated.",
        "root_agents": {
            "path": "AGENTS.md",
            "present": root_agents.is_file(),
            "aaop_block": has_aaop_block(root_agents),
            "scope": "root/global for Cursor AGENTS.md according to current docs",
        },
        "root_claude_cli": {
            "path": "CLAUDE.md",
            "present": root_claude.is_file(),
            "aaop_block": has_aaop_block(root_claude),
            "scope": "Cursor CLI root rule input; not modeled here as a Cursor IDE AGENTS replacement",
        },
        "project_rules": rules,
        "nested_project_rules": nested_rules,
        "legacy_cursorrules": {
            "path": ".cursorrules",
            "present": legacy.is_file(),
            "deprecated": legacy.is_file(),
        },
        "note": "Rule applicability depends on Cursor rule metadata and referenced files. Inventory does not claim that every discovered .mdc rule is active for every task.",
    }


def summarize(root: Path, codex: dict[str, Any], claude: dict[str, Any], cursor: dict[str, Any]) -> list[dict[str, str]]:
    observations: list[dict[str, str]] = []

    if codex["nested_files"]:
        observations.append(
            {
                "id": "codex-nested-instructions",
                "level": "informational",
                "message": "Nested Codex instruction files exist; the effective instruction set can change with cwd/path scope.",
            }
        )
    if codex["same_directory_agents_and_override"]:
        observations.append(
            {
                "id": "codex-same-directory-override",
                "level": "review",
                "message": "At least one directory contains both AGENTS.md and AGENTS.override.md; inspect actual Codex precedence/config before assuming the root AAOP bridge is sufficient for that scope.",
            }
        )
    if claude["nested_files"]:
        observations.append(
            {
                "id": "claude-nested-memory",
                "level": "informational",
                "message": "Nested Claude memory files exist and may be included when work enters their subtree.",
            }
        )
    if claude["deprecated_files"]:
        observations.append(
            {
                "id": "claude-local-deprecated",
                "level": "review",
                "message": "Deprecated CLAUDE.local.md files were found; preserve them as project evidence but consider current import-based guidance before editing.",
            }
        )
    if cursor["nested_project_rules"]:
        observations.append(
            {
                "id": "cursor-nested-rules",
                "level": "informational",
                "message": "Nested Cursor project rules exist; rule applicability can change by referenced subtree/file.",
            }
        )
    if cursor["legacy_cursorrules"]["present"]:
        observations.append(
            {
                "id": "cursor-legacy-cursorrules",
                "level": "review",
                "message": "Root .cursorrules is present and currently documented as legacy/deprecated; do not delete or migrate it without project intent.",
            }
        )

    aaop_root_agents = has_aaop_block(root / "AGENTS.md")
    aaop_root_claude = has_aaop_block(root / "CLAUDE.md")
    if aaop_root_agents or aaop_root_claude:
        observations.append(
            {
                "id": "aaop-root-bootstrap",
                "level": "informational",
                "message": f"AAOP root bootstrap detected: AGENTS.md={aaop_root_agents}, CLAUDE.md={aaop_root_claude}. Nested/scoped project instructions remain independent evidence and are not rewritten by this tool.",
            }
        )

    return observations


def inspect(root: Path) -> dict[str, Any]:
    root = root.expanduser().resolve()
    codex = codex_topology(root)
    claude = claude_topology(root)
    cursor = cursor_topology(root)
    return {
        "root": str(root),
        "read_only": True,
        "host_facts_last_verified": "2026-08-08",
        "codex": codex,
        "claude_code": claude,
        "cursor": cursor,
        "observations": summarize(root, codex, claude, cursor),
        "boundary": "Inventory only. Do not infer semantic conflict resolution, mutate nested instructions, or assume every discovered rule is active for the current task.",
    }


def render(report: dict[str, Any]) -> None:
    print("AAOP instruction topology")
    print(f"  root: {report['root']}")
    print(f"  codex instruction files: {len(report['codex']['files'])}")
    print(f"  claude memory files: {len(report['claude_code']['files'])}")
    print(f"  cursor project rules: {len(report['cursor']['project_rules'])}")
    if report["cursor"]["legacy_cursorrules"]["present"]:
        print("  cursor legacy .cursorrules: present (deprecated)")
    for item in report["observations"]:
        print(f"  [{item['level']}] {item['id']}: {item['message']}")
    print(f"  boundary: {report['boundary']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Inventory host project-instruction topology")
    parser.add_argument("root", nargs="?", type=Path, default=Path.cwd(), help="Project root")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    report = inspect(args.root)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        render(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
