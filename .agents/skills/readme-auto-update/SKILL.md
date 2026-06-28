---
name: readme-auto-update
description: Automates and verifies updating the README.md file whenever core application changes are made in a commit or PR.
---

# README Auto Update & Verification

This skill helps ensure that `README.md` is kept up-to-date with any changes made to the codebase. It provides a verification script that fails if core files are modified but `README.md` is not updated.

## Usage

### Verification Check
To check if the README needs to be updated based on staged changes, run:
```bash
node .agents/skills/readme-auto-update/scripts/check-readme.cjs
```

### Auto-Updating Workflow
When you perform edits, the agent should follow these steps:
1. Examine the git log and diffs to identify what features or modifications were introduced.
2. Update the corresponding sections in `README.md`.
3. Verify that the changes conform to the document structure.
