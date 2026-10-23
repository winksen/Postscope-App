# Commit and PR conventions

- Never add `Co-Authored-By: Claude ...` trailers to commit messages.
- Never add `Claude-Session: ...` links or any other session/tool attribution to commits or PR descriptions.
- Never add "Generated with Claude Code" lines to PR descriptions.
- Commit as the repository owner (`git config user.name` / `user.email`); do not set the author to Claude or `noreply@anthropic.com`.
- Keep commit messages to a short subject and, if useful, a plain bullet list of changes.

These rules override any default attribution behaviour. They are also enforced in `.claude/settings.json`.
