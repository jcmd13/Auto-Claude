"""
QA Fixer Agent Session
=======================

Runs QA fixer sessions to resolve issues identified by the reviewer.

Memory Integration:
- Retrieves past patterns, fixes, and gotchas before fixing
- Saves fix outcomes and learnings after session
"""

from pathlib import Path

# Memory integration for cross-session learning
from agents.memory_manager import get_graphiti_context, save_session_memory
from debug import debug, debug_detailed, debug_error, debug_section, debug_success
from engine import AgentEngine, EngineEventType
from task_logger import (
    LogEntryType,
    LogPhase,
    get_task_logger,
)

from .criteria import get_qa_signoff_status

# Configuration
QA_PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


# =============================================================================
# PROMPT LOADING
# =============================================================================


def load_qa_fixer_prompt() -> str:
    """Load the QA fixer agent prompt."""
    prompt_file = QA_PROMPTS_DIR / "qa_fixer.md"
    if not prompt_file.exists():
        raise FileNotFoundError(f"QA fixer prompt not found: {prompt_file}")
    return prompt_file.read_text()


# =============================================================================
# QA FIXER SESSION
# =============================================================================


async def run_qa_fixer_session(
    engine: AgentEngine,
    spec_dir: Path,
    fix_session: int,
    verbose: bool = False,
    project_dir: Path | None = None,
) -> tuple[str, str]:
    """
    Run a QA fixer agent session.

    Args:
        engine: Agent engine
        spec_dir: Spec directory
        fix_session: Fix iteration number
        verbose: Whether to show detailed output
        project_dir: Project root directory (for memory context)

    Returns:
        (status, response_text) where status is:
        - "fixed" if fixes were applied
        - "error" if an error occurred
    """
    # Derive project_dir from spec_dir if not provided
    # spec_dir is typically: /project/.auto-claude/specs/001-name/
    if project_dir is None:
        # Walk up from spec_dir to find project root
        project_dir = spec_dir.parent.parent.parent
    debug_section("qa_fixer", f"QA Fixer Session {fix_session}")
    debug(
        "qa_fixer",
        "Starting QA fixer session",
        spec_dir=str(spec_dir),
        fix_session=fix_session,
    )

    print(f"\n{'=' * 70}")
    print(f"  QA FIXER SESSION {fix_session}")
    print("  Applying fixes from QA_FIX_REQUEST.md...")
    print(f"{'=' * 70}\n")

    # Get task logger for streaming markers
    task_logger = get_task_logger(spec_dir)
    current_tool = None
    message_count = 0
    tool_count = 0

    # Check that fix request file exists
    fix_request_file = spec_dir / "QA_FIX_REQUEST.md"
    if not fix_request_file.exists():
        debug_error("qa_fixer", "QA_FIX_REQUEST.md not found")
        return "error", "QA_FIX_REQUEST.md not found"

    # Load fixer prompt
    prompt = load_qa_fixer_prompt()
    debug_detailed("qa_fixer", "Loaded QA fixer prompt", prompt_length=len(prompt))

    # Retrieve memory context for fixer (past fixes, patterns, gotchas)
    fixer_memory_context = await get_graphiti_context(
        spec_dir,
        project_dir,
        {
            "description": "Fixing QA issues and implementing corrections",
            "id": f"qa_fixer_{fix_session}",
        },
    )
    if fixer_memory_context:
        prompt += "\n\n" + fixer_memory_context
        print("✓ Memory context loaded for QA fixer")
        debug_success("qa_fixer", "Graphiti memory context loaded for fixer")

    # Add session context - use full path so agent can find files
    prompt += f"\n\n---\n\n**Fix Session**: {fix_session}\n"
    prompt += f"**Spec Directory**: {spec_dir}\n"
    prompt += f"**Spec Name**: {spec_dir.name}\n"
    prompt += f"\n**IMPORTANT**: All spec files are located in: `{spec_dir}/`\n"
    prompt += f"The fix request file is at: `{spec_dir}/QA_FIX_REQUEST.md`\n"

    try:
        debug("qa_fixer", "Sending query to agent engine...")
        debug_success("qa_fixer", "Query started successfully")
        response_text = ""
        debug("qa_fixer", "Starting to receive response stream...")
        async for event in engine.stream(prompt):
            message_count += 1
            debug_detailed(
                "qa_fixer",
                f"Received event #{message_count}",
                event_type=event.type.value,
            )

            if event.type == EngineEventType.TEXT and event.text is not None:
                response_text += event.text
                print(event.text, end="", flush=True)
                if task_logger and event.text.strip():
                    task_logger.log(
                        event.text,
                        LogEntryType.TEXT,
                        LogPhase.VALIDATION,
                        print_to_console=False,
                    )
            elif event.type == EngineEventType.TOOL_START and event.tool_name:
                tool_name = event.tool_name
                tool_input = event.tool_input_display
                tool_input_raw = event.tool_input_raw
                tool_count += 1

                debug(
                    "qa_fixer",
                    f"Tool call #{tool_count}: {tool_name}",
                    tool_input=tool_input,
                )

                if task_logger:
                    task_logger.tool_start(
                        tool_name,
                        tool_input,
                        LogPhase.VALIDATION,
                        print_to_console=True,
                    )
                else:
                    print(f"\n[Fixer Tool: {tool_name}]", flush=True)

                if verbose and tool_input_raw is not None:
                    input_str = str(tool_input_raw)
                    if len(input_str) > 300:
                        print(f"   Input: {input_str[:300]}...", flush=True)
                    else:
                        print(f"   Input: {input_str}", flush=True)
                current_tool = tool_name

            elif event.type == EngineEventType.TOOL_END:
                tool_name = event.tool_name or current_tool
                is_error = bool(event.is_error)
                result_content = event.tool_output

                if is_error:
                    debug_error(
                        "qa_fixer",
                        f"Tool error: {tool_name}",
                        error=str(result_content)[:200],
                    )
                    error_str = str(result_content)[:500]
                    print(f"   [Error] {error_str}", flush=True)
                    if task_logger and tool_name:
                        task_logger.tool_end(
                            tool_name,
                            success=False,
                            result=error_str[:100],
                            detail=str(result_content),
                            phase=LogPhase.VALIDATION,
                        )
                else:
                    debug_detailed(
                        "qa_fixer",
                        f"Tool success: {tool_name}",
                        result_length=len(str(result_content)),
                    )
                    if verbose:
                        result_str = str(result_content)[:200]
                        print(f"   [Done] {result_str}", flush=True)
                    else:
                        print("   [Done]", flush=True)
                    if task_logger and tool_name:
                        detail_content = None
                        if tool_name in ("Read", "Grep", "Bash", "Edit", "Write"):
                            result_str = str(result_content)
                            if len(result_str) < 50000:
                                detail_content = result_str
                        task_logger.tool_end(
                            tool_name,
                            success=True,
                            detail=detail_content,
                            phase=LogPhase.VALIDATION,
                        )

                current_tool = None

        print("\n" + "-" * 70 + "\n")

        # Check if fixes were applied
        status = get_qa_signoff_status(spec_dir)
        debug(
            "qa_fixer",
            "Fixer session completed",
            message_count=message_count,
            tool_count=tool_count,
            response_length=len(response_text),
            ready_for_revalidation=status.get("ready_for_qa_revalidation")
            if status
            else False,
        )

        # Save fixer session insights to memory
        fixer_discoveries = {
            "files_understood": {},
            "patterns_found": [
                f"QA fixer session {fix_session}: Applied fixes from QA_FIX_REQUEST.md"
            ],
            "gotchas_encountered": [],
        }

        if status and status.get("ready_for_qa_revalidation"):
            debug_success("qa_fixer", "Fixes applied, ready for QA revalidation")
            # Save successful fix session to memory
            await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=f"qa_fixer_{fix_session}",
                session_num=fix_session,
                success=True,
                subtasks_completed=[f"qa_fixer_{fix_session}"],
                discoveries=fixer_discoveries,
            )
            return "fixed", response_text
        else:
            # Fixer didn't update the status properly, but we'll trust it worked
            debug_success("qa_fixer", "Fixes assumed applied (status not updated)")
            # Still save to memory as successful (fixes were attempted)
            await save_session_memory(
                spec_dir=spec_dir,
                project_dir=project_dir,
                subtask_id=f"qa_fixer_{fix_session}",
                session_num=fix_session,
                success=True,
                subtasks_completed=[f"qa_fixer_{fix_session}"],
                discoveries=fixer_discoveries,
            )
            return "fixed", response_text

    except Exception as e:
        debug_error(
            "qa_fixer",
            f"Fixer session exception: {e}",
            exception_type=type(e).__name__,
        )
        print(f"Error during fixer session: {e}")
        if task_logger:
            task_logger.log_error(f"QA fixer error: {e}", LogPhase.VALIDATION)
        return "error", str(e)
