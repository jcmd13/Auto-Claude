#!/usr/bin/env python3
"""
Tests for Codex auth gating.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from core import codex_auth  # noqa: E402


def test_require_codex_chatgpt_login_raises_when_codex_missing(monkeypatch):
    monkeypatch.delenv("AUTO_CLAUDE_CODEX_PATH", raising=False)
    monkeypatch.setattr(codex_auth, "_candidate_codex_paths", lambda: [])
    monkeypatch.setattr(codex_auth.shutil, "which", lambda _: None)
    with pytest.raises(ValueError, match="Codex CLI not found"):
        codex_auth.require_codex_chatgpt_login()


def test_require_codex_chatgpt_login_raises_when_not_logged_in(monkeypatch):
    monkeypatch.delenv("AUTO_CLAUDE_CODEX_PATH", raising=False)
    monkeypatch.setattr(codex_auth.shutil, "which", lambda _: "/usr/local/bin/codex")

    def fake_run(*args, **kwargs):
        return type(
            "CP",
            (),
            {"returncode": 1, "stdout": "", "stderr": "Not logged in"},
        )()

    monkeypatch.setattr(codex_auth.subprocess, "run", fake_run)
    with pytest.raises(ValueError, match="Codex is not logged in"):
        codex_auth.require_codex_chatgpt_login()


def test_require_codex_chatgpt_login_raises_when_not_chatgpt(monkeypatch):
    monkeypatch.delenv("AUTO_CLAUDE_CODEX_PATH", raising=False)
    monkeypatch.setattr(codex_auth.shutil, "which", lambda _: "/usr/local/bin/codex")

    def fake_run(*args, **kwargs):
        return type(
            "CP",
            (),
            {"returncode": 0, "stdout": "Logged in using API key", "stderr": ""},
        )()

    monkeypatch.setattr(codex_auth.subprocess, "run", fake_run)
    with pytest.raises(ValueError, match="not via ChatGPT"):
        codex_auth.require_codex_chatgpt_login()


def test_is_codex_logged_in_via_chatgpt_true(monkeypatch):
    monkeypatch.delenv("AUTO_CLAUDE_CODEX_PATH", raising=False)
    monkeypatch.setattr(codex_auth.shutil, "which", lambda _: "/usr/local/bin/codex")

    def fake_run(*args, **kwargs):
        return type(
            "CP",
            (),
            {"returncode": 0, "stdout": "Logged in using ChatGPT", "stderr": ""},
        )()

    monkeypatch.setattr(codex_auth.subprocess, "run", fake_run)
    assert codex_auth.is_codex_logged_in_via_chatgpt() is True


def test_get_codex_login_status_times_out(monkeypatch):
    monkeypatch.delenv("AUTO_CLAUDE_CODEX_PATH", raising=False)
    monkeypatch.setattr(codex_auth.shutil, "which", lambda _: "/usr/local/bin/codex")

    def fake_run(*args, **kwargs):
        raise codex_auth.subprocess.TimeoutExpired(cmd=args[0], timeout=5)

    monkeypatch.setattr(codex_auth.subprocess, "run", fake_run)

    logged_in, status = codex_auth.get_codex_login_status()
    assert logged_in is False
    assert "timed out" in status.lower()


def test_get_codex_binary_prefers_env_override(monkeypatch, tmp_path: Path):
    fake_codex = tmp_path / "codex"
    fake_codex.write_text("")

    monkeypatch.setenv("AUTO_CLAUDE_CODEX_PATH", str(fake_codex))
    monkeypatch.setattr(codex_auth.shutil, "which", lambda _: None)

    assert codex_auth.get_codex_binary() == str(fake_codex)


def test_build_codex_command_wraps_windows_cmd(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(codex_auth.os, "name", "nt")
    codex_path = r"C:\Users\john\AppData\Roaming\npm\codex.cmd"
    cmd = codex_auth.build_codex_command(codex_path, "login", "status")
    assert cmd[:3] == ["cmd.exe", "/c", codex_path]
    assert cmd[3:] == ["login", "status"]


def test_build_codex_command_keeps_exe_on_windows(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(codex_auth.os, "name", "nt")
    codex_path = r"C:\Program Files\Codex\codex.exe"
    cmd = codex_auth.build_codex_command(codex_path, "login", "status")
    assert cmd == [codex_path, "login", "status"]
