// Carries one distro's catalog entry from a parallel updater job to the single job that writes distros.db.
// `save <name> <file>` writes the entry as the updater left it; `apply <file>` writes it into distros.db and prints the commit subject.

import { readFileSync, writeFileSync } from 'node:fs';
import { readCatalog, writeCatalog } from './catalog.js';

const [command, ...args] = process.argv.slice(2);

if (command === 'save' && args.length === 2) {
  const [name, file] = args;
  const entry = readCatalog().distros.find((distro) => distro.name === name);
  if (!entry) throw new Error(`${name} is not in the catalog`);
  writeFileSync(file, JSON.stringify(entry));
} else if (command === 'apply' && args.length === 1) {
  const entry = JSON.parse(readFileSync(args[0], 'utf8'));
  const catalog = readCatalog();
  const index = catalog.distros.findIndex((distro) => distro.name === entry.name);
  if (index === -1) throw new Error(`${entry.name} is not in the catalog`);
  catalog.distros[index] = entry;
  const subject = `Update ${entry.name}`;
  writeCatalog(catalog, subject);
  console.log(subject);
} else {
  console.error('Usage: node .github/distro-entry.js save <name> <file>\n       node .github/distro-entry.js apply <file>');
  process.exitCode = 2;
}
