// Builds the seed distros.db by replaying the first-parent git history of distros.json through catalog.js.
// Run once at the cutover. It refuses to replace a database that holds writes made after the import.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordRevisions } from './catalog.js';

const root = fileURLToPath(new URL('..', import.meta.url));

if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
  throw new Error('import-history.js needs the full history; fetch it with git fetch --unshallow');
}
const commits = listCommits();
const texts = readSnapshots(commits);
const revisions = commits.flatMap((commit, index) => {
  const catalog = parseSnapshot(texts[index]);
  return catalog ? [{ catalog, subject: commit.subject, recordedAt: commit.time, commitSha: commit.sha }] : [];
});
const recorded = recordRevisions(revisions, { fresh: true });
console.log(`Imported ${recorded} revisions from ${commits.length} commits; ` +
  `${commits.length - revisions.length} unreadable or deleted, ${revisions.length - recorded} without a catalog change`);

/**
 * Runs git in the repository root.
 * @param {...string} args
 * @returns {string} stdout
 */
function git(...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 });
}

/**
 * Lists the first-parent commits that touched distros.json, oldest first.
 * @returns {{sha: string, time: number, subject: string}[]}
 */
function listCommits() {
  const log = git('log', '--first-parent', '--reverse', '--no-show-signature', '--format=%H %ct %s', 'HEAD', '--', 'distros.json');
  return log.split('\n').filter(Boolean).map(line => {
    const [sha, time] = line.split(' ', 2);
    return { sha, time: Number(time), subject: line.slice(sha.length + time.length + 2) };
  });
}

/**
 * Reads distros.json as it was at each commit.
 * @param {{sha: string}[]} commits
 * @returns {(string|null)[]} file contents, null where the commit deleted distros.json
 */
function readSnapshots(commits) {
  const input = commits.map(commit => `${commit.sha}:distros.json\n`).join('');
  const out = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input, maxBuffer: 1 << 30 });
  let offset = 0;
  return commits.map(() => {
    const end = out.indexOf('\n', offset);
    const [, type, size] = out.toString('utf8', offset, end).split(' ');
    offset = end + 1;
    if (type !== 'blob') return null;
    const text = out.toString('utf8', offset, offset + Number(size));
    offset += Number(size) + 1;
    return text;
  });
}

/**
 * Parses a historical snapshot, which may predate keys such as per-distro trackers.
 * @param {string|null} text
 * @returns {object|null} the catalog, or null when it is not valid JSON or lacks named distros with versions arrays
 */
function parseSnapshot(text) {
  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch {
    return null;
  }
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const valid = isObject(catalog) && Array.isArray(catalog.distros) && catalog.distros.every(distro =>
    isObject(distro) && typeof distro.name === 'string' && Array.isArray(distro.versions) && distro.versions.every(isObject));
  return valid ? catalog : null;
}
