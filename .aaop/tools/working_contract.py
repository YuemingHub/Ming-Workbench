#!/usr/bin/env python3
"""Persist the AAOP Human-Agent Working Contract.

The contract is project-local continuity state. It records how the human wants to
collaborate, what outcome has actually been aligned, which decision classes
belong to whom, and the Task Pod limits that autonomous execution must respect.

It does not infer product truth or choose a route. Current project/runtime
evidence and explicit user instructions remain authoritative.
"""

from __future__ import annotations

import argparse
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

SCHEMA_VERSION = "1.0"
COLLABORATION_MODES = {"unset", "autonomous", "collaborative"}
ALIGNMENT_STATES = {"collecting", "aligned"}

DEFAULT_HUMAN_OWNED = [
    "product intent and value tradeoffs",
    "domain truth unavailable from evidence",
    "business model or audience boundary",
    "credentials or secret-bearing authorization",
    "new monetary commitments",
]
DEFAULT_AGENT_OWNED = [
    "technical architecture within established constraints",
    "framework/database/tool choice when not a hard user constraint",
    "implementation details and code organization",
    "test strategy and ordinary engineering verification",
    "Task Pod size, role selection, and provider choice within policy",
]
DEFAULT_JOINT = [
    "material irreversible product behavior",
    "major safety, ethics, privacy, or legal boundary",
    "high-impact production or destructive change not already authorized",
]


def package_root() -> Path:
    return Path(__file__).resolve().parents[1]


def state_root() -> Path:
    override = os.environ.get("AAOP_WORKING_CONTRACT_ROOT")
    if override:
        return Path(override).resolve()
    return package_root() / "runtime"


def state_path() -> Path:
    return state_root() / "working-contract.json"


def lock_path() -> Path:
    return state_root() / ".working-contract.lock"


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clean(value: str | None) -> str:
    return (value or "").strip()


