#!/usr/bin/env python3
"""Check whether an installed AAOP stable-managed control plane matches current stable release identity.

This is diagnostic execution evidence, not package ownership authority. It never mutates
AAOP or the project. Exact/non-stable refs are preserved rather than silently upgraded.
Network failure remains ``unknown`` so unrelated local work can continue under scoped
evidence uncertainty.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

OWNER = "YuemingHub"
REPO = "Adaptive-Agent-Orchestration-Protocol"
STABLE_REF = "stable"
STABLE_VERSION_URL = (
    f"https://raw.githubusercontent.com/{OWNER}/{REPO}/{STABLE_REF}/.aaop/VERSION"
)
PROVENANCE_RELATIVE = Path("runtime") / "install-provenance.json"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$", re.IGNORECASE)
USER_AGENT = "AAOP-source-freshness/1"
DEFAULT_TIMEOUT_SECONDS = 5.0


def package_root() -> Path:
    return Path(__file__).resolve().parents[1]


def local_version(package: Path) -> str:
    path = package / "VERSION"
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise ValueError(f"cannot read local AAOP VERSION: {exc}") from exc
    if not value:
        raise ValueError("local AAOP VERSION is empty")
    return value


def load_provenance(package: Path) -> tuple[dict[str, Any] | None, str | None]:
    path = package / PROVENANCE_RELATIVE
    if not path.is_file():
        return None, "bootstrap provenance is missing"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        return None, f"bootstrap provenance is invalid JSON: {exc}"
    if not isinstance(payload, dict):
        return None, "bootstrap provenance is not an object"
    source = payload.get("source")
    if not isinstance(source, dict):
        return None, "bootstrap provenance source is missing/invalid"
    return payload, None


def fetch_stable_version(timeout: float = DEFAULT_TIMEOUT_SECONDS) -> str:
    request = urllib.request.Request(STABLE_VERSION_URL, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(256)
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(str(exc)) from exc
    value = raw.decode("utf-8", errors="strict").strip()
    if not value or len(value) > 64:
        raise RuntimeError("official stable VERSION response is empty or invalid")
    return value


def inspect(package: Path | None = None, *, timeout: float = DEFAULT_TIMEOUT_SECONDS) -> dict[str, Any]:
    package = (package or package_root()).resolve()
    report: dict[str, Any] = {
        "state": "unknown",
        "policy": "unknown",
        "local_version": None,
        "stable_version": None,
        "source": None,
        "checked_url": None,
        "next_action": "",
        "authority": "diagnostic-only; does not grant package/project mutation authority",
    }

    try:
        report["local_version"] = local_version(package)
    except ValueError as exc:
        report["state"] = "invalid-local"
        report["next_action"] = f"Review AAOP installation health before takeover: {exc}"
        return report

    provenance, error = load_provenance(package)
    if error or provenance is None:
        report["state"] = "unknown"
        report["next_action"] = (
            f"Source freshness cannot be established because {error or 'provenance is unavailable'}. "
            "Do not infer current stable compatibility from local health/version alone."
        )
        return report

    source = provenance.get("source")
    assert isinstance(source, dict)
    report["source"] = source
    kind = str(source.get("kind") or "")
    ref = str(source.get("ref") or "")

    if kind != "official-ref":
        report["state"] = "not-managed"
        report["policy"] = kind or "unknown"
        report["next_action"] = (
            "This installation is not stable-managed. Preserve its explicit source policy; "
            "do not silently replace it with stable."
        )
        return report

    if ref != STABLE_REF:
        report["state"] = "frozen" if SHA40_RE.fullmatch(ref) else "explicit-ref"
        report["policy"] = "exact-frozen" if SHA40_RE.fullmatch(ref) else "explicit-ref"
        report["next_action"] = (
            f"Installed AAOP is intentionally sourced from {ref!r}; preserve that ref unless a compatible "
            "upgrade is deliberately selected. Stable movement alone is not authorization to replace it."
        )
        return report

    report["policy"] = "stable-managed"
    report["checked_url"] = STABLE_VERSION_URL
    try:
        stable = fetch_stable_version(timeout)
    except RuntimeError as exc:
        report["state"] = "unknown"
        report["next_action"] = (
            "Could not resolve current stable release identity; keep freshness unknown and scope this "
            f"network/evidence limitation while continuing independent authorized work. Details: {exc}"
        )
        return report

    report["stable_version"] = stable
    if stable == report["local_version"]:
        report["state"] = "current"
        report["next_action"] = "Installed stable-managed AAOP release identity matches current official stable."
    else:
        report["state"] = "stale"
        report["next_action"] = (
            f"Installed stable-managed AAOP is {report['local_version']}; official stable is {stable}. "
            "Run the canonical state-preserving stable bootstrap, then re-run project compatibility evidence "
            "before trusting takeover/no-op/completion semantics."
        )
    return report


def render(report: dict[str, Any]) -> None:
    print("AAOP source freshness")
    print(f"  state: {report['state']}")
    print(f"  policy: {report['policy']}")
    print(f"  local version: {report.get('local_version') or '-'}")
    if report.get("stable_version"):
        print(f"  stable version: {report['stable_version']}")
    source = report.get("source")
    if isinstance(source, dict):
        label = str(source.get("kind") or "unknown")
        if source.get("ref"):
            label += f"@{source['ref']}"
        print(f"  source: {label}")
    print(f"  next: {report['next_action']}")
    print(f"  authority: {report['authority']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check installed AAOP source freshness against stable release identity")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args()

    report = inspect(timeout=max(0.1, args.timeout))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        render(report)

    if report["state"] in {"stale", "invalid-local"}:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
