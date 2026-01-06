# PRD: Codex CLI Engine for Auto‑Claude (Codex‑First MVP)

## Summary

Auto‑Claude is a Python autonomous build orchestrator (`auto-claude/`) with an optional Electron desktop UI (`auto-claude-ui/`). Today it runs agent sessions via **Claude Code** (through `claude-agent-sdk`) and requires **Claude Code OAuth** (`CLAUDE_CODE_OAUTH_TOKEN`). This PRD proposes a Codex‑first MVP that adds a **Codex CLI** backend (with **ChatGPT login**) while preserving Auto‑Claude’s core value: safe, iterative builds in git worktrees with persistent spec/plan/QA artifacts in `.auto-claude/`.

This is not a rewrite: the MVP is an **engine adapter layer** that lets the existing pipeline run with either:
- **Claude Code SDK** (current behavior)
- **Codex CLI** (new behavior; automation via `codex exec`)

## Goals

### Product goals
- Add a first‑class **Codex engine** for autonomous builds (spec → plan → implement → QA → merge).
- Preserve **ChatGPT login** flow for Codex; do not require API keys.
- Keep the existing `.auto-claude/` data model (spec folders, `implementation_plan.json`, QA reports, memory).
- Keep git worktree isolation and merge tooling intact.

### Engineering goals
- Introduce a stable “agent engine” abstraction so Auto‑Claude can support multiple runtimes without forking the whole codebase.
- Maintain backward compatibility for Claude Code users.

## Non‑Goals (MVP)
- Perfect parity with Claude Code’s “Task tool / subagents” parallelism.
- Codex Cloud / remote task browsing integration.
- Full multi‑account Codex profile switching parity (possible via `$CODEX_HOME`, but can be phase‑2).

## Constraints / Requirements

### Authentication (must‑have)
- Codex engine must run using **ChatGPT login** (Codex CLI “Sign in with ChatGPT”).
- No requirement for `OPENAI_API_KEY` / usage‑based billing keys.
- Auto‑Claude must be able to **detect** whether Codex is logged in before starting.

### Safety (must‑have)
- Codex engine must run under Codex’s sandbox & approvals (at least `--sandbox workspace-write`).
- Prefer Codex’s **execpolicy** rules for command allowlisting instead of Claude’s `PreToolUse` hooks.

### Usability (must‑have)
- The UI “Agent Terminals” feature must be able to launch the **Codex TUI** (not only Claude).

## Current Architecture (as‑is)

### Orchestrator and artifacts
- The Python orchestrator runs a **multi‑session loop** (fresh context per session) and stores durable state:
  - Specs, requirements, context: `.auto-claude/specs/<spec>/...`
  - Plan: `implementation_plan.json`
  - QA: `qa_report.md`, `QA_FIX_REQUEST.md`
  - Progress/status: `.auto-claude-status` (and statusline helper)
- Safety model: builds occur in a git worktree (`.worktrees/...`) and merge back after review.

### Where the project currently depends on Claude Code
1) **Auth**: `auto-claude/core/auth.py` requires `CLAUDE_CODE_OAUTH_TOKEN` (env / Keychain) and refuses `ANTHROPIC_API_KEY`.  
2) **Agent runtime**: `claude_agent_sdk` message streaming is assumed in core loops (`auto-claude/agents/session.py`, `auto-claude/spec/pipeline/agent_runner.py`, `auto-claude/core/client.py`).  
3) **Tools & hooks**: Claude tool names (`Read/Write/Edit/Glob/Grep/Bash`) + `PreToolUse` hook for command allowlisting (`auto-claude/security/hooks.py`).  
4) **Parallelism assumption**: prompts/tests reference Claude Code’s Task tool/subagents (`auto-claude/prompts/coder.md`, `tests/test_agent_architecture.py`).  
5) **Electron PTY integration**: UI launches `claude` TUI, handles `/exit`, captures session IDs, and parses Claude‑specific rate limit messages (`auto-claude-ui/src/main/terminal/claude-integration-handler.ts`).

## Codex CLI Capabilities (relevant)

### Authentication (ChatGPT login)
- Codex CLI supports “Sign in with ChatGPT” and stores credentials in `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`).
- `codex login status` is a fast gate to detect the login state.
- Config supports `forced_login_method = "chatgpt"` to prevent API‑key mode.

