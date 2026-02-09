# Repository Guidelines

## Project Structure and Module Organization
- `apps/backend/` holds the Python backend (agents, services, runners, security tooling).
- `apps/frontend/` contains the Electron + React UI (`src/main/`, `src/renderer/`, `resources/`).
- `tests/` is the Python pytest suite; frontend tests live under `apps/frontend/src/**/__tests__/`.
- `scripts/` includes repo automation (install/test helpers); `shared_docs/` and `guides/` document architecture and usage.

## Build, Test, and Development Commands
- `npm run install:all` installs backend and frontend dependencies.
- `npm run dev` launches the Electron UI in dev mode with hot reload.
- `npm start` builds the UI and starts the app.
- `npm run test:backend` runs the Python test suite via the repo runner.
- `npm test` (Vitest), `npm run lint` (ESLint), and `npm run typecheck` (TypeScript) validate the frontend.
- `npm run package` builds a distributable app; platform builds are `package:mac`, `package:win`, `package:linux`.

## Coding Style and Naming Conventions
- Python is linted and formatted with Ruff in `apps/backend/` (4-space indents, double quotes per `ruff.toml`).
- TypeScript/React code is linted with ESLint in `apps/frontend/`.
- Python tests use `test_*.py` names (see `pytest.ini`); frontend tests use `*.test.ts` or `__tests__/`.
- Keep module names descriptive and match existing folder groupings like `apps/backend/runners/` or `apps/backend/services/`.

## Testing Guidelines
- Backend tests run with pytest; markers include `slow` and `integration` (example: `npm run test:backend -- -m "not slow"`).
- Frontend unit tests run with Vitest (`npm test`); E2E tests use Playwright (`npm run test:e2e`, requires a build).
- New features should include tests; bug fixes should add a regression test.

## Commit and Pull Request Guidelines
- Commit messages follow a type prefix such as `feat:`, `fix:`, `docs:`, `test:`, `chore:` (see `git log`).
- Branch from `develop` and target `develop` in PRs; use prefixes like `feature/` or `fix/`.
- PRs should include a clear description, linked issues, and screenshots for UI changes.
- Rebase onto `develop` before opening a PR and avoid WIP commits.

## Security and Configuration Tips
- Use `.env.example` in `apps/backend/` or `apps/frontend/` as a starting point for local config.
- Never commit secrets or local credentials.
