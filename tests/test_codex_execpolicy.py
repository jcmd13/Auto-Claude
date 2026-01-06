#!/usr/bin/env python3
"""
Tests for Codex execpolicy rule generation.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from project_analyzer import SecurityProfile  # noqa: E402
from security.codex_execpolicy import (  # noqa: E402
    default_rules_path,
    generate_rules_text,
    write_rules_file,
)


def test_generate_rules_text_allows_safe_and_prompts_risky():
    profile = SecurityProfile()
    profile.base_commands = {"ls", "rm", "git", "curl"}

    rules = generate_rules_text(profile, project_dir=Path("/tmp/project"))

    # Safe allowlist
    assert 'prefix_rule(pattern=["ls"], decision="allow")' in rules
    assert 'prefix_rule(pattern=["git"], decision="allow")' in rules

    # Risky commands prompt
    assert 'prefix_rule(pattern=["rm"], decision="prompt")' in rules
    assert 'prefix_rule(pattern=["curl"], decision="prompt")' in rules

    # Risky git subcommands prompt
    assert 'prefix_rule(pattern=["git", "push"], decision="prompt")' in rules


def test_default_rules_path_respects_codex_home(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    assert default_rules_path().parent == tmp_path / "rules"


def test_write_rules_file_writes_content(tmp_path: Path):
    profile = SecurityProfile()
    profile.base_commands = {"ls"}

    out_path = tmp_path / "rules" / "auto-claude.rules"
    written = write_rules_file(profile, path=out_path, project_dir=tmp_path)

    assert written == out_path
    assert written.exists()
    assert 'prefix_rule(pattern=["ls"], decision="allow")' in written.read_text(encoding="utf-8")
