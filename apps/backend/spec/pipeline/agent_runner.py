"""
Agent Runner
============

Handles the execution of AI agents for the spec creation pipeline.
"""

from pathlib import Path

# Configure safe encoding before any output (fixes Windows encoding errors)
from ui.capabilities import configure_safe_encoding

configure_safe_encoding()

from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from engine import EngineEventType, EngineRunOptions, create_engine
from task_logger import (
    LogEntryType,
    LogPhase,
    TaskLogger,
)


class AgentRunner:
    """Manages agent execution with logging and error handling."""

    def __init__(
        self,
        project_dir: Path,
        spec_dir: Path,
        model: str,
        task_logger: TaskLogger | None = None,
    ):
        """Initialize the agent runner.

        Args:
            project_dir: The project root directory
            spec_dir: The spec directory
            model: The model to use for agent execution
            task_logger: Optional task logger for tracking progress
        """
        self.project_dir = project_dir
        self.spec_dir = spec_dir
        self.model = model
        self.task_logger = task_logger

    async def run_agent(
        self,
        prompt_file: str,
        additional_context: str = "",
        interactive: bool = False,
        thinking_budget: int | None = None,
        prior_phase_summaries: str | None = None,
    ) -> tuple[bool, str]:
        """Run an agent with the given prompt.

        Args:
            prompt_file: The prompt file to use (relative to prompts directory)
            additional_context: Additional context to add to the prompt
            interactive: Whether to run in interactive mode
            thinking_budget: Token budget for extended thinking (None = disabled)
            prior_phase_summaries: Summaries from previous phases for context

        Returns:
            Tuple of (success, response_text)
        """
        debug_section("agent_runner", f"Spec Agent - {prompt_file}")
        debug(
            "agent_runner",
            "Running spec creation agent",
            prompt_file=prompt_file,
            spec_dir=str(self.spec_dir),
            model=self.model,
            interactive=interactive,
        )

        prompt_path = Path(__file__).parent.parent.parent / "prompts" / prompt_file

        if not prompt_path.exists():
            debug_error("agent_runner", f"Prompt file not found: {prompt_path}")
            return False, f"Prompt not found: {prompt_path}"

        # Load prompt
        prompt = prompt_path.read_text()
        debug_detailed(
            "agent_runner",
            "Loaded prompt file",
            prompt_length=len(prompt),
        )

        # Add context
        prompt += f"\n\n---\n\n**Spec Directory**: {self.spec_dir}\n"
        prompt += f"**Project Directory**: {self.project_dir}\n"

        # Add summaries from previous phases (compaction)
        if prior_phase_summaries:
            prompt += f"\n{prior_phase_summaries}\n"
            debug_detailed(
                "agent_runner",
                "Added prior phase summaries",
                summaries_length=len(prior_phase_summaries),
            )

        if additional_context:
            prompt += f"\n{additional_context}\n"
            debug_detailed(
                "agent_runner",
                "Added additional context",
                context_length=len(additional_context),
            )

        # Create engine with thinking budget
        debug(
            "agent_runner",
            "Creating agent engine...",
            thinking_budget=thinking_budget,
        )
        engine = create_engine(
            EngineRunOptions(
                cwd=self.project_dir,
                spec_dir=self.spec_dir,
                model=self.model,
                agent_type="coder",
                max_thinking_tokens=thinking_budget,
            )
        )

        current_tool = None
        message_count = 0
        tool_count = 0

        try:
            debug("agent_runner", "Sending query to agent engine...")
            debug_success("agent_runner", "Query started successfully")

            response_text = ""
            debug("agent_runner", "Starting to receive response stream...")
            async for event in engine.stream(prompt):
                message_count += 1
                debug_detailed(
                    "agent_runner",
                    f"Received event #{message_count}",
                    event_type=event.type.value,
                )

                if event.type == EngineEventType.TEXT and event.text is not None:
                    response_text += event.text
                    print(event.text, end="", flush=True)
                    if self.task_logger and event.text.strip():
                        self.task_logger.log(
                            event.text,
                            LogEntryType.TEXT,
                            LogPhase.PLANNING,
                            print_to_console=False,
                        )
                elif event.type == EngineEventType.TOOL_START and event.tool_name:
                    tool_name = event.tool_name
                    tool_input = event.tool_input_display
                    tool_count += 1

                    debug(
                        "agent_runner",
                        f"Tool call #{tool_count}: {tool_name}",
                        tool_input=tool_input,
                    )

                    if self.task_logger:
                        self.task_logger.tool_start(
                            tool_name,
                            tool_input,
                            LogPhase.PLANNING,
                            print_to_console=True,
                        )
                    else:
                        print(f"\n[Tool: {tool_name}]", flush=True)
                    current_tool = tool_name

                elif event.type == EngineEventType.TOOL_END:
                    tool_name = event.tool_name or current_tool
                    is_error = bool(event.is_error)
                    result_content = event.tool_output

                    if is_error:
                        debug_error(
                            "agent_runner",
                            f"Tool error: {tool_name}",
                            error=str(result_content)[:200],
                        )
                    else:
                        debug_detailed(
                            "agent_runner",
                            f"Tool success: {tool_name}",
                            result_length=len(str(result_content)),
                        )

                    if self.task_logger and tool_name:
                        detail_content = self._get_tool_detail_content(
                            tool_name, result_content
                        )
                        self.task_logger.tool_end(
                            tool_name,
                            success=not is_error,
                            detail=detail_content,
                            phase=LogPhase.PLANNING,
                        )
                    current_tool = None

            print()
            debug_success(
                "agent_runner",
                "Agent session completed successfully",
                message_count=message_count,
                tool_count=tool_count,
                response_length=len(response_text),
            )
            return True, response_text

        except Exception as e:
            debug_error(
                "agent_runner",
                f"Agent session error: {e}",
                exception_type=type(e).__name__,
            )
            if self.task_logger:
                self.task_logger.log_error(f"Agent error: {e}", LogPhase.PLANNING)
            return False, str(e)

    @staticmethod
    def _get_tool_detail_content(tool_name: str, result_content: object) -> str | None:
        """
        Determine whether to store full tool output based on tool name and size.
        """
        if tool_name not in ("Read", "Grep", "Bash", "Edit", "Write"):
            return None

        result_str = str(result_content)
        if len(result_str) < 50000:
            return result_str
        return None
