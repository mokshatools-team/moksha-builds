# Repository Guidelines

## Project Structure & Module Organization
This workspace contains three independent apps, each with its own `.git` directory and local workflow. `text-overlay-assistant/` is a Flask app with `app.py`, Jinja templates in `templates/`, and tests in `tests/`. `video-post-studio/` is a modular Flask shell with backend code under `app/` (`models/`, `routes/`, `services/`) and tests in `tests/`. `osteopeinture-quote-assistant/` is a Node/Express app with `server.js`, static assets in `public/`, persisted data in `data/`, and email-parsing utilities in `past-quotes/`.

## Build, Test, and Development Commands
Run commands from the target project directory, not the workspace root.

- `cd text-overlay-assistant && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt` sets up the Python app.
- `cd text-overlay-assistant && python app.py` starts the local server on port `5000`.
- `cd text-overlay-assistant && python -m unittest discover -s tests` runs route and transcript tests.
- `cd video-post-studio && python3 -m venv venv && ./venv/bin/pip install -r requirements.txt` installs the shell app dependency set.
- `cd video-post-studio && ./venv/bin/python run.py` runs the Flask shell locally.
- `cd video-post-studio && ./venv/bin/python -m unittest discover -s tests` runs the current contract and route suite.
- `cd osteopeinture-quote-assistant && npm install && npm start` starts the quoting assistant. There is no real automated test script there yet.

## Coding Style & Naming Conventions
Follow existing file-local conventions. Python code uses 4-space indentation, module docstrings, snake_case functions, and `test_*.py` filenames. JavaScript in `osteopeinture-quote-assistant/` uses 2-space indentation, CommonJS `require(...)`, and camelCase helpers. Keep new modules small and place them beside the feature they support (`app/services/`, `tests/`, `public/`).

## Testing Guidelines
Add or update unit tests for behavior changes in the two Flask projects. Prefer `unittest`-style assertions and name test methods descriptively, for example `test_import_post_adds_source_to_workspace`. For the Node app, document manual verification steps in the PR until a real test harness exists.

## Commit & Pull Request Guidelines
Recent history favors conventional prefixes such as `feat:`, `fix:`, `docs:`, `refactor:`, and `test:`. Keep commits scoped to one project and one concern. PRs should state which subproject changed, summarize user-visible behavior, list verification commands, and include screenshots for UI edits in `templates/` or `public/`.

## Security & Configuration Tips
Do not commit live secrets. This workspace already contains local-only files such as `.env`, `token.json`, `client_secrets.json`, and `cookies.txt`; treat them as machine-specific and sanitize examples before sharing.
