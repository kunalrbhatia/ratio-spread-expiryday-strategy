---
name: gh-pr-workflow
description: Automate the creation of feature branches, pushing code, and opening descriptive Pull Requests using the GitHub CLI (gh). Use this when finalizing a task and moving code to review.
---

# GitHub PR Workflow

This skill automates the process of moving code from your local environment to a Pull Request on GitHub.

## Workflow

### 1. Automated Branch, Push, and PR

Use this command sequence to handle the entire flow in one turn:

```powershell
git checkout -b <branch-name>; git add .; git commit -m "<conventional-commit-msg>"; git push -u origin <branch-name>; gh pr create --title "<pr-title>" --body "### Description\n<description>\n\n### Changes\n- <change-1>\n- <change-2>\n\n### Verification\n- <verification-results>"; node .agents/skills/verify-pr-status/scripts/verify-checks.cjs
```

## Guidelines

- **PR Lifecycle**: Always run the `verify-pr-status` check script immediately after creating a PR to monitor status until all checks resolve.
- **Branch Naming**: Use `feat/`, `fix/`, or `docs/` prefixes (e.g., `feat/new-api-endpoint`).
- **Commit Messages**: Always use **Conventional Commits** (e.g., `feat: add slack command listener`).
- **PR Titles**: Match the commit message or use a clear descriptive title.
- **PR Body**:
  - **Description**: What does this PR do?
  - **Changes**: Bulleted list of technical modifications.
  - **Verification**: Summarize test results, linting, and manual checks.

## Examples

### Feature Implementation

**Branch**: `feat/user-auth`
**PR Title**: `feat: implement jwt-based user authentication`
**PR Body**:

```markdown
### Description

Implements JWT authentication and protected routes.

### Changes

- Added auth middleware.
- Created login/register routes.
- Integrated bcrypt for password hashing.

### Verification

- `npm test` passed.
- Manual login verification successful.
```
