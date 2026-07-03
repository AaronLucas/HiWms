#!/usr/bin/env node
/**
 * pre-commit hook to filter out generated/build files from commits
 * Reads .commitignore patterns and unstages matching files
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const minimatch = require('minimatch');

function loadPatterns() {
  const ignoreFile = '.commitignore';
  try {
    const raw = fs.readFileSync(ignoreFile, 'utf8');
    return raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#'));
  } catch {
    return [];
  }
}

function shouldStage(file, patterns) {
  return !patterns.some(pattern => minimatch(file, pattern));
}

async function main() {
  const patterns = loadPatterns();

  // Get staged files
  let stagedFiles = [];
  try {
    stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf8' })
      .split('\n')
      .map(f => f.trim())
      .filter(f => f.length > 0);
  } catch {
    stagedFiles = [];
  }

  if (stagedFiles.length === 0) {
    console.log('No staged files to check');
    process.exit(0);
  }

  const toCommit = stagedFiles.filter(f => shouldStage(f, patterns));
  const ignored = stagedFiles.filter(f => !shouldStage(f, patterns));

  if (ignored.length > 0) {
    console.warn('\n⚠️  The following files match .commitignore patterns and will NOT be committed:');
    ignored.forEach(f => console.warn(`   ${f}`));
    console.warn('');
  }

  if (toCommit.length === 0) {
    console.error('\n❌ All staged files are ignored by .commitignore. Nothing to commit.');
    console.error('   Use "git reset HEAD <file>" to unstage files, or update .commitignore\n');
    process.exit(1);
  }

  console.log('\n✅ Files to be committed:');
  toCommit.forEach(f => console.log(`   ${f}`));
  console.log('');

  // If there are ignored files, unstage them
  if (ignored.length > 0) {
    for (const file of ignored) {
      execSync(`git reset HEAD "${file}"`, { stdio: 'ignore' });
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Pre-commit hook error:', err);
  process.exit(1);
});