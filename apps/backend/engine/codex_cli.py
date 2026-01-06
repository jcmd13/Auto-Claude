"""
Codex CLI Engine
================

Runs a prompt through `codex exec --json` and maps the JSONL event stream into
normalized EngineEvents for the Auto-Claude pipeline.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from core.codex_auth import build_codex_command, require_codex_chatgpt_login

from .base import AgentEngine
from .events import EngineEvent, EngineEventType


def _safe_relpath(path: str, cwd: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(cwd.resolve()))
    except Exception:
        return path


def _summarize_file_changes(item: dict[str, Any], cwd: Path) -> tuple[str, str | None]:
    changes = item.get("changes") or []
    if not isinstance(changes, list) or not changes:
        return "Edit", None

    kinds = {str(c.get("kind", "")).lower() for c in changes if isinstance(c, dict)}
    tool_name = "Edit"
    if "add" in kinds and len(kinds) == 1:
        tool_name = "Write"

    parts: list[str] = []
    for change in changes:
        if not isinstance(change, dict):
            continue
        rel = _safe_relpath(str(change.get("path", "")), cwd)
        kind = str(change.get("kind", ""))
        if rel:
            parts.append(f"{kind}:{rel}")

    display = ", ".join(parts)
    return tool_name, (display if display else None)


def _coerce_text(item: dict[str, Any]) -> str | None:
    text = item.get("text")
    if isinstance(text, str):
        return text
    return None


def _infer_default_codex_approval_policy() -> str:
    """
    Infer a safe default approval policy for Codex.

    In non-interactive environments (no TTY), default to "never" to avoid
    blocking on approval prompts. Users can override via:
      AUTO_CLAUDE_CODEX_APPROVAL_POLICY=on-request|on-failure|untrusted|never
    """

    env_override = (os.environ.get("AUTO_CLAUDE_CODEX_APPROVAL_POLICY") or "").strip()
    if env_override:
        return env_override

    try:
        is_interactive = bool(sys.stdin and sys.stdin.isatty())
    except Exception:
        is_interactive = False

    return "on-request" if is_interactive else "never"


class CodexCliEngine(AgentEngine):
    def __init__(self, *args: Any, **kwargs: Any):
        super().__init__(*args, **kwargs)
        base_dir = self.options.spec_dir or self.options.cwd
        logs_dir = Path(base_dir) / "engine_logs"
        run_id = str(time.time_ns())
        self._logs_dir = logs_dir
        self._raw_jsonl_path = logs_dir / f"codex-exec-{run_id}.jsonl"
        self._stderr_path = logs_dir / f"codex-exec-{run_id}.stderr.log"
        self._last_message_path = logs_dir / f"codex-exec-{run_id}.last_message.txt"
        self._inflight_commands: dict[str, str] = {}

    def _build_command(
        self, prompt: str, *, codex_path: str | None = None
    ) -> list[str]:
        opts = self.options
        binary = (codex_path or os.environ.get("AUTO_CLAUDE_CODEX_PATH") or "").strip()
        if not binary:
            binary = "codex"
        sandbox = (opts.sandbox_mode or "").strip()
        if not sandbox:
            sandbox = (os.environ.get("AUTO_CLAUDE_CODEX_SANDBOX_MODE") or "").strip()
        if not sandbox:
            sandbox = "workspace-write"

        approval = (opts.approval_policy or "").strip()
        if not approval:
            approval = _infer_default_codex_approval_policy()

        cmd: list[str] = [
            binary,
            "-a",
            approval,
            "exec",
            "--json",
            "-C",
            str(opts.cwd),
            "-s",
            sandbox,
            "-c",
            'forced_login_method="chatgpt"',
            "-o",
            str(self._last_message_path),
        ]

        model = (opts.model or "").strip()
        # Auto-Claude defaults to Claude model IDs; don't pass those to Codex.
        if model and not model.lower().startswith("claude"):
            cmd.extend(["-m", model])

        if opts.output_schema_path:
            cmd.extend(["--output-schema", str(opts.output_schema_path)])

        cmd.append(prompt)
        return build_codex_command(cmd[0], *cmd[1:])

    def _events_from_json(self, event: dict[str, Any]) -> list[EngineEvent]:
        opts = self.options
        event_type = str(event.get("type", ""))
        item = event.get("item") if isinstance(event.get("item"), dict) else None
        if not item:
            return []

        item_type = str(item.get("type", ""))

        if event_type == "item.started" and item_type == "command_execution":
            item_id = str(item.get("id", ""))
            command = str(item.get("command", ""))
            if item_id:
                self._inflight_commands[item_id] = command
            return [
                EngineEvent(
                    type=EngineEventType.TOOL_START,
                    tool_name="Bash",
                    tool_input_display=command or None,
                    tool_input_raw=item,
                )
            ]

        if event_type == "item.completed" and item_type == "command_execution":
            item_id = str(item.get("id", ""))
            command = self._inflight_commands.pop(item_id, str(item.get("command", "")))
            exit_code = item.get("exit_code")
            is_error = bool(exit_code not in (0, None))
            output = item.get("aggregated_output", "")
            return [
                EngineEvent(
                    type=EngineEventType.TOOL_END,
                    tool_name="Bash",
                    tool_input_display=command or None,
                    tool_output=output,
                    is_error=is_error,
                )
            ]

        if event_type == "item.completed" and item_type == "file_change":
            tool_name, display = _summarize_file_changes(item, opts.cwd)
            # Codex emits only a completed item for file changes; emit start+end
            # so existing UI/logging sees an action boundary.
            return [
                EngineEvent(
                    type=EngineEventType.TOOL_START,
                    tool_name=tool_name,
                    tool_input_display=display,
                    tool_input_raw=item,
                ),
                EngineEvent(
                    type=EngineEventType.TOOL_END,
                    tool_name=tool_name,
                    tool_input_display=display,
                    tool_output=item.get("changes"),
                    is_error=False,
                ),
            ]

        if event_type == "item.completed" and item_type == "agent_message":
            text = _coerce_text(item)
            if not text:
                return []
            return [EngineEvent(type=EngineEventType.TEXT, text=text)]

        return []

    async def stream(self, prompt: str) -> AsyncIterator[EngineEvent]:
        codex_path = require_codex_chatgpt_login()

        self._logs_dir.mkdir(parents=True, exist_ok=True)

        cmd = self._build_command(prompt, codex_path=codex_path)
        emitted_agent_message = False

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(self.options.cwd),
        )

        assert proc.stdout is not None
        assert proc.stderr is not None

        stderr_lines: list[str] = []

        async def _drain_stderr() -> None:
            with open(self._stderr_path, "a", encoding="utf-8") as f:
                while True:
                    chunk = await proc.stderr.readline()
                    if not chunk:
                        break
                    line = chunk.decode("utf-8", errors="replace")
                    f.write(line)
                    f.flush()
                    stderr_lines.append(line.rstrip("\n"))
                    if len(stderr_lines) > 50:
                        del stderr_lines[:10]

        stderr_task = asyncio.create_task(_drain_stderr())

        with open(self._raw_jsonl_path, "a", encoding="utf-8") as raw:
            while True:
                line_bytes = await proc.stdout.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").rstrip("\n")

                raw.write(line + "\n")
                raw.flush()

                if not line.strip():
                    continue

                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    # If Codex prints a non-JSON line, surface it as text.
                    yield EngineEvent(type=EngineEventType.TEXT, text=line)
                    continue

                if isinstance(payload, dict):
                    for ev in self._events_from_json(payload):
                        if ev.type == EngineEventType.TEXT and ev.text:
                            emitted_agent_message = True
                        yield ev

        try:
            if self.options.timeout_seconds:
                await asyncio.wait_for(proc.wait(), timeout=self.options.timeout_seconds)
            else:
                await proc.wait()
        finally:
            stderr_task.cancel()
            with contextlib.suppress(Exception):
                await stderr_task

        if proc.returncode and proc.returncode != 0:
            tail = "\n".join(stderr_lines[-20:])
            hint = (
                f"codex exec failed with exit code {proc.returncode}. "
                f"stderr log: {self._stderr_path}"
            )
            if tail:
                hint += f"\n\nLast stderr lines:\n{tail}"
            raise RuntimeError(hint)

        # Best-effort: if Codex didn't emit an agent_message, fall back to the
        # output-last-message file.
        if not emitted_agent_message and self._last_message_path.exists():
            try:
                text = self._last_message_path.read_text(encoding="utf-8").strip()
            except OSError:
                text = ""
            if text:
                yield EngineEvent(type=EngineEventType.TEXT, text=text)
