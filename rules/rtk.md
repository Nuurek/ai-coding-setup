# rtk — token-efficient command output

## What it does

rtk (Rust Token Killer) is installed and wired into Claude Code via a `PreToolUse`
hook. Bash commands you run are transparently rewritten to their token-efficient
`rtk <cmd>` equivalents (e.g. `git status` → `rtk git status`), filtering and
compressing output to cut context usage 60–90%.

This happens automatically — you do not need to prefix commands with `rtk` yourself.

## Caveats

- The hook only applies to the **Bash** tool. Claude Code's built-in `Read`, `Grep`,
  and `Glob` bypass rtk, so they are unaffected.
- Run a command normally; rtk handles the rewrite.

## Meta commands

- `rtk gain` — show how many tokens rtk has saved
- `rtk discover` — list which commands rtk can optimize