def clean_many(values: list[str] | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        item = clean(value)
        if item and item not in seen:
            result.append(item)
            seen.add(item)
    return result


def merge_unique(existing: list[str], additions: list[str] | None) -> list[str]:
    return clean_many([*existing, *(additions or [])])


def validate_state(state: dict[str, Any]) -> None:
    if state.get("schema_version") != SCHEMA_VERSION:
        raise SystemExit(
            f"Unsupported working-contract schema {state.get('schema_version')!r}; "
            "use a matching/newer trusted AAOP version instead of overwriting it."
        )
    revision = state.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise SystemExit("Working contract revision must be a positive integer.")

    collaboration = state.get("collaboration")
    if not isinstance(collaboration, dict):
        raise SystemExit("Working contract collaboration section is invalid.")
    mode = collaboration.get("mode")
    if mode not in COLLABORATION_MODES:
        raise SystemExit(f"Unknown collaboration mode: {mode!r}")
    confirmed = collaboration.get("confirmed")
    if not isinstance(confirmed, bool):
        raise SystemExit("Working contract collaboration.confirmed must be boolean.")
    if mode == "unset" and confirmed:
        raise SystemExit("Unset collaboration mode cannot be confirmed.")
    if mode != "unset" and not confirmed:
        raise SystemExit("A selected collaboration mode must be marked confirmed.")

    alignment = state.get("alignment")
    if not isinstance(alignment, dict):
        raise SystemExit("Working contract alignment section is invalid.")
    if alignment.get("state") not in ALIGNMENT_STATES:
        raise SystemExit(f"Unknown alignment state: {alignment.get('state')!r}")
    for key in ("goal", "actor", "situation", "outcome"):
        if not isinstance(alignment.get(key), str):
            raise SystemExit(f"Working contract alignment.{key} must be a string.")
    for key in ("must", "non_goals", "constraints", "success_evidence", "human_open_questions"):
        value = alignment.get(key)
        if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
            raise SystemExit(f"Working contract alignment.{key} must be a list of non-empty strings.")
        if len(set(value)) != len(value):
            raise SystemExit(f"Working contract alignment.{key} contains duplicates.")
    if alignment.get("state") == "aligned":
        if not collaboration.get("confirmed"):
            raise SystemExit("Alignment cannot be confirmed before collaboration mode is confirmed.")
        for key in ("goal", "actor", "situation", "outcome"):
            if not alignment.get(key, "").strip():
                raise SystemExit(f"Aligned contract requires alignment.{key}.")
        if not alignment.get("success_evidence"):
            raise SystemExit("Aligned contract requires at least one success_evidence item.")
        if alignment.get("human_open_questions"):
            raise SystemExit("Aligned contract cannot retain human_open_questions.")

    ownership = state.get("decision_ownership")
    if not isinstance(ownership, dict):
        raise SystemExit("Working contract decision_ownership section is invalid.")
    for key in ("human_owned", "agent_owned", "joint"):
        value = ownership.get(key)
        if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
            raise SystemExit(f"Working contract decision_ownership.{key} is invalid.")

    pod = state.get("task_pod_policy")
    expected = {
        "default_single_agent": True,
        "max_members": 5,
        "accountable_owner_required": True,
        "independent_review_when_consequential": True,
        "handoff_required_between_pods": True,
    }
    if not isinstance(pod, dict):
        raise SystemExit("Working contract task_pod_policy section is invalid.")
    for key, value in expected.items():
        if pod.get(key) != value:
            raise SystemExit(f"Working contract task_pod_policy.{key} must be {value!r}.")


def load_state() -> dict[str, Any]:
    path = state_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit("AAOP working contract is not initialized for this project.") from exc
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"AAOP working contract is invalid JSON: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise SystemExit("AAOP working contract JSON must be an object.")
    validate_state(payload)
    return payload


def save_state_unlocked(state: dict[str, Any]) -> None:
    validate_state(state)
    root = state_root()
    root.mkdir(parents=True, exist_ok=True)
    path = state_path()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


@contextmanager
def state_lock() -> Iterator[None]:
    path = lock_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt

            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            if os.name == "nt":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()


def ensure_expected_revision(state: dict[str, Any], expected: int) -> None:
    actual = state["revision"]
    if actual != expected:
        raise SystemExit(
            f"Stale working-contract revision: expected {expected}, current {actual}. "
            "Re-read status, reconcile newer user/project evidence, then retry."
        )


def mutate(expected: int, change: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    with state_lock():
        state = load_state()
        ensure_expected_revision(state, expected)
        change(state)
        state["revision"] += 1
        state["updated_at"] = now_utc()
        save_state_unlocked(state)
        return state


def initial_state(goal: str, mode: str) -> dict[str, Any]:
    selected = mode != "unset"
    timestamp = now_utc()
    return {
        "schema_version": SCHEMA_VERSION,
        "revision": 1,
        "collaboration": {
            "mode": mode,
            "confirmed": selected,
            "confirmed_at": timestamp if selected else None,
            "notes": [],
        },
        "alignment": {
            "state": "collecting",
            "goal": clean(goal),
            "actor": "",
            "situation": "",
            "outcome": "",
            "must": [],
            "non_goals": [],
            "constraints": [],
            "success_evidence": [],
            "human_open_questions": [],
            "confirmed_at": None,
        },
        "decision_ownership": {
            "human_owned": list(DEFAULT_HUMAN_OWNED),
            "agent_owned": list(DEFAULT_AGENT_OWNED),
            "joint": list(DEFAULT_JOINT),
        },
        "task_pod_policy": {
            "default_single_agent": True,
            "max_members": 5,
            "accountable_owner_required": True,
            "independent_review_when_consequential": True,
            "handoff_required_between_pods": True,
            "role_provider_order": ["host-native", "project-local", "agency-agents-zh", "other-reviewed-provider"],
        },
        "updated_at": timestamp,
    }


def gate_result(state: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    collaboration = state["collaboration"]
    alignment = state["alignment"]
    if collaboration["mode"] == "unset" or not collaboration["confirmed"]:
        reasons.append("collaboration mode is not confirmed")
    if alignment["state"] != "aligned":
        reasons.append("intent/outcome alignment is not confirmed")
    if alignment["human_open_questions"]:
        reasons.append("human-owned open questions remain")
    return {
        "execution_allowed": not reasons,
        "mode": collaboration["mode"],
        "alignment_state": alignment["state"],
        "revision": state["revision"],
        "reasons": reasons,
    }


def print_state(state: dict[str, Any], as_json: bool) -> None:
    if as_json:
        print(json.dumps(state, ensure_ascii=False, indent=2))
        return
    gate = gate_result(state)
    print(f"revision: {state['revision']}")
    print(f"collaboration: {state['collaboration']['mode']}")
    print(f"alignment: {state['alignment']['state']}")
    print(f"execution allowed: {'yes' if gate['execution_allowed'] else 'no'}")
    print(f"goal: {state['alignment']['goal'] or '-'}")
    print(f"outcome: {state['alignment']['outcome'] or '-'}")
    print(f"human open questions: {len(state['alignment']['human_open_questions'])}")


def command_init(args: argparse.Namespace) -> int:
    if args.mode not in COLLABORATION_MODES:
        raise SystemExit(f"Unknown mode: {args.mode}")
    with state_lock():
        if state_path().exists():
            raise SystemExit("AAOP working contract already exists; inspect status instead of replacing continuity state.")
        state = initial_state(args.goal, args.mode)
        save_state_unlocked(state)
    print_state(state, args.json)
    return 0


def command_status(args: argparse.Namespace) -> int:
    if not state_path().exists():
        payload = {"state": "uninitialized", "execution_allowed": False}
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print("working contract: uninitialized")
        return 2
    print_state(load_state(), args.json)
    return 0


def command_gate(args: argparse.Namespace) -> int:
    state = load_state()
    payload = gate_result(state)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print("READY" if payload["execution_allowed"] else "NOT_READY")
        for reason in payload["reasons"]:
            print(f"- {reason}")
    return 0 if payload["execution_allowed"] else 3


def command_set_mode(args: argparse.Namespace) -> int:
    if args.mode == "unset":
        raise SystemExit("Use an explicit autonomous or collaborative mode once the human has chosen.")

    def change(state: dict[str, Any]) -> None:
        state["collaboration"].update({"mode": args.mode, "confirmed": True, "confirmed_at": now_utc()})
        if args.note:
            state["collaboration"]["notes"] = merge_unique(state["collaboration"].get("notes", []), [args.note])

    state = mutate(args.expected_revision, change)
    print_state(state, args.json)
    return 0


def command_update_alignment(args: argparse.Namespace) -> int:
    def change(state: dict[str, Any]) -> None:
        alignment = state["alignment"]
        if alignment["state"] == "aligned":
            raise SystemExit("Alignment is already confirmed; reset it explicitly before changing aligned intent.")
        for key in ("goal", "actor", "situation", "outcome"):
            value = getattr(args, key)
            if value is not None:
                alignment[key] = clean(value)
        mapping = {
            "must": args.must,
            "non_goals": args.non_goal,
            "constraints": args.constraint,
            "success_evidence": args.success_evidence,
            "human_open_questions": args.open_question,
        }
        for key, values in mapping.items():
            alignment[key] = merge_unique(alignment[key], values)

    state = mutate(args.expected_revision, change)
    print_state(state, args.json)
    return 0


def command_resolve_question(args: argparse.Namespace) -> int:
    question = clean(args.question)

    def change(state: dict[str, Any]) -> None:
        alignment = state["alignment"]
        current = alignment["human_open_questions"]
        if question not in current:
            raise SystemExit("The specified human-owned question is not present in the current contract.")
        alignment["human_open_questions"] = [item for item in current if item != question]
        if args.evidence:
            alignment["constraints"] = merge_unique(alignment["constraints"], [f"resolved human input: {args.evidence}"])

    state = mutate(args.expected_revision, change)
    print_state(state, args.json)
    return 0


def command_confirm_alignment(args: argparse.Namespace) -> int:
    def change(state: dict[str, Any]) -> None:
        collaboration = state["collaboration"]
        alignment = state["alignment"]
        if collaboration["mode"] == "unset" or not collaboration["confirmed"]:
            raise SystemExit("Confirm autonomous/collaborative working mode before confirming alignment.")
        required = [key for key in ("goal", "actor", "situation", "outcome") if not alignment[key].strip()]
        if required:
            raise SystemExit("Alignment is missing required fields: " + ", ".join(required))
        if not alignment["success_evidence"]:
            raise SystemExit("Alignment requires at least one observable success-evidence item.")
        if alignment["human_open_questions"]:
            raise SystemExit("Human-owned questions remain unresolved; do not enter autonomous execution.")
        alignment["state"] = "aligned"
        alignment["confirmed_at"] = now_utc()

    state = mutate(args.expected_revision, change)
    print_state(state, args.json)
    return 0


def command_reset_alignment(args: argparse.Namespace) -> int:
    reason = clean(args.reason)
    if not reason:
        raise SystemExit("Resetting an aligned contract requires a concrete reason/evidence delta.")

    def change(state: dict[str, Any]) -> None:
        alignment = state["alignment"]
        alignment["state"] = "collecting"
        alignment["confirmed_at"] = None
        if args.goal is not None:
            alignment["goal"] = clean(args.goal)
        if args.outcome is not None:
            alignment["outcome"] = clean(args.outcome)
        alignment["constraints"] = merge_unique(alignment["constraints"], [f"alignment reopened: {reason}"])

    state = mutate(args.expected_revision, change)
    print_state(state, args.json)
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="AAOP Human-Agent Working Contract")
    sub = root.add_subparsers(dest="command", required=True)

    init = sub.add_parser("init")
    init.add_argument("--goal", default="")
    init.add_argument("--mode", choices=sorted(COLLABORATION_MODES), default="unset")
    init.add_argument("--json", action="store_true")
    init.set_defaults(func=command_init)

    status = sub.add_parser("status")
    status.add_argument("--json", action="store_true")
    status.set_defaults(func=command_status)

    gate = sub.add_parser("gate")
    gate.add_argument("--json", action="store_true")
    gate.set_defaults(func=command_gate)

    mode = sub.add_parser("set-mode")
    mode.add_argument("--expected-revision", type=int, required=True)
    mode.add_argument("--mode", choices=["autonomous", "collaborative"], required=True)
    mode.add_argument("--note")
    mode.add_argument("--json", action="store_true")
    mode.set_defaults(func=command_set_mode)

    update = sub.add_parser("update-alignment")
    update.add_argument("--expected-revision", type=int, required=True)
    update.add_argument("--goal")
    update.add_argument("--actor")
    update.add_argument("--situation")
    update.add_argument("--outcome")
    update.add_argument("--must", action="append")
    update.add_argument("--non-goal", action="append")
    update.add_argument("--constraint", action="append")
    update.add_argument("--success-evidence", action="append")
    update.add_argument("--open-question", action="append")
    update.add_argument("--json", action="store_true")
    update.set_defaults(func=command_update_alignment)

    resolve = sub.add_parser("resolve-question")
    resolve.add_argument("--expected-revision", type=int, required=True)
    resolve.add_argument("--question", required=True)
    resolve.add_argument("--evidence")
    resolve.add_argument("--json", action="store_true")
    resolve.set_defaults(func=command_resolve_question)

    confirm = sub.add_parser("confirm-alignment")
    confirm.add_argument("--expected-revision", type=int, required=True)
    confirm.add_argument("--json", action="store_true")
    confirm.set_defaults(func=command_confirm_alignment)

    reset = sub.add_parser("reset-alignment")
    reset.add_argument("--expected-revision", type=int, required=True)
    reset.add_argument("--reason", required=True)
    reset.add_argument("--goal")
    reset.add_argument("--outcome")
    reset.add_argument("--json", action="store_true")
    reset.set_defaults(func=command_reset_alignment)
    return root


def main() -> int:
    args = parser().parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
