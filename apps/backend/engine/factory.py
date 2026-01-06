"""
Engine Factory
==============

Selects the active agent runtime. MVP default remains the Claude SDK engine.
"""

from __future__ import annotations

import os

from .base import AgentEngine, EngineRunOptions


def get_default_engine_name() -> str:
    return os.environ.get("AUTO_CLAUDE_ENGINE", "claude").strip().lower()


def create_engine(options: EngineRunOptions) -> AgentEngine:
    engine_name = get_default_engine_name()
    if engine_name in {"claude", "claude_sdk"}:
        from .claude_sdk import ClaudeSdkEngine

        return ClaudeSdkEngine(options)

    if engine_name in {"codex", "codex_cli"}:
        from .codex_cli import CodexCliEngine

        return CodexCliEngine(options)

    raise ValueError(
        "Unknown engine "
        f"'{engine_name}'. Supported engines: claude, claude_sdk, codex, codex_cli"
    )
