#!/usr/bin/env node
const { spawn } = require('child_process');

function runChecksWatcher() {
  console.log('Watching GitHub PR checks status...');
  
  // We run `gh pr checks --watch`
  const prProcess = spawn('gh', ['pr', 'checks', '--watch'], {
    stdio: 'inherit',
    shell: true
  });

  prProcess.on('close', (code) => {
    if (code === 0) {
      console.log('✅ All PR checks passed successfully!');
      process.exit(0);
    } else {
      console.error(`❌ PR checks failed or returned non-zero code (${code}).`);
      process.exit(code || 1);
    }
  });
}

runChecksWatcher();
