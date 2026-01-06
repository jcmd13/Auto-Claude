"""
Codex Execpolicy Rule Generation
================================

Codex CLI supports execpolicy rules in `~/.codex/rules/*.rules` that can
auto-allow or require confirmation ("prompt") for specific command prefixes.

Auto-Claude already computes a dynamic allowlist via the project analyzer.
This module provides helpers to convert that allowlist into a Codex
execpolicy rules file.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from project_analyzer import SecurityProfile


@dataclass(frozen=True)
class CodexExecpolicyConfig:
    """
    Configuration for execpolicy generation.
    """

    rules_filename: str = "auto-claude.rules"
    project_name: str = "Auto-Claude"


# Decisions supported by Codex execpolicy prefix_rule() today.
_DECISION_ALLOW = "allow"
_DECISION_PROMPT = "prompt"


# Commands that are allowed in Auto-Claude's profile, but should always require
# explicit approval when executed via Codex.
_ALWAYS_PROMPT_COMMANDS: set[str] = {
    # Destructive file ops / permission changes
    "rm",
    "chmod",
    "chown",
    # Process control
    "kill",
    "pkill",
    "killall",
    # Remote / external network
    "curl",
    "wget",
    "ssh",
    "scp",
    "rsync",
    # GitHub CLI can mutate remote state
    "gh",
    # Elevated privileges (if present)
    "sudo",
}


# Command prefixes that should prompt even when the base command is allowed.
# Note: execpolicy "prompt" wins over "allow" when multiple rules match.
_PROMPT_PREFIXES: list[list[str]] = [
    # Avoid mutating remote repos without explicit approval.
    ["git", "push"],
    ["git", "remote"],
    ["git", "config"],
    # Avoid destructive local git operations.
    ["git", "reset"],
    ["git", "clean"],
]


def _codex_home() -> Path:
    """
    Resolve CODEX_HOME (defaults to ~/.codex).
    """

    raw = (os.environ.get("CODEX_HOME") or "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".codex"


def default_rules_path(config: CodexExecpolicyConfig | None = None) -> Path:
    """
    Default location for Auto-Claude's Codex rules file.
    """

    cfg = config or CodexExecpolicyConfig()
    return _codex_home() / "rules" / cfg.rules_filename


def generate_rules_text(
    profile: SecurityProfile,
    *,
    project_dir: Path | None = None,
    config: CodexExecpolicyConfig | None = None,
) -> str:
    """
    Generate a Codex execpolicy rules file from a SecurityProfile.

    The rules file is intentionally conservative: known-risk commands always
    "prompt"; other commands in the dynamic allowlist are "allow".
    """

    cfg = config or CodexExecpolicyConfig()
    allowed_commands = set(profile.get_all_allowed_commands())

    allow_commands = sorted(
        cmd
        for cmd in allowed_commands
        if cmd
        and cmd not in _ALWAYS_PROMPT_COMMANDS
        and not any(ch.isspace() for ch in cmd)
    )
    prompt_commands = sorted(
        cmd
        for cmd in allowed_commands
        if cmd in _ALWAYS_PROMPT_COMMANDS
        and cmd
        and not any(ch.isspace() for ch in cmd)
    )

    lines: list[str] = []
    lines.append(f"# {cfg.project_name} Codex execpolicy rules (auto-generated)")
    if project_dir is not None:
        lines.append(f"# Project: {project_dir.resolve()}")
    lines.append(f"# Generated: {datetime.now(timezone.utc).isoformat()}")
    lines.append("#")

    # Allow rules for commands in the Auto-Claude allowlist.
    for cmd in allow_commands:
        lines.append(
            f"prefix_rule(pattern=[{json.dumps(cmd)}], decision={json.dumps(_DECISION_ALLOW)})"
        )

    # Prompt rules for known risky command prefixes.
    for prefix in _PROMPT_PREFIXES:
        if not prefix:
            continue
        if any((not token) or any(ch.isspace() for ch in token) for token in prefix):
            continue
        rendered = ", ".join(json.dumps(t) for t in prefix)
        lines.append(
            f"prefix_rule(pattern=[{rendered}], decision={json.dumps(_DECISION_PROMPT)})"
        )

    # Prompt rules for commands that should never be auto-run.
    for cmd in prompt_commands:
        lines.append(
            f"prefix_rule(pattern=[{json.dumps(cmd)}], decision={json.dumps(_DECISION_PROMPT)})"
        )

    return "\n".join(lines).rstrip() + "\n"


def write_rules_file(
    profile: SecurityProfile,
    *,
    path: Path | None = None,
    project_dir: Path | None = None,
    config: CodexExecpolicyConfig | None = None,
) -> Path:
    """
    Write a Codex execpolicy rules file to disk and return the path.
    """

    cfg = config or CodexExecpolicyConfig()
    target = (path or default_rules_path(cfg)).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)

    text = generate_rules_text(profile, project_dir=project_dir, config=cfg)
    target.write_text(text, encoding="utf-8")
    return target
