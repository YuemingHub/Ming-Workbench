#!/usr/bin/env python3
"""Persist AAOP multi-route Journey checkpoints without becoming a workflow engine.

This tool stores only continuity state under ``.aaop/runtime/journeys``. It does
not select routes, execute tasks, install providers, or decide whether evidence
is trustworthy. Current project/runtime/target evidence always outranks a saved
checkpoint when the two disagree.
"""

from __future__ import annotations

import argparse
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from journey_state import (
    CURRENT_STATE_SCHEMA_VERSION,
    CheckpointError,
    FutureCheckpointSchema,
    checkpoint_revision,
    load_checkpoint,
    recover_checkpoint_unlocked,
    save_checkpoint_unlocked,
)

ROUTES = {
    "idea-to-build",
    "repo-recovery",
    "bug-fix",
    "feature-change",
    "understand-review",
    "release-operations",
}
STATUSES = {"active", "blocked", "complete"}
STATE_SCHEMA_VERSION = CURRENT_STATE_SCHEMA_VERSION


def package_root() -> Path:
    return Path(__file__).resolve().parents[1]


def journey_root() -> Path:
    return package_root() / "journeys"


def state_root() -> Path:
    return package_root() / "runtime" / "journeys"


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SystemExit(f"AAOP Journey file not found: {path}") from exc
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"AAOP Journey file is invalid JSON: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise SystemExit(f"AAOP Journey JSON must be an object: {path}")
    return payload


def load_definition(journey_id: str) -> dict[str, Any]:
    path = journey_root() / f"{journey_id}.json"
    payload = load_json(path)
    if payload.get("journey_id") != journey_id:
        raise SystemExit(f"AAOP Journey id mismatch in {path}")
    return payload


def state_path(journey_id: str) -> Path:
    return state_root() / f"{journey_id}.json"


def lock_path(journey_id: str) -> Path:
    return state_root() / f".{journey_id}.lock"


def load_state(journey_id: str) -> dict[str, Any]:
    try:
        return load_checkpoint(journey_id, state_path(journey_id))
    except FutureCheckpointSchema as exc:
        raise SystemExit(
            "AAOP Journey checkpoint requires a newer state reader: "
            f"{exc}. Use a matching/newer trusted AAOP tool. Do not downgrade, recover, "
            "or overwrite future continuity state with this version."
        ) from exc
    except CheckpointError as exc:
        raise SystemExit(f"AAOP Journey checkpoint is invalid: {exc}") from exc


def current_revision(state: dict[str, Any]) -> int:
    """Return the checkpoint CAS revision.

    Known v0.21.0/v0.21.1 schema 0.3.1 checkpoints predate this field. They
    surface as revision 0 so the first current-format mutation can migrate them
    explicitly with ``--expected-revision 0``. Current schema checkpoints must
    carry a positive revision; missing revision is not treated as legacy unless
    the checkpoint explicitly identifies the known legacy schema.
    """
    try:
        return checkpoint_revision(state)
    except FutureCheckpointSchema as exc:
        raise SystemExit(
            f"AAOP Journey checkpoint requires a newer state reader: {exc}"
        ) from exc
    except CheckpointError as exc:
        raise SystemExit(f"AAOP Journey checkpoint has invalid revision/state: {exc}") from exc


def save_state_unlocked(journey_id: str, payload: dict[str, Any]) -> None:
    try:
        save_checkpoint_unlocked(journey_id, state_path(journey_id), payload)
    except FutureCheckpointSchema as exc:
        raise SystemExit(
            f"Refusing to save Journey checkpoint through an unsupported future schema: {exc}"
        ) from exc
    except CheckpointError as exc:
        raise SystemExit(f"Refusing to save invalid Journey checkpoint: {exc}") from exc
    except OSError as exc:
        raise SystemExit(f"AAOP Journey checkpoint write failed: {exc}") from exc


