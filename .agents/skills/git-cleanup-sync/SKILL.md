---
name: git-cleanup-sync
description: Automated local git workspace cleanup. Deletes non-primary branches, removes associated worktrees, switches to the development/main branch, and pulls the latest remote changes. Use this after merging a feature or when starting a fresh session.
---

# Git Cleanup & Sync

This skill automates the cleanup of local feature branches and ensures your primary branch is synchronized with the remote repository.

## Workflow

### 1. Automatic Cleanup

Run the bundled script to perform a comprehensive cleanup:

- Switches to `development`, `main`, or `master`.
- Pulls latest changes from `origin`.
- Identifies all other local branches.
- Force-removes associated worktrees.
- Force-deletes the local branches.

```bash
node .agents/skills/git-cleanup-sync/scripts/cleanup.cjs
```

## Manual Safety Check

If you prefer to perform these steps manually:

1. `git checkout development` (or your primary branch)
2. `git pull origin development`
3. `git branch` (to list branches)
4. `git worktree list` (to check for linked worktrees)
5. `git branch -D <branch-name>`

## When to Use

- After a PR has been merged and deleted on the remote.
- When your local workspace is cluttered with old feature branches.
- At the start of a new task to ensure you are building on the latest code.
