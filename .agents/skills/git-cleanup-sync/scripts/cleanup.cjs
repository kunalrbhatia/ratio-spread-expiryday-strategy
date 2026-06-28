#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
const { execSync } = require('child_process');

try {
  // Get current branch
  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD')
    .toString()
    .trim();

  // Define primary branches
  const primaryBranches = ['development', 'main', 'master'];

  // Ensure we are on a primary branch
  let targetBranch = primaryBranches.find(b => {
    try {
      execSync(`git rev-parse --verify ${b}`, { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  });

  if (!targetBranch) {
    console.error(
      'Error: No primary branch (development, main, master) found.',
    );
    process.exit(1);
  }

  if (currentBranch !== targetBranch) {
    console.log(`Switching to ${targetBranch}...`);
    execSync(`git checkout ${targetBranch}`);
  }

  console.log(`Pulling latest changes for ${targetBranch}...`);
  execSync(`git pull origin ${targetBranch}`);

  // Get all local branches
  const branches = execSync('git branch --format="%(refname:short)"')
    .toString()
    .trim()
    .split('\n');

  // Filter out primary branches and current branch
  const branchesToDelete = branches.filter(b => !primaryBranches.includes(b));

  if (branchesToDelete.length === 0) {
    console.log('No feature branches found to delete.');
  } else {
    for (const branch of branchesToDelete) {
      console.log(`Deleting branch: ${branch}...`);
      try {
        // Try deleting worktrees first if any
        const worktrees = execSync('git worktree list --porcelain')
          .toString()
          .trim()
          .split('\n\n');
        for (const wt of worktrees) {
          if (wt.includes(`branch refs/heads/${branch}`)) {
            const path = wt.split('\n')[0].replace('worktree ', '');
            console.log(`Removing worktree at ${path}...`);
            execSync(`git worktree remove "${path}" --force`);
          }
        }
        execSync(`git branch -D ${branch}`);
      } catch (e) {
        console.error(`Failed to delete branch ${branch}: ${e.message}`);
      }
    }
    console.log('Cleanup complete.');
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