@contextmanager
def checkpoint_lock(journey_id: str) -> Iterator[None]:
    """Serialize checkpoint mutation with a process-owned OS file lock.

    The lock file may remain on disk, but the kernel lock is released when the
    process exits, so a crashed writer does not leave the Journey permanently
    locked. The revision check inside the lock provides compare-and-swap
    semantics for callers that read state before deciding what to write.
    """
    path = lock_path(journey_id)
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


def gate_map(definition: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for gate in definition.get("gates", []):
        if isinstance(gate, dict) and isinstance(gate.get("id"), str):
            result[gate["id"]] = gate
    return result


def ensure_gate(definition: dict[str, Any], gate: str) -> None:
    gates = gate_map(definition)
    if gate not in gates:
        available = ", ".join(sorted(gates))
        raise SystemExit(f"Unknown Journey gate {gate!r}. Available: {available}")


def ensure_gate_route_compatible(definition: dict[str, Any], gate_id: str, route: str | None) -> None:
    gate = gate_map(definition).get(gate_id)
    if not gate:
        raise SystemExit(f"Unknown Journey gate {gate_id!r}")
    required_route = gate.get("primary_route")
    if isinstance(required_route, str):
        if route is None:
            raise SystemExit(f"Journey gate {gate_id!r} requires route {required_route!r}; no current route is set.")
        if route != required_route:
            raise SystemExit(
                f"Journey gate {gate_id!r} requires route {required_route!r}, but the proposed/current route is {route!r}. "
                "Reclassify from evidence instead of pairing an incompatible Gate and Route."
            )


def ensure_expected_revision(state: dict[str, Any], expected_revision: int) -> int:
    actual = current_revision(state)
    if actual != expected_revision:
        raise SystemExit(
            "Stale Journey checkpoint revision: "
            f"expected {expected_revision}, current {actual}. "
            "Re-read `journey.py status ... --json`, reconcile the newer evidence, and retry from that revision."
        )
    return actual


def append_unique(values: list[str], additions: list[str]) -> list[str]:
    result = list(values)
    seen = set(result)
    for value in additions:
        cleaned = value.strip()
        if cleaned and cleaned not in seen:
            result.append(cleaned)
            seen.add(cleaned)
    return result


def render_state(state: dict[str, Any], definition: dict[str, Any]) -> None:
    print(f"journey: {state['journey_id']}")
    print(f"revision: {current_revision(state)}")
    print(f"cycle: {state.get('cycle', 1)}")
    print(f"goal: {state['goal']}")
    print(f"status: {state['status']}")
    print(f"gate: {state['current_gate']}")
    print(f"route: {state.get('current_route') or '-'}")
    print(f"target verified: {'yes' if state.get('target_verified') else 'no'}")
    print(f"target evidence: {len(state.get('target_evidence', []))}")
    print(f"completed releases: {len(state.get('release_history', []))}")
    print(f"next: {state.get('next_action') or '-'}")
    print(f"updated: {state['updated_at']}")
    if state.get("journey_version") != definition.get("version"):
        print(
            "checkpoint: RECONCILE REQUIRED "
            f"(saved definition={state.get('journey_version')}, current={definition.get('version')})"
        )
    blockers = state.get("blockers", [])
    if blockers:
        print("blockers:")
        for blocker in blockers:
            print(f"  - {blocker}")


def command_show(journey_id: str, as_json: bool) -> int:
    definition = load_definition(journey_id)
    if as_json:
        print(json.dumps(definition, ensure_ascii=False, indent=2))
    else:
        print(f"journey: {definition['journey_id']}")
        print(f"version: {definition['version']}")
        print(f"objective: {definition['objective']}")
        print("gates:")
        for gate in definition.get("gates", []):
            selector = gate.get("primary_route") or gate.get("route_selection") or "-"
            print(f"  - {gate['id']}: {selector} — {gate['goal']}")
    return 0


def command_start(journey_id: str, goal: str, gate: str, route: str | None, reason: str) -> int:
    definition = load_definition(journey_id)
    ensure_gate(definition, gate)
    ensure_gate_route_compatible(definition, gate, route)
    with checkpoint_lock(journey_id):
        path = state_path(journey_id)
        if path.exists():
            raise SystemExit(
                f"Journey checkpoint already exists at {path}. Read status and reconcile it; do not overwrite continuity state."
            )
        timestamp = now_utc()
        history: list[dict[str, Any]] = []
        if route:
            history.append(
                {
                    "cycle": 1,
                    "from": None,
                    "to": route,
                    "reason": reason.strip() or "initial intake",
                    "at": timestamp,
                }
            )
        state: dict[str, Any] = {
            "schema_version": STATE_SCHEMA_VERSION,
            "journey_id": journey_id,
            "journey_version": definition["version"],
            "revision": 1,
            "cycle": 1,
            "goal": goal.strip(),
            "status": "active",
            "current_gate": gate,
            "current_route": route,
            "current_outcome": None,
            "next_action": None,
            "target_verified": False,
            "target_evidence": [],
            "evidence": [],
            "blockers": [],
            "route_history": history,
            "release_history": [],
            "completed_at": None,
            "last_checkpoint_reason": reason.strip() or "initial intake",
            "updated_at": timestamp,
        }
        if not state["goal"]:
            raise SystemExit("Journey goal must not be empty")
        save_state_unlocked(journey_id, state)
    render_state(state, definition)
    return 0


def command_status(journey_id: str, as_json: bool) -> int:
    definition = load_definition(journey_id)
    state = load_state(journey_id)
    if as_json:
        payload = dict(state)
        payload["revision"] = current_revision(state)
        payload["definition_version_current"] = definition.get("version")
        payload["checkpoint_needs_reconcile"] = state.get("journey_version") != definition.get("version")
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        render_state(state, definition)
    return 0


def command_recover(journey_id: str) -> int:
    definition = load_definition(journey_id)
    with checkpoint_lock(journey_id):
        try:
            state, archive = recover_checkpoint_unlocked(journey_id, state_path(journey_id))
        except FutureCheckpointSchema as exc:
            raise SystemExit(
                "AAOP Journey checkpoint/recovery snapshot requires a newer state reader: "
                f"{exc}. Recovery with an older tool is forbidden because it could downgrade "
                "unknown continuity semantics."
            ) from exc
        except CheckpointError as exc:
            raise SystemExit(f"AAOP Journey recovery refused: {exc}") from exc
        except OSError as exc:
            raise SystemExit(f"AAOP Journey recovery failed while preserving/restoring files: {exc}") from exc

    print("AAOP Journey checkpoint recovered explicitly from last-good snapshot")
    if archive is not None:
        print(f"damaged checkpoint preserved: {archive}")
    else:
        print("damaged checkpoint preserved: current file was missing")
    render_state(state, definition)
    print("next: reconcile this recovered continuity state against current project/runtime/target evidence before mutation")
    return 0


def start_next_cycle(args: argparse.Namespace, definition: dict[str, Any], state: dict[str, Any]) -> None:
    if state.get("status") != "complete":
        raise SystemExit("--start-next-cycle is valid only from a completed release cycle.")
    if not args.route or not args.gate:
        raise SystemExit("Starting the next release cycle requires both --route and --gate from current evidence.")
    if not args.reason.strip() or not args.evidence:
        raise SystemExit("Starting the next release cycle requires --reason and at least one --evidence item.")
    if args.target_evidence:
        raise SystemExit("A new release cycle cannot begin with inherited target verification evidence.")
    ensure_gate(definition, args.gate)
    ensure_gate_route_compatible(definition, args.gate, args.route)

    old_cycle = int(state.get("cycle", 1))
    completed_at = state.get("completed_at")
    if not isinstance(completed_at, str) or not completed_at:
        raise SystemExit("Completed Journey state is missing completed_at; reconcile before starting another release cycle.")

    archive = {
        "cycle": old_cycle,
        "completed_at": completed_at,
        "outcome": state.get("current_outcome"),
        "target_evidence": list(state.get("target_evidence", [])),
    }
    state.setdefault("release_history", []).append(archive)

    new_cycle = old_cycle + 1
    timestamp = now_utc()
    previous_route = state.get("current_route")
    state.setdefault("route_history", []).append(
        {
            "cycle": new_cycle,
            "from": previous_route,
            "to": args.route,
            "reason": args.reason.strip(),
            "at": timestamp,
        }
    )

    state["schema_version"] = STATE_SCHEMA_VERSION
    state["journey_version"] = definition["version"]
    state["cycle"] = new_cycle
    state["status"] = "active"
    state["current_gate"] = args.gate
    state["current_route"] = args.route
    state["current_outcome"] = args.outcome.strip() if args.outcome else None
    state["next_action"] = args.next_action.strip() if args.next_action else None
    state["target_verified"] = False
    state["target_evidence"] = []
    state["evidence"] = append_unique([], args.evidence)
    state["blockers"] = append_unique([], args.blocker)
    state["completed_at"] = None
    state["last_checkpoint_reason"] = args.reason.strip()
    state["updated_at"] = timestamp


def command_checkpoint(args: argparse.Namespace) -> int:
    definition = load_definition(args.journey_id)
    with checkpoint_lock(args.journey_id):
        state = load_state(args.journey_id)
        revision = ensure_expected_revision(state, args.expected_revision)

        if args.start_next_cycle:
            start_next_cycle(args, definition, state)
        else:
            if state.get("status") == "complete":
                raise SystemExit(
                    "The current release cycle is complete and immutable. Use --start-next-cycle with fresh evidence before new build/fix work."
                )

            version_changed = state.get("journey_version") != definition.get("version")
            if version_changed and (not args.reason.strip() or not args.evidence):
                raise SystemExit(
                    "Journey definition changed since this checkpoint. Reconciliation requires --reason and at least one --evidence item from the current project/runtime state."
                )

            intended_gate = args.gate or str(state.get("current_gate") or "")
            if args.gate:
                ensure_gate(definition, args.gate)
            previous_route = state.get("current_route")
            intended_route = args.route or previous_route
            ensure_gate_route_compatible(definition, intended_gate, intended_route)

            if args.route and args.route != previous_route:
                if previous_route is not None and not args.reason.strip():
                    raise SystemExit("Changing Journey route requires --reason with the evidence-backed reclassification.")
                if previous_route is not None and not args.evidence:
                    raise SystemExit("Changing Journey route requires at least one --evidence item; lack of progress alone is not a reroute signal.")
                timestamp = now_utc()
                state.setdefault("route_history", []).append(
                    {
                        "cycle": int(state.get("cycle", 1)),
                        "from": previous_route,
                        "to": args.route,
                        "reason": args.reason.strip() or "initial route selection",
                        "at": timestamp,
                    }
                )
                state["current_route"] = args.route

            if args.gate:
                state["current_gate"] = args.gate
            if args.outcome is not None:
                state["current_outcome"] = args.outcome.strip() or None
            if args.next_action is not None:
                state["next_action"] = args.next_action.strip() or None

            state["evidence"] = append_unique(list(state.get("evidence", [])), args.evidence)

            existing_blockers = list(state.get("blockers", []))
            if args.clear_blockers and existing_blockers:
                if not args.reason.strip() or not args.evidence:
                    raise SystemExit(
                        "Clearing Journey blockers requires --reason and at least one --evidence item proving the blocker changed or was resolved."
                    )
                state["blockers"] = []
            state["blockers"] = append_unique(list(state.get("blockers", [])), args.blocker)

            state["target_evidence"] = append_unique(list(state.get("target_evidence", [])), args.target_evidence)
            if args.target_evidence:
                state["target_verified"] = True

            requested_status = args.status or state.get("status", "active")
            if requested_status not in STATUSES:
                raise SystemExit(f"Invalid Journey status: {requested_status}")

            if requested_status == "blocked" and not state.get("blockers"):
                raise SystemExit("A blocked Journey checkpoint requires at least one blocker.")

            if requested_status == "complete":
                completion_policy = definition.get("completion_policy", {})
                if completion_policy.get("blocked_is_complete") is not False:
                    raise SystemExit("Journey definition does not prove that blocked state is non-complete.")
                if state.get("blockers"):
                    raise SystemExit("Journey cannot be complete while blockers remain; clear only blockers that current evidence proves resolved.")
                if completion_policy.get("target_verification_required") and not state.get("target_verified"):
                    raise SystemExit("Journey cannot be complete without direct target verification. Keep it active/blocked and record the exact unblock.")
                if completion_policy.get("target_verification_required") and not state.get("target_evidence"):
                    raise SystemExit("Journey completion requires explicit target-environment evidence, not only a completion flag.")
                if state.get("current_gate") != "deploy-observe":
                    raise SystemExit("Journey release completion is valid only at deploy-observe.")
                if state.get("current_route") != "release-operations":
                    raise SystemExit("Journey release completion requires the current route to be release-operations.")
                state["completed_at"] = now_utc()

            state["status"] = requested_status
            state["schema_version"] = STATE_SCHEMA_VERSION
            state["journey_version"] = definition["version"]
            state["last_checkpoint_reason"] = args.reason.strip() or state.get("last_checkpoint_reason")
            state["updated_at"] = now_utc()

        state["schema_version"] = STATE_SCHEMA_VERSION
        state["journey_version"] = definition["version"]
        state["revision"] = revision + 1
        state["updated_at"] = now_utc()
        save_state_unlocked(args.journey_id, state)

    render_state(state, definition)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect, checkpoint, and explicitly recover AAOP multi-route Journeys")
    sub = parser.add_subparsers(dest="command", required=True)

    show = sub.add_parser("show", help="Show one Journey definition")
    show.add_argument("journey_id")
    show.add_argument("--json", action="store_true")

    start = sub.add_parser("start", help="Create a resumable Journey checkpoint")
    start.add_argument("journey_id")
    start.add_argument("--goal", required=True)
    start.add_argument("--gate", default="intake")
    start.add_argument("--route", choices=sorted(ROUTES))
    start.add_argument("--reason", default="initial intake")

    status = sub.add_parser("status", help="Read the current Journey checkpoint")
    status.add_argument("journey_id")
    status.add_argument("--json", action="store_true")

    recover = sub.add_parser(
        "recover",
        help="Explicitly restore a damaged/missing checkpoint from the last-good recovery snapshot",
    )
    recover.add_argument("journey_id")

    checkpoint = sub.add_parser("checkpoint", help="Update continuity state after meaningful evidence")
    checkpoint.add_argument("journey_id")
    checkpoint.add_argument(
        "--expected-revision",
        type=int,
        required=True,
        help="CAS token from the most recent `journey.py status ... --json`; stale revisions are rejected",
    )
    checkpoint.add_argument("--gate")
    checkpoint.add_argument("--route", choices=sorted(ROUTES))
    checkpoint.add_argument("--status", choices=sorted(STATUSES))
    checkpoint.add_argument("--outcome")
    checkpoint.add_argument("--next-action")
    checkpoint.add_argument("--evidence", action="append", default=[])
    checkpoint.add_argument("--target-evidence", action="append", default=[])
    checkpoint.add_argument("--blocker", action="append", default=[])
    checkpoint.add_argument("--clear-blockers", action="store_true")
    checkpoint.add_argument("--start-next-cycle", action="store_true")
    checkpoint.add_argument("--reason", default="")

    args = parser.parse_args()
    if args.command == "show":
        return command_show(args.journey_id, args.json)
    if args.command == "start":
        return command_start(args.journey_id, args.goal, args.gate, args.route, args.reason)
    if args.command == "status":
        return command_status(args.journey_id, args.json)
    if args.command == "recover":
        return command_recover(args.journey_id)
    if args.command == "checkpoint":
        return command_checkpoint(args)
    parser.error(f"Unknown command {args.command!r}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
