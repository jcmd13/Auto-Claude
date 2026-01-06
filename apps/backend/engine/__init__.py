"""
Agent Engine Abstraction
========================

Provides a small adapter layer so Auto-Claude's orchestrator can run against
multiple agent runtimes (Claude SDK and Codex CLI).
"""

from .base import AgentEngine, EngineResult, EngineRunOptions
from .events import EngineEvent, EngineEventType
from .factory import create_engine, get_default_engine_name

__all__ = [
    "AgentEngine",
    "EngineEvent",
    "EngineEventType",
    "EngineResult",
    "EngineRunOptions",
    "create_engine",
    "get_default_engine_name",
]
