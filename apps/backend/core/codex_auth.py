"""
Codex Authentication Helpers
============================

Utilities for verifying Codex CLI is authenticated via ChatGPT login.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def build_codex_command(codex_path: str, *args: str) -> list[str]:
    """
    Build a subprocess argv list for running Codex.

    On Windows, Codex may be installed as a batch shim (`codex.cmd`). Python's
    subprocess exec APIs can fail to execute `.cmd`/`.bat` directly (especially
    via asyncio). In that case, run via `cmd.exe /c`.
    """

    if os.name == "nt":
        suffix = Path(codex_path).suffix.lower()
        if suffix in {".cmd", ".bat"}:
            return ["cmd.exe", "/c", codex_path, *args]

    return [codex_path, *args]


def _candidate_codex_paths() -> list[Path]:
    home = Path.home()

    if os.name == "nt":
        userprofile = Path(os.environ.get("USERPROFILE") or str(home))
        appdata = Path(os.environ.get("APPDATA") or userprofile / "AppData" / "Roaming")
        localappdata = Path(
            os.environ.get("LOCALAPPDATA") or userprofile / "AppData" / "Local"
        )

        return [
            appdata / "npm" / "codex.cmd",
            appdata / "npm" / "codex.exe",
            localappdata / "Programs" / "codex" / "codex.exe",
        ]

    # macOS: Homebrew paths first
    if sys.platform == "darwin":
        return [
            Path("/opt/homebrew/bin/codex"),
            Path("/usr/local/bin/codex"),
            home / ".local" / "bin" / "codex",
            home / "bin" / "codex",
        ]

    # Linux/other
    return [
        Path("/usr/local/bin/codex"),
        Path("/usr/bin/codex"),
        home / ".local" / "bin" / "codex",
        home / "bin" / "codex",
    ]


def get_codex_binary() -> str:
    """
    Resolve the Codex CLI binary.

    Supports an override via AUTO_CLAUDE_CODEX_PATH for GUI app environments
    where PATH may be incomplete.
    """

    override = (os.environ.get("AUTO_CLAUDE_CODEX_PATH") or "").strip()
    if override:
        expanded = str(Path(override).expanduser())
        if Path(expanded).exists():
            return expanded
        resolved = shutil.which(expanded)
        if resolved:
            return resolved

    codex_path = shutil.which("codex")
    if codex_path:
        return codex_path

    for candidate in _candidate_codex_paths():
        try:
            if candidate.exists():
                return str(candidate)
        except OSError:
            continue

    raise ValueError(
        "Codex CLI not found on PATH.\n\n"
        "Install it with:\n"
        "  brew install --cask codex\n"
        "or\n"
        "  npm install -g @openai/codex\n\n"
        "If Codex is installed but not discoverable (common in GUI apps), set:\n"
        "  AUTO_CLAUDE_CODEX_PATH=/full/path/to/codex"
    )


def get_codex_login_status() -> tuple[bool, str]:
    """
    Return (logged_in, status_text) for `codex login status`.
    """
    codex_path = get_codex_binary()

    try:
        result = subprocess.run(
            build_codex_command(codex_path, "login", "status"),
            capture_output=True,
            text=True,
            timeout=5,
        )
    except subprocess.TimeoutExpired:
        return False, "codex login status timed out"
    except OSError as exc:
        return False, f"codex login status failed: {exc}"

    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()

    combined = "\n".join([s for s in (stdout, stderr) if s])
    if result.returncode != 0:
        return False, combined or "codex login status failed"

    return ("logged in" in stdout.lower()), (stdout or combined)


def is_codex_logged_in_via_chatgpt() -> bool:
    logged_in, status = get_codex_login_status()
    if not logged_in:
        return False
    return "chatgpt" in status.lower()


def require_codex_chatgpt_login() -> str:
    """
    Ensure Codex is logged in using ChatGPT.

    Returns:
        Resolved path to the Codex CLI binary.

    Raises:
        ValueError: if Codex is missing or not logged in via ChatGPT
    """
    codex_path = get_codex_binary()
    logged_in, status = get_codex_login_status()
    if not logged_in:
        raise ValueError(
            "Codex is not logged in.\n\n"
            "To authenticate:\n"
            "  codex login\n\n"
            f"Status:\n{status}"
        )

    if "chatgpt" not in status.lower():
        raise ValueError(
            "Codex is logged in, but not via ChatGPT.\n\n"
            "Auto-Claude Codex engine requires ChatGPT login. To switch:\n"
            "  codex logout\n"
            "  codex login\n"
            "  (choose: Sign in with ChatGPT)\n\n"
            f"Status:\n{status}"
        )

    return codex_path
