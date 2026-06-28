---
name: verify-pr-status
description: Watches and verifies that all GitHub PR checks complete and pass successfully before concluding a PR lifecycle.
---

# Verify PR Status

This skill monitors active GitHub pull request checks and blocks until they are fully resolved (passed or failed).

## Usage

Run the monitor script to track the current branch's PR status:
```bash
node .agents/skills/verify-pr-status/scripts/verify-checks.cjs
```

The script will:
1. Fetch and print the status of active checks on GitHub.
2. Watch the status, updating in real time.
3. Exit with status `0` if all checks succeed, or `1` if any check fails.
