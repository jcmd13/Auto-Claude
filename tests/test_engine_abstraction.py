#!/usr/bin/env python3
"""
Tests for Engine Abstraction
============================

Validates that the Claude SDK engine adapter emits normalized events so the
orchestrator no longer depends on Claude SDK message/block types.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from engine import EngineEventType, EngineRunOptions, create_engine  # noqa: E402
from engine.claude_sdk import ClaudeSdkEngine  # noqa: E402


class AssistantMessage:
    def __init__(self, content: list[object]):
        self.content = content


class UserMessage:
    def __init__(self, content: list[object]):
        self.content = content


class TextBlock:
    def __init__(self, text: str):
        self.text = text


class ToolUseBlock:
    def __init__(self, name: str, input: object | None = None):
        self.name = name
        self.input = input


class ToolResultBlock:
    def __init__(self, content: object, is_error: bool = False):
        self.content = content
        self.is_error = is_error


class FakeClient:
    def __init__(self, messages: list[object]):
        self._messages = messages
        self.queries: list[str] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def query(self, prompt: str) -> None:
        self.queries.append(prompt)

    async def receive_response(self):
        for msg in self._messages:
            yield msg


@pytest.mark.asyncio
async def test_claude_engine_stream_normalizes_events(monkeypatch, tmp_path: Path):
    spec_dir = tmp_path / "spec"
    spec_dir.mkdir()

    fake_client = FakeClient(
        [
            AssistantMessage(
                [
                    TextBlock("Hello "),
                    ToolUseBlock("Read", {"file_path": "foo.txt"}),
                ]
            ),
            UserMessage([ToolResultBlock("file content", is_error=False)]),
            AssistantMessage([TextBlock("world")]),
        ]
    )

    def fake_create_client(project_dir, spec_dir_arg, model, agent_type="coder", max_thinking_tokens=None):
        assert project_dir == tmp_path
        assert spec_dir_arg == spec_dir
        assert model == "test-model"
        assert agent_type == "coder"
        assert max_thinking_tokens == 123
        return fake_client

    monkeypatch.setattr("engine.claude_sdk.create_client", fake_create_client)

    engine = ClaudeSdkEngine(
        EngineRunOptions(
            cwd=tmp_path,
            spec_dir=spec_dir,
            model="test-model",
            agent_type="coder",
            max_thinking_tokens=123,
        )
    )

    events = [event async for event in engine.stream("PROMPT")]

    assert fake_client.queries == ["PROMPT"]
    assert [e.type for e in events] == [
        EngineEventType.TEXT,
        EngineEventType.TOOL_START,
        EngineEventType.TOOL_END,
        EngineEventType.TEXT,
    ]
    assert events[0].text == "Hello "
    assert events[1].tool_name == "Read"
    assert events[1].tool_input_display == "foo.txt"
    assert events[2].tool_name == "Read"
    assert events[2].is_error is False
    assert events[2].tool_output == "file content"
    assert events[3].text == "world"


def test_create_engine_defaults_to_claude(monkeypatch, tmp_path: Path):
    monkeypatch.delenv("AUTO_CLAUDE_ENGINE", raising=False)
    engine = create_engine(
        EngineRunOptions(
            cwd=tmp_path,
            spec_dir=tmp_path,
            model="test-model",
        )
    )
    assert isinstance(engine, ClaudeSdkEngine)