### Non‑interactive automation
- `codex exec` runs Codex non‑interactively.
- `codex exec --json` streams JSONL events (turns/items) suitable for UI/logging.
- `codex exec -o/--output-last-message <file>` writes the final assistant message to a file.
- `codex exec --output-schema <schema.json>` can enforce a structured JSON final output (useful for deterministic plan outputs).

### Safety model
- Sandbox: `--sandbox read-only|workspace-write|danger-full-access`
- Approvals: `--ask-for-approval untrusted|on-failure|on-request|never`
- Execpolicy: rules in `~/.codex/rules/*.rules` using `prefix_rule(...)` and validated with `codex execpolicy check`.

### MCP
- Codex supports `mcp_servers` configured via `~/.codex/config.toml` or managed via `codex mcp add/list/get/remove`.

## Proposed Solution: Agent Engine Abstraction + Codex Engine

### High‑level design
Introduce an internal abstraction:

```
Auto‑Claude pipeline (spec/planning/coding/QA/merge)
             |
             v
      AgentEngine (interface)
       /                 \
      v                   v
ClaudeSdkEngine     CodexCliEngine
```

The orchestrator stops depending on Claude SDK message types and instead consumes **normalized events** emitted by the selected engine.

### Engine interface (proposed)
Core concepts:
- **EngineRunOptions**
  - `cwd` (worktree/project dir)
  - `model` (engine-specific model string)
  - `sandbox_mode` / `approval_policy` (Codex only)
  - optional `output_schema_path` (Codex structured output)
  - `max_turns` / `timeout` (best effort)
- **EngineEvent** stream
  - `text` (assistant text)
  - `command_execution` (command, exit_code, output)
  - `file_change` (path(s), summary if available)
  - `mcp_tool_call` (tool name, args)
  - `plan_update` (optional; Codex `todo_list` item)
- **EngineResult**
  - `final_text` (canonical output)
  - `events` (optional captured, but streaming preferred)
  - `artifacts` (e.g., output-last-message path, raw jsonl log path)
  - `status` (success/failure + error)

### Codex engine details (MVP)
- Invoke Codex as a subprocess:
  - `codex exec --json -C <cwd> --sandbox workspace-write --ask-for-approval on-request -o <final.txt> "<prompt>"`
  - Add `-c forced_login_method="chatgpt"` to guarantee ChatGPT auth.
- Parse JSONL:
  - Map Codex item types → Auto‑Claude engine events:
    - `command_execution` → `EngineEvent.command_execution`
    - `file_change` → `EngineEvent.file_change`
    - `mcp_tool_call` → `EngineEvent.mcp_tool_call`
    - `agent_message`/text → `EngineEvent.text`
    - `todo_list` → `EngineEvent.plan_update` (optional)
- Persist logs:
  - Save the raw JSONL stream to `.auto-claude/logs/<spec>/codex-exec.jsonl` (or similar) for debugging and UI replay.

### Authentication gating (Codex)
- Before running any Codex build session:
  - Call `codex login status`
  - Require “Logged in using ChatGPT”
- Optional: allow a “login helper” UX in UI that runs `codex login` in a terminal.

### Security mapping (Codex execpolicy)
Auto‑Claude already computes a dynamic allowlist of shell commands based on project type. For Codex:
- Generate a rules file (example path):
  - `~/.codex/rules/auto-claude.rules` (or `$CODEX_HOME/rules/auto-claude.rules`)
- Write `prefix_rule(...)` entries for:
  - allow: safe read-only commands (`ls`, `cat`, `rg`, etc.)
  - prompt: potentially risky but common (`git push`, package installs, curl/wget, docker)
  - forbidden: destructive patterns (`rm -rf /`, shell escapes, etc.)
- Validate the rules:
  - `codex execpolicy check --rules <file> <command...>`

MVP can start with a small curated set of allow rules and expand toward parity with the existing security profile.

## UI Changes (Codex in Agent Terminals)

### Codex terminal mode
Add a Codex launcher alongside the existing Claude launcher:
- Launch `codex` (optionally `--cd <projectPath>`) inside the PTY.
- Exit using `/exit` (Codex supports this).
- Resume:
  - MVP: `codex resume --last` (no session-id capture required).

### Login flow
When engine is Codex:
- “Authenticate” opens a terminal running `codex login`.
- UI polls `codex login status` until logged in via ChatGPT.

### Rate limit / auth failure handling
Claude-specific parsing should not be reused for Codex. MVP approach:
- Treat “rate limit / usage limit / unauthorized” as generic error categories.
- Provide a UI banner with next steps (re-login / wait / switch account).

