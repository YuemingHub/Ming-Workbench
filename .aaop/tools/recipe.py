#!/usr/bin/env python3
"""Browse AAOP integration recipes without installing providers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def recipe_root() -> Path:
    return Path(__file__).resolve().parents[1] / "recipes"


def load_recipes() -> dict[str, dict[str, object]]:
    rows: dict[str, dict[str, object]] = {}
    for path in sorted(recipe_root().glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        recipe_id = payload.get("id")
        if isinstance(recipe_id, str):
            rows[recipe_id] = payload
    return rows


def print_list(recipes: dict[str, dict[str, object]]) -> None:
    print("AAOP integration recipes")
    for recipe_id, payload in recipes.items():
        provider = payload.get("provider_id", recipe_id)
        verified = payload.get("last_verified", "unknown")
        mode = "unknown"
        install = payload.get("install")
        if isinstance(install, dict):
            mode = str(install.get("mode", "unknown"))
        print(f"  {recipe_id:28} provider={provider} mode={mode} verified={verified}")
    print("\nRecipes are hints only. Selecting a recipe never installs the provider automatically.")


def print_show(payload: dict[str, object]) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description="Browse AAOP integration recipes")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list", help="List available recipes")
    show = sub.add_parser("show", help="Show one recipe as JSON")
    show.add_argument("recipe_id")
    args = parser.parse_args()

    recipes = load_recipes()
    if args.command == "list":
        print_list(recipes)
        return 0

    payload = recipes.get(args.recipe_id)
    if payload is None:
        available = ", ".join(recipes) or "none"
        raise SystemExit(f"Unknown recipe {args.recipe_id!r}. Available: {available}")
    print_show(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
