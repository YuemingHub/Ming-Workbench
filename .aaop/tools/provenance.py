#!/usr/bin/env python3
"""Record and verify non-authoritative AAOP installation provenance.

Ownership and deletion authority remain exclusively in ``.install-manifest.json``.
This tool stores diagnostic evidence under ``.aaop/runtime`` so source labels can
never expand AAOP's managed-file authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MANIFEST_NAME = ".install-manifest.json"
PROVENANCE_SCHEMA_VERSION = 1
PROVENANCE_RELATIVE = Path("runtime") / "install-provenance.json"
SHA256_HEX_LENGTH = 64
SOURCE_KINDS = {"official-ref", "local-archive", "source-tree"}


def package_root() -> Path:
    return Path(__file__).resolve().parents[1]


def provenance_path(package: Path | None = None) -> Path:
    return (package or package_root()) / PROVENANCE_RELATIVE


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def safe_relative(value: object) -> str:
    raw = str(value)
    normalized = raw.replace("\\", "/")
    parts = normalized.split("/")
    has_drive = bool(parts and len(parts[0]) == 2 and parts[0][1] == ":")
    if (
        not normalized
        or normalized.startswith("/")
        or normalized.startswith("//")
        or has_drive
        or any(part in {"", ".", ".."} for part in parts)
        or parts[0] == "runtime"
        or normalized == MANIFEST_NAME
    ):
        raise ValueError(f"unsafe managed path in install manifest: {raw!r}")
    return "/".join(parts)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(package: Path) -> dict[str, Any]:
    path = package / MANIFEST_NAME
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"install manifest is missing: {path}") from exc
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"install manifest is invalid JSON: {path}: {exc}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("files"), dict):
        raise ValueError("install manifest must contain a files object")
    schema = payload.get("schema_version")
    if not isinstance(schema, int) or schema < 1:
        raise ValueError("install manifest schema_version must be a positive integer")
    return payload


def actual_managed_hashes(package: Path, manifest: dict[str, Any]) -> dict[str, str]:
    raw_files = manifest.get("files", {})
    assert isinstance(raw_files, dict)
    result: dict[str, str] = {}
    for raw_relative in sorted(raw_files):
        relative = safe_relative(raw_relative)
        path = package / relative
        if not path.is_file():
            raise ValueError(f"managed file is missing or not a regular file: {relative}")
        result[relative] = sha256_file(path)
    return result


def package_fingerprint(hashes: dict[str, str]) -> str:
    digest = hashlib.sha256()
    for relative in sorted(hashes):
        value = hashes[relative]
        if len(value) != SHA256_HEX_LENGTH or any(ch not in "0123456789abcdef" for ch in value):
            raise ValueError(f"invalid managed SHA-256 for fingerprint: {relative}")
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(value.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def package_version(package: Path) -> str:
    path = package / "VERSION"
    value = path.read_text(encoding="utf-8").strip()
    if not value:
        raise ValueError(f"AAOP VERSION is empty: {path}")
    return value


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    content = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        try:
            if temporary.exists():
                temporary.unlink()
        except OSError:
            pass


def record(package: Path, *, source_kind: str, source_ref: str | None) -> dict[str, Any]:
    if source_kind not in SOURCE_KINDS:
        raise ValueError(f"unsupported provenance source kind: {source_kind!r}")
    if source_kind == "official-ref" and not source_ref:
        raise ValueError("official-ref provenance requires a non-empty source ref")
    if source_kind != "official-ref":
        source_ref = None

    manifest = load_manifest(package)
    hashes = actual_managed_hashes(package, manifest)
    payload: dict[str, Any] = {
        "schema_version": PROVENANCE_SCHEMA_VERSION,
        "aaop_version": package_version(package),
        "source": {
            "kind": source_kind,
            "ref": source_ref,
        },
        "manifest_schema_version": manifest.get("schema_version"),
        "managed_file_count": len(hashes),
        "package_fingerprint": package_fingerprint(hashes),
        "recorded_at": now_utc(),
        "authority": "diagnostic-only; does not grant managed-file ownership or mutation authority",
    }
    atomic_write_json(provenance_path(package), payload)
    return payload


def load_record(package: Path) -> tuple[dict[str, Any] | None, str | None]:
    path = provenance_path(package)
    if not path.exists():
        return None, None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return None, f"invalid JSON: {exc}"
    if not isinstance(payload, dict):
        return None, "provenance must be a JSON object"
    if payload.get("schema_version") != PROVENANCE_SCHEMA_VERSION:
        return None, f"unsupported provenance schema: {payload.get('schema_version')!r}"
    source = payload.get("source")
    if not isinstance(source, dict) or source.get("kind") not in SOURCE_KINDS:
        return None, "invalid provenance source"
    fingerprint = payload.get("package_fingerprint")
    if not isinstance(fingerprint, str) or len(fingerprint) != SHA256_HEX_LENGTH:
        return None, "invalid package_fingerprint"
    return payload, None


def inspect(package: Path | None = None) -> dict[str, Any]:
    package = (package or package_root()).resolve()
    record_payload, record_error = load_record(package)
    report: dict[str, Any] = {
        "state": "unknown",
        "package_root": str(package),
        "provenance_path": str(provenance_path(package)),
        "source": None,
        "recorded_fingerprint": None,
        "current_fingerprint": None,
        "aaop_version": None,
        "manifest_schema_version": None,
        "next_action": "",
        "authority": "diagnostic-only; does not grant managed-file ownership or mutation authority",
    }
    if record_error:
        report["state"] = "invalid"
        report["error"] = record_error
        report["next_action"] = "Do not infer source identity from this record. Re-run a trusted bootstrap install/upgrade to refresh provenance."
        return report
    if record_payload is None:
        report["state"] = "missing"
        report["next_action"] = "No bootstrap provenance is recorded. This may be a direct/legacy install; use a trusted bootstrap upgrade when source traceability is required."
        return report

    report["source"] = record_payload.get("source")
    report["recorded_fingerprint"] = record_payload.get("package_fingerprint")
    report["aaop_version"] = record_payload.get("aaop_version")
    report["manifest_schema_version"] = record_payload.get("manifest_schema_version")

    try:
        manifest = load_manifest(package)
        hashes = actual_managed_hashes(package, manifest)
        current = package_fingerprint(hashes)
    except (OSError, ValueError) as exc:
        report["state"] = "unverifiable"
        report["error"] = str(exc)
        report["next_action"] = "Review installation health first; provenance cannot verify a missing/invalid managed-file surface."
        return report

    report["current_fingerprint"] = current
    if current == report["recorded_fingerprint"]:
        report["state"] = "verified"
        report["next_action"] = "Recorded source provenance matches the current managed AAOP bytes."
    else:
        report["state"] = "mismatch"
        report["next_action"] = "Current managed AAOP bytes no longer match the recorded install source. Review health/drift before relying on source identity."
    return report


def render(report: dict[str, Any]) -> None:
    print("AAOP install provenance")
    print(f"  state: {report['state']}")
    source = report.get("source")
    if isinstance(source, dict):
        label = source.get("kind") or "unknown"
        if source.get("ref"):
            label += f"@{source['ref']}"
        print(f"  source: {label}")
    if report.get("aaop_version"):
        print(f"  version: {report['aaop_version']}")
    if report.get("recorded_fingerprint"):
        print(f"  recorded fingerprint: {report['recorded_fingerprint']}")
    if report.get("current_fingerprint"):
        print(f"  current fingerprint: {report['current_fingerprint']}")
    print(f"  next: {report['next_action']}")
    print(f"  authority: {report['authority']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Record or verify non-authoritative AAOP install provenance")
    sub = parser.add_subparsers(dest="command")

    record_parser = sub.add_parser("record", help="Record provenance after a successful trusted lifecycle operation")
    record_parser.add_argument("--source-kind", choices=sorted(SOURCE_KINDS), required=True)
    record_parser.add_argument("--source-ref")

    show_parser = sub.add_parser("show", help="Show and verify recorded provenance")
    show_parser.add_argument("--json", action="store_true")

    args = parser.parse_args()
    command = args.command or "show"
    package = package_root()

    if command == "record":
        try:
            payload = record(package, source_kind=args.source_kind, source_ref=args.source_ref)
        except (OSError, ValueError) as exc:
            raise SystemExit(f"AAOP provenance record failed: {exc}") from exc
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    if command == "show":
        report = inspect(package)
        if getattr(args, "json", False):
            print(json.dumps(report, ensure_ascii=False, indent=2))
        else:
            render(report)
        return 0 if report["state"] == "verified" else 2

    parser.error(f"unknown command {command!r}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
