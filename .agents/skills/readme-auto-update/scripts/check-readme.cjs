#!/usr/bin/env node
const { execSync } = require('child_process');

try {
  const baseRef = process.env.GITHUB_BASE_REF;
  let diffCommand = 'git diff --cached --name-only';

  if (baseRef) {
    console.log(`Running in PR mode against base branch: origin/${baseRef}`);
    diffCommand = `git diff --name-only origin/${baseRef}...HEAD`;
  }

  // Get changed files
  const changedFiles = execSync(diffCommand, { encoding: 'utf8' })
    .split('\n')
    .map(f => f.trim())
    .filter(Boolean);

  if (changedFiles.length === 0) {
    console.log('No files changed.');
    process.exit(0);
  }

  // Check if README.md is in changed files
  const isReadmeUpdated = changedFiles.some(f => f.toLowerCase() === 'readme.md');

  // Check if any source code or config files are modified
  const hasCoreChanges = changedFiles.some(f => {
    return f.startsWith('src/') || f === 'package.json' || f === '.env.example' || f === 'initialize.sh';
  });

  if (hasCoreChanges && !isReadmeUpdated) {
    console.error('\n❌ README Verification Failed!');
    console.error('You have modified core application files or configurations, but README.md has not been updated.');
    console.error('Please update README.md to document your changes (e.g. new commands, configurations, environment variables, or logic).');
    console.error('If the changes do not require a README update, you can bypass this check using git commit --no-verify\n');
    process.exit(1);
  }

  console.log('✅ README Verification Passed!');
  process.exit(0);
} catch (error) {
  console.error('Error running README verification:', error.message);
  process.exit(1);
}
