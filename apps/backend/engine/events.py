"""
Engine Events
=============

Normalized event model emitted by AgentEngine implementations.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any


class EngineEventType(str, Enum):
    TEXT = "text"
    TOOL_START = "tool_start"
    TOOL_END = "tool_end"


@dataclass(frozen=True)
class EngineEvent:
    type: EngineEventType

    text: str | None = None

    tool_name: str | None = None
    tool_input_display: str | None = None
    tool_input_raw: Any | None = None

    tool_output: Any | None = None
    is_error: bool | None = None


def extract_tool_input_display(inp: Any) -> str | None:
    """Best-effort extraction of meaningful tool input for UI/log display."""
    if not isinstance(inp, dict):
        return None

    if "pattern" in inp:
        return f"pattern: {inp['pattern']}"
    if "file_path" in inp:
        fp = str(inp["file_path"])
        return ("..." + fp[-47:]) if len(fp) > 50 else fp
    if "command" in inp:
        cmd = str(inp["command"])
        return (cmd[:47] + "...") if len(cmd) > 50 else cmd
    if "path" in inp:
        return str(inp["path"])

    return None
