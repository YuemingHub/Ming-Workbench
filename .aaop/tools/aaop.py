#!/usr/bin/env python3
"""Human-facing AAOP command surface.

The lower-level tools remain available for orchestration and diagnostics. This
wrapper gives a developer one stable entrypoint for the common human workflow:

    python .aaop/tools/aaop.py ready .
    python .aaop/tools/aaop.py status .
    python .aaop/tools/aaop.py provenance
    python .aaop/tools/aaop.py doctor .
    python .aaop/tools/aaop.py prompt
    python .aaop/tools/aaop.py version
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

# The human-facing CLI is observational. Dynamic loading of health/doctor/provenance
# should not create __pycache__ files inside an installed AAOP package merely because
# a user ran a diagnostic command.
sys.dont_write_bytecode = True

STARTER_PROMPT = (
    "Take responsibility for this project from the current evidence. First understand "
    "the project and reconcile AAOP continuity state. If my autonomous/collaborative "
    "working mode is not already established, ask me that one question once. Resolve "
    "everything the repository or your engineering judgment can resolve without asking "
    "me, ask only for genuinely human-owned product/domain decisions or authorization, "
    "then continue through implementation and verification without making me schedule "
    "the engineering process."
)


def tool_root() -> Path:
    return Path(__file__).resolve().parent


def package_root() -> Path:
    return tool_root().parent


def default_project_root() -> Path:
    return package_root().parent


def load_tool(name: str) -> ModuleType:
    path = tool_root() / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"aaop_{name}", path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"AAOP: unable to load internal tool {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def package_version() -> str:
    path = package_root() / "VERSION"
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise SystemExit(f"AAOP: cannot read authoritative package version {path}: {exc}") from exc
    if not value:
        raise SystemExit(f"AAOP: authoritative package version is empty: {path}")
    return value


def provenance_summary(source_tree: bool) -> dict[str, Any]:
    if source_tree:
        return {
            "state": "source-tree",
            "source": {"kind": "source-tree", "ref": None},
            "package_fingerprint": None,
            "next_action": "Source-tree validation is not an installed bootstrap provenance record.",
        }
    provenance_module = load_tool("provenance")
    report = provenance_module.inspect(package_root())
    return {
        "state": report.get("state"),
        "source": report.get("source"),
        "package_fingerprint": report.get("current_fingerprint") or report.get("recorded_fingerprint"),
        "next_action": report.get("next_action"),
    }


def working_contract_summary() -> dict[str, Any]:
    contract_module = load_tool("working_contract")
    path = contract_module.state_path()
    if not path.exists():
        return {
            "state": "uninitialized",
            "mode": "unset",
            "alignment_state": "collecting",
            "execution_allowed": False,
            "revision": None,
        }
    try:
        state = contract_module.load_state()
        gate = contract_module.gate_result(state)
    except SystemExit as exc:
        return {
            "state": "invalid",
            "mode": "unknown",
            "alignment_state": "unknown",
            "execution_allowed": False,
            "revision": None,
            "error": str(exc),
        }
    return {
        "state": "present",
        "mode": gate.get("mode"),
        "alignment_state": gate.get("alignment_state"),
        "execution_allowed": gate.get("execution_allowed"),
        "revision": gate.get("revision"),
        "reasons": gate.get("reasons", []),
    }


def readiness(root: Path) -> dict[str, Any]:
    health_module = load_tool("health")
    doctor_module = load_tool("doctor")

    health = health_module.inspect_installation(root)
    doctor = doctor_module.inspect(root)

    health_state = str(health.get("state") or "unknown")
    source_tree = health_state == "source-tree"
    install_ready = health_state == "healthy"
    ready = install_ready or source_tree
    provenance = provenance_summary(source_tree)
    working_contract = working_contract_summary()

    hosts = doctor.get("host_commands", {})
    if not isinstance(hosts, dict):
        hosts = {}

    instructions = doctor.get("instruction_files", [])
    if not isinstance(instructions, list):
        instructions = []

    project_signals = doctor.get("project_signals", {})
    if not isinstance(project_signals, dict):
        project_signals = {}

    signal_counts: dict[str, int] = {}
    for key in ("manifests", "test_signals", "ci_signals", "deployment_signals"):
        value = project_signals.get(key, [])
        signal_counts[key] = len(value) if isinstance(value, list) else 0

    return {
        "ready": ready,
        "version": health.get("package_version") or package_version(),
        "project_root": str(root),
        "health_state": health_state,
        "health_next_action": health.get("next_action"),
        "source_tree": source_tree,
        "provenance_state": provenance.get("state"),
        "provenance_source": provenance.get("source"),
        "package_fingerprint": provenance.get("package_fingerprint"),
        "provenance_next_action": provenance.get("next_action"),
        "working_contract": working_contract,
        "instruction_files": instructions,
        "host_commands": hosts,
        "observed_surface_level": doctor.get("observed_surface_level"),
        "project_signal_counts": signal_counts,
        "starter_prompt": STARTER_PROMPT,
    }


def render_ready(report: dict[str, Any]) -> None:
    state = "READY" if report["ready"] else "REVIEW REQUIRED"
    print(f"AAOP {state}")
    print(f"  version: {report['version']}")
    print(f"  project: {report['project_root']}")
    print(f"  health: {report['health_state']}")

    provenance_state = report.get("provenance_state") or "unknown"
    source = report.get("provenance_source")
    source_label = "-"
    if isinstance(source, dict):
        source_label = str(source.get("kind") or "unknown")
        if source.get("ref"):
            source_label += f"@{source['ref']}"
    print(f"  provenance: {provenance_state} ({source_label})")

    contract = report.get("working_contract", {})
    if isinstance(contract, dict):
        print(
            "  working contract: "
            f"{contract.get('state', 'unknown')} "
            f"mode={contract.get('mode', 'unknown')} "
            f"alignment={contract.get('alignment_state', 'unknown')} "
            f"execution={'allowed' if contract.get('execution_allowed') else 'gated'}"
        )

    instructions = report.get("instruction_files", [])
    print(f"  project instructions: {', '.join(instructions) if instructions else 'none detected'}")

    hosts = report.get("host_commands", {})
    if isinstance(hosts, dict) and hosts:
        print(f"  host CLI on PATH: {', '.join(sorted(hosts))}")
    else:
        print("  host CLI on PATH: none detected (editor/desktop hosts may still work)")

    counts = report.get("project_signal_counts", {})
    if isinstance(counts, dict):
        print(
            "  project evidence: "
            f"manifests={counts.get('manifests', 0)} "
            f"tests={counts.get('test_signals', 0)} "
            f"ci={counts.get('ci_signals', 0)} "
            f"deploy={counts.get('deployment_signals', 0)}"
        )

    if report["ready"]:
        if provenance_state in {"missing", "invalid", "mismatch", "unverifiable"}:
            print(f"  provenance note: {report.get('provenance_next_action') or 'Review install provenance.'}")
        print()
        print("Open this project in Codex, Claude Code, Cursor, or another host that reads project instructions.")
        print("Then say:")
        print(f'  "{report["starter_prompt"]}"')
    else:
        print()
        print(f"Next: {report.get('health_next_action') or 'Review the AAOP installation health report.'}")


def command_ready(root: Path, as_json: bool) -> int:
    report = readiness(root)
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        render_ready(report)
    return 0 if report["ready"] else 2


def command_status(root: Path, as_json: bool) -> int:
    health_module = load_tool("health")
    report = health_module.inspect_installation(root)
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        health_module.render(report)
    return 0 if report.get("state") in {"healthy", "source-tree"} else 2


def command_provenance(as_json: bool) -> int:
    provenance_module = load_tool("provenance")
    if (package_root().parent / "scripts" / "install.py").is_file():
        report = {
            "state": "source-tree",
            "package_root": str(package_root()),
            "source": {"kind": "source-tree", "ref": None},
            "next_action": "Source tree has repository identity; bootstrap install provenance applies to installed packages.",
            "authority": "diagnostic-only; does not grant managed-file ownership or mutation authority",
        }
        if as_json:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            print("AAOP install provenance")
            print("  state: source-tree")
            print("  source: source-tree")
            print(f"  next: {report['next_action']}")
            print(f"  authority: {report['authority']}")
        return 0

    report = provenance_module.inspect(package_root())
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        provenance_module.render(report)
    return 0 if report.get("state") == "verified" else 2


def command_doctor(root: Path, route: str | None, as_json: bool) -> int:
    doctor_module = load_tool("doctor")
    report = doctor_module.inspect(root, route)
    if as_json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        doctor_module.render(report)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="AAOP user entrypoint: readiness, status, provenance, environment, starter prompt, and version"
    )
    subparsers = parser.add_subparsers(dest="command")

    ready_parser = subparsers.add_parser("ready", help="Check whether AAOP is ready to use in this project")
    ready_parser.add_argument("root", nargs="?", type=Path, default=default_project_root())
    ready_parser.add_argument("--json", action="store_true")

    status_parser = subparsers.add_parser("status", help="Show AAOP installation health")
    status_parser.add_argument("root", nargs="?", type=Path, default=default_project_root())
    status_parser.add_argument("--json", action="store_true")

    provenance_parser = subparsers.add_parser("provenance", help="Verify recorded install source and managed-byte fingerprint")
    provenance_parser.add_argument("--json", action="store_true")

    doctor_parser = subparsers.add_parser("doctor", help="Show project/environment capability evidence")
    doctor_parser.add_argument("root", nargs="?", type=Path, default=default_project_root())
    doctor_parser.add_argument("--route", help="Optionally include one route's provider candidates")
    doctor_parser.add_argument("--json", action="store_true")

    subparsers.add_parser("prompt", help="Print a starter prompt that establishes/reuses the Working Contract and continues the project")
    subparsers.add_parser("version", help="Print the installed AAOP package version")

    args = parser.parse_args()
    command = args.command or "ready"

    if command == "ready":
        root = args.root.expanduser().resolve() if hasattr(args, "root") else default_project_root()
        return command_ready(root, bool(getattr(args, "json", False)))
    if command == "status":
        root = args.root.expanduser().resolve()
        return command_status(root, args.json)
    if command == "provenance":
        return command_provenance(args.json)
    if command == "doctor":
        root = args.root.expanduser().resolve()
        return command_doctor(root, args.route, args.json)
    if command == "prompt":
        print(STARTER_PROMPT)
        return 0
    if command == "version":
        print(package_version())
        return 0

    parser.error(f"unknown command {command!r}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
