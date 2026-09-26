import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep this outside the release directory in production so deployments preserve it.
const flag = resolve(process.env.ARENA_MAINTENANCE_FILE ?? '.arena-maintenance');
export const unavailableMessage = 'Stone Arena is temporarily unavailable. Do your school and chores, then check back later.';
export const isUnavailable = () => existsSync(flag);
