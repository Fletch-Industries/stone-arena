#!/usr/bin/env node
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const command = process.argv[2];
if (!['on', 'off', 'status'].includes(command) || process.argv.length !== 3) {
  console.error('Usage: npm run game -- on|off|status (on = playable, off = unavailable)');
  process.exit(1);
}
const flag = resolve(process.env.ARENA_MAINTENANCE_FILE ?? '.arena-maintenance');
if (command === 'off') {
  mkdirSync(dirname(flag), { recursive: true });
  const temporary = `${flag}.${process.pid}.tmp`;
  writeFileSync(temporary, `Disabled at ${new Date().toISOString()}\n`, { mode: 0o600 });
  renameSync(temporary, flag);
} else if (command === 'on') rmSync(flag, { force: true });
console.log(`Game ${existsSync(flag) ? 'OFF — temporarily unavailable' : 'ON — playable'} (${flag})`);
