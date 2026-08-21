#!/usr/bin/env python3
"""Browse AAOP Route Capability Packs without external dependencies."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def route_root() -> Path:
    return Path(__file__).resolve().parents[1] / "routes"


def load(route_id: str) -> dict:
    path = route_root() / f"{route_id}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in route_root().glob("*.json")))
        raise SystemExit(f"Unknown route {route_id!r}. Available: {available}")
    return json.loads(path.read_text(encoding="utf-8"))


def print_summary(payload: dict) -> None:
    print(f"route: {payload['route_id']}")
    print(f"objective: {payload['objective']}")
    print("stages:")
    for stage in payload.get("stages", []):
        capabilities = ", ".join(stage.get("required_capabilities", []))
        print(f"  - {stage['id']}: {stage['purpose']}")
        print(f"    required: {capabilities or '-'}")
    escalations = payload.get("escalations", [])
    print("escalations:")
    if not escalations:
        print("  - none")
    for item in escalations:
        providers = ", ".join(item.get("provider_candidates", []))
        print(f"  - when: {item['when']}")
        print(f"    gap: {item['capability_gap']}")
        print(f"    candidates: {providers or '-'}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Browse installed AAOP route capability packs")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="List route capability packs")
    show = sub.add_parser("show", help="Show one route capability pack")
    show.add_argument("route_id")
    show.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.command == "list":
        for path in sorted(route_root().glob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            print(f"{payload['route_id']}: {payload['objective']}")
        return 0

    payload = load(args.route_id)
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_summary(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
