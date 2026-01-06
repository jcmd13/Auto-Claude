#!/usr/bin/env python3
"""
Tests for Codex CLI engine parsing/mapping.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import sys

from engine import EngineEventType, EngineRunOptions  # noqa: E402
from engine.codex_cli import CodexCliEngine  # noqa: E402


class _DummyStdin:
    def __init__(self, is_tty: bool):
        self._is_tty = is_tty

    def isatty(self) -> bool:  # noqa: D401
        """Return configured TTY state."""
        return self._is_tty


def test_codex_cli_default_approval_policy_non_tty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AUTO_CLAUDE_CODEX_APPROVAL_POLICY", raising=False)
    monkeypatch.setattr(sys, "stdin", _DummyStdin(False))

    engine = CodexCliEngine(EngineRunOptions(cwd=tmp_path, spec_dir=tmp_path, model="o3"))
    cmd = engine._build_command("PROMPT")  # noqa: SLF001
    assert ["-a", "never"] == cmd[cmd.index("-a") : cmd.index("-a") + 2]


def test_codex_cli_default_approval_policy_tty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("AUTO_CLAUDE_CODEX_APPROVAL_POLICY", raising=False)
    monkeypatch.setattr(sys, "stdin", _DummyStdin(True))

    engine = CodexCliEngine(EngineRunOptions(cwd=tmp_path, spec_dir=tmp_path, model="o3"))
    cmd = engine._build_command("PROMPT")  # noqa: SLF001
    assert ["-a", "on-request"] == cmd[cmd.index("-a") : cmd.index("-a") + 2]


def test_codex_cli_approval_policy_env_override(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("AUTO_CLAUDE_CODEX_APPROVAL_POLICY", "on-failure")
    monkeypatch.setattr(sys, "stdin", _DummyStdin(False))

    engine = CodexCliEngine(EngineRunOptions(cwd=tmp_path, spec_dir=tmp_path, model="o3"))
    cmd = engine._build_command("PROMPT")  # noqa: SLF001
    assert ["-a", "on-failure"] == cmd[cmd.index("-a") : cmd.index("-a") + 2]


def test_codex_cli_build_command_skips_claude_model(tmp_path: Path):
    engine = CodexCliEngine(
        EngineRunOptions(
            cwd=tmp_path,
            spec_dir=tmp_path,
            model="claude-opus-4-5-20251101",
        )
    )
    cmd = engine._build_command("PROMPT")  # noqa: SLF001
    assert "-m" not in cmd


def test_codex_cli_build_command_passes_non_claude_model(tmp_path: Path):
    engine = CodexCliEngine(
        EngineRunOptions(
            cwd=tmp_path,
            spec_dir=tmp_path,
            model="o3",
        )
    )
    cmd = engine._build_command("PROMPT")  # noqa: SLF001
    assert ["-m", "o3"] == cmd[cmd.index("-m") : cmd.index("-m") + 2]


def test_codex_cli_maps_agent_message_to_text_event(tmp_path: Path):
    engine = CodexCliEngine(EngineRunOptions(cwd=tmp_path, spec_dir=tmp_path, model="o3"))
    payload = {
        "type": "item.completed",
        "item": {"id": "item_1", "type": "agent_message", "text": "hello"},
    }
    events = engine._events_from_json(payload)  # noqa: SLF001
    assert [(e.type, e.text) for e in events] == [(EngineEventType.TEXT, "hello")]


def test_codex_cli_maps_command_execution_start_end(tmp_path: Path):
    engine = CodexCliEngine(EngineRunOptions(cwd=tmp_path, spec_dir=tmp_path, model="o3"))

    started = {
        "type": "item.started",
        "item": {
            "id": "item_0",
            "type": "command_execution",
            "command": "/bin/zsh -lc 'ls -1'",
            "status": "in_progress",
        },
    }
    evs = engine._events_from_json(started)  # noqa: SLF001
    assert len(evs) == 1
    assert evs[0].type == EngineEventType.TOOL_START
    assert evs[0].tool_name == "Bash"
    assert "ls -1" in (evs[0].tool_input_display or "")

    completed = {
        "type": "item.completed",
        "item": {
            "id": "item_0",
            "type": "command_execution",
            "command": "/bin/zsh -lc 'ls -1'",
            "aggregated_output": "a.txt\n",
            "exit_code": 0,
            "status": "completed",
        },
    }
    evs = engine._events_from_json(completed)  # noqa: SLF001
    assert len(evs) == 1
    assert evs[0].type == EngineEventType.TOOL_END
    assert evs[0].tool_name == "Bash"
    assert evs[0].is_error is False
    assert evs[0].tool_output == "a.txt\n"


def test_codex_cli_maps_file_add_to_write(tmp_path: Path):
    engine = CodexCliEngine(EngineRunOptions(cwd=tmp_path, spec_dir=tmp_path, model="o3"))
    file_path = tmp_path / "new_file.txt"
    payload = {
        "type": "item.completed",
        "item": {
            "id": "item_0",
            "type": "file_change",
            "changes": [{"path": str(file_path), "kind": "add"}],
            "status": "completed",
        },
    }
    events = engine._events_from_json(payload)  # noqa: SLF001
    assert [e.type for e in events] == [
        EngineEventType.TOOL_START,
        EngineEventType.TOOL_END,
    ]
    assert events[0].tool_name == "Write"
    assert events[1].tool_name == "Write"
    assert "add:new_file.txt" in (events[0].tool_input_display or "")
