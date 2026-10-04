import type { KeepStatus } from '../shared/world-keep.js';
import type { WorldBookmark } from './world-keeps.js';

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const labels: Record<KeepStatus['state'], string> = {
  disabled: 'Online saving is unavailable here. Keep a downloaded world file.',
  off: 'Online saving is off for this arena. You can keep it online again.',
  saving: 'Keeping your world online…',
  saved: 'World kept online · Builds, tunnels and discoveries survive server restarts.',
  error: 'Online saving did not finish. Download this world before leaving.',
  full: 'Online world storage is full. Download this world before leaving.',
};
export function onlineWorldsPanel(entries: WorldBookmark[], available: boolean, status: KeepStatus | undefined, isHost: boolean, canContinue: boolean, disabled: boolean) {
  const current = isHost && status;
  return `<div class="online-worlds"><h3>Online worlds</h3>${current ? `<p class="help" role="status">${labels[current.state]}</p>${current.state !== 'disabled' ? `<button class="btn wide" data-action="checkpoint-world" ${disabled || current.state === 'saving' ? 'disabled' : ''}>${current.state === 'off' ? 'Keep this world online' : 'Save online now'}</button>` : ''}${current.handle && current.summary ? `<details class="world-remove"><summary>Remove this world’s online copy</summary><p class="help">Download this world first if you want to keep it. This removes the online checkpoints; your current arena and browser memory remain.</p><button class="btn" data-action="forget-online-world" ${disabled || current.state === 'saving' ? 'disabled' : ''}>Remove online copy</button></details>` : ''}` : ''}${available ? '' : '<p class="help" role="status">This browser cannot remember online worlds. Keep a downloaded file before leaving.</p>'}<p class="help">Continue from the home screen with a nickname to open a fresh lobby in your saved landscape. These private bookmarks stay in this browser. Keep a download to move a world to another device or recover after clearing browser storage.</p><div class="world-memories" aria-label="Saved online worlds">${entries.map(({ summary: s }) => `<div class="world-memory"><div><b>${escape(s.title)}</b><small>${s.runes} runes · ${s.openings} openings · ${new Date(s.savedAt).toLocaleDateString()}</small></div><button class="btn" data-action="continue-world" data-keep="${s.id}" ${canContinue ? '' : 'disabled'}>Continue</button></div>`).join('') || '<p class="help">Your first online world appears here after you create an arena.</p>'}</div></div>`;
}
