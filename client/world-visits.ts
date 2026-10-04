export interface WorldInvite { id: string; title: string }
type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;
export const validInvite = (a: unknown): a is WorldInvite => !!a && typeof a === 'object' && typeof (a as WorldInvite).id === 'string' && /^[a-f0-9]{32}$/.test((a as WorldInvite).id) && typeof (a as WorldInvite).title === 'string' && (a as WorldInvite).title.length > 0 && (a as WorldInvite).title.length <= 32 && !/[\u0000-\u001f<>]/.test((a as WorldInvite).title);

/** Browser-only player profiles and world invites, with no client-supplied positions. */
export class WorldVisits {
  entries: WorldInvite[] = [];
  available = true;
  private profiles = new Map<string, string>();
  private storage?: VisitStorage;
  constructor(storage?: VisitStorage, private random: () => string = () => crypto.randomUUID()) {
    try {
      this.storage = storage ?? localStorage;
      const text = this.storage.getItem('stone-world-visits-v1'); if (!text || text.length > 32_000) return;
      const data = JSON.parse(text);
      if (!data || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 16 || !Array.isArray(data.profiles) || data.profiles.length > 32) return;
      this.entries = data.entries.filter(validInvite).map((p: WorldInvite) => ({ id: p.id, title: p.title }));
      for (const row of data.profiles) if (Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && row[0].length <= 24 && typeof row[1] === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(row[1])) this.profiles.set(row[0], row[1]);
    } catch { this.available = false; }
  }
  playerKey(name: string) {
    const profile = name.trim().slice(0, 24).toLowerCase(); let key = this.profiles.get(profile);
    if (!key) { key = this.random(); this.profiles.set(profile, key); if (this.profiles.size > 32) this.profiles.delete(this.profiles.keys().next().value!); this.persist(); }
    return key;
  }
  remember(invite: WorldInvite) {
    if (!validInvite(invite)) return;
    if (this.entries[0]?.id === invite.id && this.entries[0].title === invite.title) return;
    this.entries = [{ id: invite.id, title: invite.title }, ...this.entries.filter(p => p.id !== invite.id)].slice(0, 16); this.persist();
  }
  private persist() { try { this.storage?.setItem('stone-world-visits-v1', JSON.stringify({ version: 1, entries: this.entries, profiles: [...this.profiles] })); this.available = !!this.storage; } catch { this.available = false; } }
}
