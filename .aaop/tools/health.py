#!/usr/bin/env python3
"""Inspect AAOP installation health without modifying the project.

This is a best-effort drift detector for accidental/local modification. It is not
an adversarial tamper-proof trust root. The installer manifest records the files
AAOP owned at install/upgrade time; this tool compares the current installation
against that baseline and checks the AAOP bootstrap marker blocks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

AAOP_BEGIN = "<!-- AAOP:BEGIN -->"
AAOP_END = "<!-- AAOP:END -->"
MANIFEST_NAME = ".install-manifest.json"
TRANSACTION_DIR_NAME = ".aaop-install-transaction"
SUPPORTED_MANIFEST_SCHEMA = 2
BOOTSTRAP_FILES = ("AGENTS.md", "CLAUDE.md")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None


def package_root() -> Path:
    return Path(__file__).resolve().parents[1]


def project_root() -> Path:
    return package_root().parent


def package_version(package: Path) -> str | None:
    text = read_text(package / "VERSION")
    return text.strip() if text and text.strip() else None


def is_source_tree(package: Path) -> bool:
    root = package.parent
    return (root / "scripts" / "install.py").is_file() and (root / "README.md").is_file()


def validate_managed_relative(relative: object) -> str:
    raw = str(relative)
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
        raise ValueError(f"unsafe managed path: {raw!r}")
    return "/".join(parts)


def read_manifest(package: Path) -> tuple[dict[str, Any] | None, str | None]:
    path = package / MANIFEST_NAME
    if not path.exists():
        return None, None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return None, f"invalid JSON: {exc}"
    if not isinstance(payload, dict):
        return None, "manifest must be a JSON object"
    if not isinstance(payload.get("files"), dict):
        return None, "manifest.files must be an object"

    schema = payload.get("schema_version")
    if isinstance(schema, int) and 1 <= schema <= SUPPORTED_MANIFEST_SCHEMA:
        normalized: dict[str, str] = {}
        try:
            for raw_relative, raw_hash in payload["files"].items():
                relative = validate_managed_relative(raw_relative)
                if relative in normalized:
                    return None, f"duplicate normalized managed path: {relative}"
                digest = str(raw_hash)
                if not SHA256_RE.fullmatch(digest):
                    return None, f"invalid SHA-256 digest for managed path: {raw_relative!r}"
                normalized[relative] = digest
        except ValueError as exc:
            return None, str(exc)
        payload["files"] = normalized

        bootstrap = payload.get("bootstrap_blocks")
        if bootstrap is not None:
            if not isinstance(bootstrap, dict):
                return None, "manifest.bootstrap_blocks must be an object"
            for name, raw_hash in bootstrap.items():
                if str(name) not in BOOTSTRAP_FILES:
                    return None, f"unsupported bootstrap ownership key: {name!r}"
                if not SHA256_RE.fullmatch(str(raw_hash)):
                    return None, f"invalid bootstrap SHA-256 digest for {name!r}"
    return payload, None


def marker_status(path: Path, expected_hash: str | None) -> dict[str, Any]:
    if not path.exists():
        return {"status": "missing-file", "tracked": expected_hash is not None}

    text = read_text(path)
    if text is None:
        return {"status": "unreadable", "tracked": expected_hash is not None}

    begin_count = text.count(AAOP_BEGIN)
    end_count = text.count(AAOP_END)
    if begin_count == 0 and end_count == 0:
        return {"status": "missing-aaop-block", "tracked": expected_hash is not None}
    if begin_count != 1 or end_count != 1:
        return {
            "status": "malformed-markers",
            "tracked": expected_hash is not None,
            "begin_count": begin_count,
            "end_count": end_count,
        }

    start = text.index(AAOP_BEGIN)
    end = text.index(AAOP_END, start)
    if end <= start:
        return {"status": "malformed-markers", "tracked": expected_hash is not None}
    end += len(AAOP_END)
    block = text[start:end]
    current_hash = sha256_text(block)

    if expected_hash is None:
        return {
            "status": "present-untracked",
            "tracked": False,
            "current_hash": current_hash,
        }

    return {
        "status": "current" if current_hash == expected_hash else "modified",
        "tracked": True,
        "expected_hash": expected_hash,
        "current_hash": current_hash,
    }


def interrupted_transaction_state(root: Path) -> tuple[bool, str | None]:
    transaction = root / TRANSACTION_DIR_NAME
    if not transaction.exists():
        return False, None
    state = None
    metadata = transaction / "transaction.json"
    try:
        payload = json.loads(metadata.read_text(encoding="utf-8"))
        if isinstance(payload, dict) and isinstance(payload.get("state"), str):
            state = payload["state"]
    except Exception:
        state = "unreadable"
    return True, state


def inspect_installation(root: Path | None = None) -> dict[str, Any]:
    package = package_root()
    root = (root or project_root()).expanduser().resolve()
    version = package_version(package)
    manifest_path = package / MANIFEST_NAME
    manifest, manifest_error = read_manifest(package)

    report: dict[str, Any] = {
        "project_root": str(root),
        "package_root": str(package),
        "package_version": version,
        "manifest_present": manifest_path.exists(),
        "manifest_schema_version": None,
        "manifest_version": None,
        "state": "unknown",
        "managed_files": {
            "expected": 0,
            "current": 0,
            "modified": [],
            "missing": [],
            "unreadable": [],
        },
        "bootstrap": {},
        "runtime_present": (package / "runtime").exists(),
        "trust_boundary": "Best-effort accidental-drift detection only; not an adversarial tamper-proof trust root.",
        "next_action": "",
    }

    interrupted, transaction_state = interrupted_transaction_state(root)
    if interrupted:
        report["state"] = "interrupted-install"
        report["transaction_state"] = transaction_state
        report["transaction_path"] = str(root / TRANSACTION_DIR_NAME)
        report["next_action"] = (
            "Do not continue normal work or overwrite the package. Use a trusted matching/newer AAOP "
            "bootstrap/installer with --recover-interrupted, then run health/ready again before retrying."
        )
        return report

    if manifest_error:
        report["state"] = "invalid-manifest"
        report["manifest_error"] = manifest_error
        report["next_action"] = "Do not silently overwrite. Review the manifest, then use a trusted matching/newer AAOP source only if repair is intended."
        return report

    if manifest is None:
        for name in BOOTSTRAP_FILES:
            report["bootstrap"][name] = marker_status(root / name, None)
        if is_source_tree(package):
            if version is None:
                report["state"] = "incomplete"
                report["problems"] = [
                    "authoritative package release identity .aaop/VERSION is missing, empty, or unreadable"
                ]
                report["next_action"] = "Restore .aaop/VERSION from a trusted source before validating or installing this AAOP source package. Do not infer the package release from component documents."
            else:
                report["state"] = "source-tree"
                report["next_action"] = "This is the AAOP source tree, not a manifest-tracked installation. Validate the repository before publishing or installing it."
        else:
            report["state"] = "legacy-install"
            report["next_action"] = "Upgrade from a trusted AAOP source to establish a managed-file and bootstrap integrity baseline while preserving runtime/project-owned files."
        return report

    schema_version = manifest.get("schema_version")
    report["manifest_schema_version"] = schema_version
    report["manifest_version"] = manifest.get("aaop_version")

    if not isinstance(schema_version, int) or schema_version < 1:
        report["state"] = "invalid-manifest"
        report["manifest_error"] = "manifest.schema_version must be a positive integer"
        report["next_action"] = "Review the manifest before repair; do not silently replace project state."
        return report

    if schema_version > SUPPORTED_MANIFEST_SCHEMA:
        report["state"] = "unsupported-manifest"
        report["next_action"] = "The installed manifest is newer than this health tool understands. Use a matching/newer trusted AAOP health/installer before drawing conclusions or mutating ownership state."
        return report

    raw_files = manifest.get("files", {})
    files = {str(key): str(value) for key, value in raw_files.items()}
    report["managed_files"]["expected"] = len(files)

    for relative, expected_hash in sorted(files.items()):
        path = package / relative
        if not path.exists():
            report["managed_files"]["missing"].append(relative)
            continue
        if not path.is_file():
            report["managed_files"]["unreadable"].append(relative)
            continue
        try:
            current_hash = sha256_file(path)
        except OSError:
            report["managed_files"]["unreadable"].append(relative)
            continue
        if current_hash == expected_hash:
            report["managed_files"]["current"] += 1
        else:
            report["managed_files"]["modified"].append(relative)

    bootstrap_hashes = manifest.get("bootstrap_blocks")
    if not isinstance(bootstrap_hashes, dict):
        bootstrap_hashes = {}
    for name in BOOTSTRAP_FILES:
        expected = bootstrap_hashes.get(name)
        expected_hash = expected if isinstance(expected, str) and expected else None
        report["bootstrap"][name] = marker_status(root / name, expected_hash)

    missing = report["managed_files"]["missing"]
    unreadable = report["managed_files"]["unreadable"]
    modified = report["managed_files"]["modified"]
    bootstrap_states = {item.get("status") for item in report["bootstrap"].values() if isinstance(item, dict)}
    version_mismatch = bool(version and report["manifest_version"] and version != report["manifest_version"])
    report["version_mismatch"] = version_mismatch

    bootstrap_failure = bool(
        bootstrap_states
        & {"modified", "missing-file", "missing-aaop-block", "malformed-markers", "unreadable"}
    )
    old_integrity_baseline = schema_version < SUPPORTED_MANIFEST_SCHEMA or "present-untracked" in bootstrap_states

    if missing or unreadable:
        state = "incomplete"
        next_action = "AAOP-managed files are missing/unreadable. Review drift and repair from a trusted AAOP source with --upgrade; local managed-file edits will be backed up."
    elif modified or bootstrap_failure:
        state = "drifted"
        next_action = "AAOP differs from its installed baseline. Review the listed drift; use a trusted AAOP source with --upgrade only when canonical repair is intended."
    elif old_integrity_baseline:
        state = "upgrade-recommended"
        next_action = "The package is readable but the integrity baseline is older/incomplete. A safe --upgrade will preserve runtime/project-owned files and refresh tracking."
    elif version_mismatch:
        state = "drifted"
        next_action = "AAOP package VERSION and manifest version disagree under the current integrity schema. Review the installation before relying on it or repairing from a trusted source."
    else:
        state = "healthy"
        next_action = "AAOP-managed files and bootstrap blocks match the installed baseline. Continue with normal developer intake; this does not prove the package is the latest upstream release."

    report["state"] = state
    report["next_action"] = next_action
    return report


def render(report: dict[str, Any]) -> None:
    print("AAOP installation health")
    print(f"  project: {report['project_root']}")
    print(f"  package version: {report.get('package_version') or 'unknown'}")
    print(f"  state: {report['state']}")
    if report.get("transaction_path"):
        print(f"  transaction: {report.get('transaction_state') or 'unknown'} at {report['transaction_path']}")
    if report.get("manifest_present"):
        print(f"  manifest: schema={report.get('manifest_schema_version')} version={report.get('manifest_version')}")

    managed = report.get("managed_files", {})
    if isinstance(managed, dict) and managed.get("expected"):
        print(f"  managed files: expected={managed.get('expected')} current={managed.get('current')} modified={len(managed.get('modified', []))} missing={len(managed.get('missing', []))}")
        for key in ("modified", "missing", "unreadable"):
            for item in managed.get(key, []):
                print(f"    {key}: {item}")

    bootstrap = report.get("bootstrap", {})
    if isinstance(bootstrap, dict):
        for name, item in bootstrap.items():
            if isinstance(item, dict):
                print(f"  {name}: {item.get('status')}")

    for problem in report.get("problems", []):
        print(f"  problem: {problem}")
    print(f"  next: {report['next_action']}")
    print(f"  trust: {report['trust_boundary']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Inspect AAOP installation integrity and bootstrap drift")
    parser.add_argument("root", nargs="?", type=Path, default=Path.cwd(), help="AAOP-enabled project root")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    report = inspect_installation(args.root)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        render(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
