#!/usr/bin/env python3
"""Low-level validation and recovery storage for AAOP Journey checkpoints.

The Journey checkpoint is continuity evidence, not project truth. This module keeps
its persistence semantics narrow: known schema versions only, fail-closed reads for
future formats, atomic current-file replacement, a last-known-good recovery snapshot,
and explicit recovery that preserves the damaged current file before restoration.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CURRENT_STATE_SCHEMA_VERSION = "0.3.2"
LEGACY_STATE_SCHEMA_VERSION = "0.3.1"
KNOWN_STATE_SCHEMA_VERSIONS = {
    LEGACY_STATE_SCHEMA_VERSION,
    CURRENT_STATE_SCHEMA_VERSION,
}
SCHEMA_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
STATUSES = {"active", "blocked", "complete"}
ROUTES = {
    "idea-to-build",
    "repo-recovery",
    "bug-fix",
    "feature-change",
    "understand-review",
    "release-operations",
}


class CheckpointError(Exception):
    """Base class for checkpoint persistence/validation errors."""


class FutureCheckpointSchema(CheckpointError):
    """Raised when the checkpoint requires a newer AAOP state reader."""


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def schema_tuple(value: object) -> tuple[int, int, int]:
    if not isinstance(value, str) or not SCHEMA_RE.fullmatch(value):
        raise CheckpointError(f"checkpoint has invalid schema_version: {value!r}")
    major, minor, patch = value.split(".")
    return int(major), int(minor), int(patch)


def schema_version(payload: dict[str, Any]) -> str:
    value = payload.get("schema_version")
    current = schema_tuple(CURRENT_STATE_SCHEMA_VERSION)
    parsed = schema_tuple(value)
    if parsed > current:
        raise FutureCheckpointSchema(
            "checkpoint schema is newer than this AAOP tool understands "
            f"({value} > {CURRENT_STATE_SCHEMA_VERSION})"
        )
    if value not in KNOWN_STATE_SCHEMA_VERSIONS:
        raise CheckpointError(
            "checkpoint schema is not a known compatible AAOP state format: "
            f"{value!r}; supported={', '.join(sorted(KNOWN_STATE_SCHEMA_VERSIONS))}"
        )
    return str(value)


def checkpoint_revision(payload: dict[str, Any]) -> int:
    version = schema_version(payload)
    if version == LEGACY_STATE_SCHEMA_VERSION and "revision" not in payload:
        return 0
    value = payload.get("revision")
    minimum = 1 if version == CURRENT_STATE_SCHEMA_VERSION else 0
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise CheckpointError(
            f"checkpoint has invalid revision for schema {version}: {value!r}"
        )
    return value


def _string_list(payload: dict[str, Any], field: str) -> list[str]:
    value = payload.get(field)
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise CheckpointError(f"checkpoint field {field!r} must be a list of strings")
    return value


def validate_checkpoint(journey_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    version = schema_version(payload)
    if payload.get("journey_id") != journey_id:
        raise CheckpointError(
            f"checkpoint journey_id mismatch: expected {journey_id!r}, got {payload.get('journey_id')!r}"
        )
    if not isinstance(payload.get("journey_version"), str) or not payload["journey_version"].strip():
        raise CheckpointError("checkpoint journey_version must be a non-empty string")
    checkpoint_revision(payload)

    cycle = payload.get("cycle")
    if not isinstance(cycle, int) or isinstance(cycle, bool) or cycle < 1:
        raise CheckpointError(f"checkpoint cycle must be a positive integer: {cycle!r}")
    if not isinstance(payload.get("goal"), str) or not payload["goal"].strip():
        raise CheckpointError("checkpoint goal must be a non-empty string")

    status = payload.get("status")
    if status not in STATUSES:
        raise CheckpointError(f"checkpoint has invalid status: {status!r}")
    gate = payload.get("current_gate")
    if not isinstance(gate, str) or not gate.strip():
        raise CheckpointError("checkpoint current_gate must be a non-empty string")
    route = payload.get("current_route")
    if route is not None and route not in ROUTES:
        raise CheckpointError(f"checkpoint has invalid current_route: {route!r}")

    target_verified = payload.get("target_verified")
    if not isinstance(target_verified, bool):
        raise CheckpointError("checkpoint target_verified must be boolean")
    target_evidence = _string_list(payload, "target_evidence")
    _string_list(payload, "evidence")
    blockers = _string_list(payload, "blockers")

    route_history = payload.get("route_history")
    release_history = payload.get("release_history")
    if not isinstance(route_history, list) or any(not isinstance(item, dict) for item in route_history):
        raise CheckpointError("checkpoint route_history must be a list of objects")
    if not isinstance(release_history, list) or any(not isinstance(item, dict) for item in release_history):
        raise CheckpointError("checkpoint release_history must be a list of objects")

    completed_at = payload.get("completed_at")
    if completed_at is not None and (not isinstance(completed_at, str) or not completed_at.strip()):
        raise CheckpointError("checkpoint completed_at must be null or a non-empty string")
    if not isinstance(payload.get("updated_at"), str) or not payload["updated_at"].strip():
        raise CheckpointError("checkpoint updated_at must be a non-empty string")

    if status == "blocked" and not blockers:
        raise CheckpointError("blocked checkpoint must preserve at least one blocker")
    if status == "complete":
        if blockers:
            raise CheckpointError("complete checkpoint cannot retain blockers")
        if not target_verified or not target_evidence:
            raise CheckpointError("complete checkpoint must preserve direct target verification evidence")
        if not completed_at:
            raise CheckpointError("complete checkpoint must preserve completed_at")

    if version == LEGACY_STATE_SCHEMA_VERSION and "revision" in payload:
        # Legacy format may carry revision 0 during explicit migration tests, but a
        # positive revision does not make it the current schema automatically.
        checkpoint_revision(payload)
    return payload


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise CheckpointError(f"checkpoint file not found: {path}") from exc
    except Exception as exc:  # noqa: BLE001
        raise CheckpointError(f"checkpoint file is invalid JSON: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise CheckpointError(f"checkpoint JSON must be an object: {path}")
    return payload


def recovery_snapshot_path(state_path: Path) -> Path:
    return state_path.parent / ".recovery" / f"{state_path.stem}.last-good.json"


def corrupt_archive_root(state_path: Path) -> Path:
    return state_path.parent / ".recovery" / state_path.stem / "corrupt"


def load_checkpoint(journey_id: str, state_path: Path) -> dict[str, Any]:
    try:
        payload = _read_json_object(state_path)
        return validate_checkpoint(journey_id, payload)
    except FutureCheckpointSchema:
        raise
    except CheckpointError as exc:
        recovery = recovery_snapshot_path(state_path)
        hint = (
            f" A last-good recovery snapshot exists at {recovery}; use `journey.py recover {journey_id}` "
            "from a trusted matching/newer AAOP tool instead of restarting or overwriting continuity state."
            if recovery.is_file()
            else " No last-good recovery snapshot is available; preserve the damaged file and reconcile manually instead of restarting the Journey."
        )
        raise CheckpointError(f"{exc}.{hint}") from exc


def _write_fsynced(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        _write_fsynced(temporary, content)
        temporary.replace(path)
    finally:
        try:
            if temporary.exists():
                temporary.unlink()
        except OSError:
            pass


def save_checkpoint_unlocked(journey_id: str, state_path: Path, payload: dict[str, Any]) -> None:
    validate_checkpoint(journey_id, payload)
    _atomic_write_json(state_path, payload)

    # Recovery storage is secondary to the committed checkpoint. Failure to refresh
    # it must never roll back a valid CAS write or encourage a blind retry against a
    # stale revision, so surface a warning while leaving the committed state intact.
    recovery = recovery_snapshot_path(state_path)
    try:
        _atomic_write_json(recovery, payload)
    except OSError as exc:
        print(
            "AAOP Journey warning: checkpoint committed, but last-good recovery snapshot "
            f"could not be refreshed at {recovery}: {exc}",
            file=sys.stderr,
        )


def _archive_damaged_current(state_path: Path) -> Path | None:
    if not state_path.exists():
        return None
    root = corrupt_archive_root(state_path)
    root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    archive = root / f"{state_path.stem}-{stamp}.json"
    archive.write_bytes(state_path.read_bytes())
    return archive


def recover_checkpoint_unlocked(journey_id: str, state_path: Path) -> tuple[dict[str, Any], Path | None]:
    current_error: CheckpointError | None = None
    if state_path.exists():
        try:
            current = _read_json_object(state_path)
            # A future schema is not "corruption" that an old tool may replace.
            validate_checkpoint(journey_id, current)
        except FutureCheckpointSchema:
            raise
        except CheckpointError as exc:
            current_error = exc
        else:
            raise CheckpointError(
                "current Journey checkpoint is valid; recovery is not a substitute for normal reconciliation/CAS mutation"
            )

    recovery = recovery_snapshot_path(state_path)
    snapshot = validate_checkpoint(journey_id, _read_json_object(recovery))
    recovered = dict(snapshot)
    recovered["schema_version"] = CURRENT_STATE_SCHEMA_VERSION
    recovered["revision"] = checkpoint_revision(snapshot) + 1
    recovered["updated_at"] = now_utc()
    recovered["last_checkpoint_reason"] = "explicit recovery from last-good checkpoint after current checkpoint corruption/loss"

    archive = _archive_damaged_current(state_path)
    save_checkpoint_unlocked(journey_id, state_path, recovered)
    return recovered, archive
