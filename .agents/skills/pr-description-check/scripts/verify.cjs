#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

function verifyDescription(text) {
  // We want to find any forward or backward slash that is NOT inside backticks.
  // We can do this by splitting the text by backtick pairs, and checking the text outside.

  // A simple way is to remove all backtick-enclosed blocks first.
  const withoutBackticks = text.replace(/`[^`]*`/g, '');

  // Also ignore URLs
  const withoutUrls = withoutBackticks.replace(/https?:\/\/[^\s]+/g, '');

  // Ignore HTML closing tags like </div>
  const withoutHtml = withoutUrls.replace(/<\/[a-zA-Z0-9]+>/g, '');

  // Look for words that contain a slash or backslash, which might be a path or a command.
  const pathOrCommandRegex = /(?:^|\s)([\w-]*[/\\][\w./-]+)(?:\s|$|[.,!?])/g;

  let match;
  let issues = [];
  while ((match = pathOrCommandRegex.exec(withoutHtml)) !== null) {
    // Ignore simple "and/or" text if desired, but in a strict check we flag it.
    let suspect = match[1];

    // Trim trailing punctuation that might have been caught
    suspect = suspect.replace(/[.,!?]+$/, '');

    // Ignore common non-code uses like "N/A", "and/or", etc.
    if (['and/or', 'n/a', 'c/c++'].includes(suspect.toLowerCase())) continue;

    issues.push(suspect);
  }

  return issues;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node verify.cjs <path-to-pr-description.md>');
  process.exit(1);
}

const filePath = path.resolve(args[0]);
if (!fs.existsSync(filePath)) {
  console.error(`Error: File not found at ${filePath}`);
  process.exit(1);
}

// Read the file. If it was created via PowerShell '>', it might be UTF-16LE.
// Reading it as UTF-8 will introduce null bytes (\0). We strip them here.
let content = fs.readFileSync(filePath, 'utf8');
content = content.replace(/\0/g, '');

const issues = verifyDescription(content);

if (issues.length > 0) {
  console.error('❌ PR Description Check Failed!');
  console.error(
    'The following commands or file paths were found without backticks:',
  );
  issues.forEach(issue => console.error(`  - ${issue}`));
  console.error(
    '\nPlease wrap commands, file paths, and code snippets in backticks (`).',
  );
  process.exit(1);
} else {
  console.log(
    '✅ PR Description Check Passed! All paths and commands appear to be properly formatted with backticks.',
  );
  process.exit(0);
}
