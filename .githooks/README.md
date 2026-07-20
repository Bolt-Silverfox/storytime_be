# Git hooks

Shared hooks for this repo, enabled via `core.hooksPath` (set automatically by the
`prepare` script on `pnpm install`).

## pre-push — CodeRabbit local review
Runs a CodeRabbit review of your changes before each push so issues are caught
locally instead of on the PR.

- **Advisory by default** — it prints findings but does not block the push.
- **Make it blocking:** `CODERABBIT_BLOCK=1 git push`
- **Skip once:** `git push --no-verify`
- **Requires the CodeRabbit CLI** (the hook no-ops with a hint if it's missing):
  ```sh
  curl -fsSL https://cli.coderabbit.ai/install.sh | sh
  coderabbit auth login
  ```

If hooks aren't running, enable them manually once: `git config core.hooksPath .githooks`