## Phased Delivery Plan (PRs)

### PR 1 — Engine abstraction (no behavior change)
- Add `auto-claude/engine/` with:
  - `events.py` (normalized event model)
  - `base.py` (interface + types)
  - `claude_sdk.py` (wrap existing Claude SDK flows behind the interface)
  - `factory.py` (select engine via config/env)
- Refactor call sites to use the engine interface while keeping Claude as default:
  - `auto-claude/spec/pipeline/agent_runner.py`
  - `auto-claude/agents/session.py`
  - QA entrypoints (`auto-claude/qa/*`)
- Add unit tests ensuring parity (text capture, tool logging still works).

### PR 2 — Codex CLI engine (backend MVP)
- Implement `auto-claude/engine/codex_cli.py`:
  - Spawn `codex exec --json` as subprocess
  - Parse JSONL → normalized events
  - Write output-last-message and raw jsonl logs
- Add Codex auth gating:
  - `auto-claude/core/codex_auth.py` (or extend `core/auth.py`)
  - New CLI flag `--engine codex` (or env `AUTO_CLAUDE_ENGINE=codex`)
- Add minimal execpolicy rule generation (optional for MVP; recommended):
  - `auto-claude/security/codex_execpolicy.py`

### PR 3 — Electron UI: Codex terminals + login
- Add `auto-claude-ui` terminal integration for Codex:
  - new `codex-integration-handler.ts` modeled after Claude handler
  - UI engine selector and login actions
- Keep Claude support intact.

### PR 4+ — Parallelism + merge AI parity
- Enable orchestrator-level parallel runs for Codex (worktree-based workers).
- Provide Codex-based AI merge resolver (or disable AI merge under Codex until stable).

## File‑by‑File Change Plan (Implementation Notes)

### Backend: new modules
- `auto-claude/engine/base.py` — `AgentEngine` interface + config types.
- `auto-claude/engine/events.py` — normalized `EngineEvent` model + helpers.
- `auto-claude/engine/factory.py` — engine selection (`claude` default, `codex` optional).
- `auto-claude/engine/claude_sdk.py` — wraps current Claude SDK client creation + streaming.
- `auto-claude/engine/codex_cli.py` — implements `codex exec` runner + JSONL parsing.

### Backend: refactors
- `auto-claude/core/client.py` — keep as Claude SDK implementation detail (moved/renamed in PR 1 or wrapped).
- `auto-claude/agents/session.py` — consume `EngineEvent`s rather than Claude SDK message types.
- `auto-claude/spec/pipeline/agent_runner.py` — use engine abstraction.
- `auto-claude/qa/loop.py`, `auto-claude/qa/reviewer.py`, `auto-claude/qa/fixer.py` — use engine abstraction.
- `auto-claude/merge/ai_resolver/*` — introduce engine-aware resolver selection (defer to phase 4 if needed).
- `auto-claude/cli/main.py` + `auto-claude/cli/utils.py` — add `--engine` and engine-specific validation (Codex login status).

### Backend: security/auth additions
- `auto-claude/core/codex_auth.py` — `require_codex_chatgpt_login()`.
- `auto-claude/security/codex_execpolicy.py` — generate rules file from project security profile.

### UI: new modules / changes
- `auto-claude-ui/src/main/terminal/codex-integration-handler.ts` — launch/resume/exit Codex sessions.
- `auto-claude-ui/src/main/terminal/*` — route terminal lifecycle to chosen engine.
- `auto-claude-ui/src/renderer/components/*` — engine selector + Codex login status (MVP minimal).

## Acceptance Criteria (Codex MVP)
- Running `python auto-claude/run.py --spec <spec> --engine codex`:
  - Verifies Codex logged in via ChatGPT
  - Executes planner/coder/QA sessions via Codex CLI
  - Updates `implementation_plan.json`, creates commits, writes QA reports
  - Supports merge workflow exactly as today
- Electron app:
  - Can open a terminal running `codex`
  - Provides a “Login with ChatGPT” action that runs `codex login` and confirms success

## Open Questions
- Should Codex become the default engine for new installs, or remain opt‑in behind `--engine`?
- How should model selection be mapped (Auto‑Claude phase models → Codex `--model`)? MVP can start with a single configured model.
- For multi-account support: do we standardize on `$CODEX_HOME` per profile (directories containing `auth.json/config.toml/rules/`)?

