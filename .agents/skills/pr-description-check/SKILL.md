---
name: pr-description-check
description: Verifies that PR descriptions follow the project's formatting rules, specifically ensuring that file paths, commands, and code snippets use backticks instead of slashes.
---

# PR Description Checker

This skill ensures that PR descriptions adhere to the formatting guidelines defined in the project. Specifically, it verifies that backticks (\`) are used to enclose commands and file paths, rather than leaving them exposed with slashes (`/` or `\`).

## Usage

You can use the bundled Node script to verify a PR description stored in a file.

```bash
node .agents/skills/pr-description-check/scripts/verify.cjs <path-to-pr-description.md>
```

### Example

1. Save your PR description to a temporary file, e.g., `pr-body.txt`.
2. Run the verifier:
   ```bash
   node .agents/skills/pr-description-check/scripts/verify.cjs pr-body.txt
   ```
3. If it outputs errors, update the file wrapping the flagged paths and commands in backticks (e.g., change `src/app.ts` to \`src/app.ts\`), and run the check again.

## Guidelines

- **Paths**: `src/routes/api.ts` ❌ ➔ \`src/routes/api.ts\` ✅
- **Commands**: `/check` ❌ ➔ \`/check\` ✅
- **Code**: `console.log()` ❌ ➔ \`console.log()\` ✅
