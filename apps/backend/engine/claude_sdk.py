"""
Claude SDK Engine
=================

Adapter that runs a prompt via claude-agent-sdk and emits normalized EngineEvents.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from core.client import create_client

from .base import AgentEngine
from .events import EngineEvent, EngineEventType, extract_tool_input_display


class ClaudeSdkEngine(AgentEngine):
    async def stream(self, prompt: str) -> AsyncIterator[EngineEvent]:
        options = self.options
        client = create_client(
            options.cwd,
            options.spec_dir or options.cwd,
            options.model,
            agent_type=options.agent_type,
            max_thinking_tokens=options.max_thinking_tokens,
        )

        current_tool: str | None = None

        async with client:
            await client.query(prompt)

            async for msg in client.receive_response():
                msg_type = type(msg).__name__

                if msg_type == "AssistantMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__

                        if block_type == "TextBlock" and hasattr(block, "text"):
                            yield EngineEvent(
                                type=EngineEventType.TEXT,
                                text=block.text,
                            )
                        elif block_type == "ToolUseBlock" and hasattr(block, "name"):
                            tool_name = block.name
                            tool_input_raw = getattr(block, "input", None)
                            yield EngineEvent(
                                type=EngineEventType.TOOL_START,
                                tool_name=tool_name,
                                tool_input_display=extract_tool_input_display(
                                    tool_input_raw
                                ),
                                tool_input_raw=tool_input_raw,
                            )
                            current_tool = tool_name

                elif msg_type == "UserMessage" and hasattr(msg, "content"):
                    for block in msg.content:
                        block_type = type(block).__name__

                        if block_type == "ToolResultBlock":
                            yield EngineEvent(
                                type=EngineEventType.TOOL_END,
                                tool_name=current_tool,
                                is_error=getattr(block, "is_error", False),
                                tool_output=getattr(block, "content", ""),
                            )
                            current_tool = None
