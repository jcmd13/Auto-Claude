"""
Engine Base Types
=================

Defines the AgentEngine interface and shared option/result types.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path

from .events import EngineEvent


@dataclass(frozen=True)
class EngineRunOptions:
    """
    Engine execution options.

    Note: Not all fields are used by every engine implementation.
    """

    cwd: Path
    spec_dir: Path | None
    model: str
    agent_type: str = "coder"
    max_thinking_tokens: int | None = None

    # Codex-specific (phase 2)
    sandbox_mode: str | None = None
    approval_policy: str | None = None
    output_schema_path: Path | None = None
    timeout_seconds: int | None = None


@dataclass(frozen=True)
class EngineResult:
    final_text: str
    status: str = "success"
    error: str | None = None


class AgentEngine(ABC):
    """Abstract agent runtime that streams normalized EngineEvents."""

    def __init__(self, options: EngineRunOptions):
        self.options = options

    @abstractmethod
    async def stream(self, prompt: str) -> AsyncIterator[EngineEvent]:
        """Stream normalized events for a single prompt execution."""

    async def run(self, prompt: str) -> EngineResult:
        """Run a prompt to completion and return the final assistant text."""
        chunks: list[str] = []
        try:
            async for event in self.stream(prompt):
                if event.text:
                    chunks.append(event.text)
        except Exception as exc:  # pragma: no cover - engine error surface
            return EngineResult(
                final_text="".join(chunks), status="error", error=str(exc)
            )
        return EngineResult(final_text="".join(chunks))
