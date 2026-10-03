import { Excavation, SCULPT, type ExcavationState, type ExcavationChanges, type CutTuple, type StoneCell } from './excavation.js';

export const STONE_SYNC = { rows: 128, packets: 4, timeout: 15000, bufferedEdits: 256 } as const;
export type StonePacket =
  | { type: 'begin'; token: number; seed: number; revision: number; cuts: number; veins: number }
  | { type: 'chunk'; token: number; kind: 'cuts' | 'veins'; offset: number; cells: (CutTuple | StoneCell)[] }
  | { type: 'commit'; token: number };
/** A captured revision is paced separately from the live, ordered change stream. */
export function* stonePackets(state: ExcavationState, token: number): Generator<StonePacket> {
  yield { type: 'begin', token, seed: state.seed, revision: state.revision, cuts: state.cuts.length, veins: state.veins.length };
  for (const kind of ['cuts', 'veins'] as const) for (let offset = 0; offset < state[kind].length; offset += STONE_SYNC.rows)
    yield { type: 'chunk', token, kind, offset, cells: state[kind].slice(offset, offset + STONE_SYNC.rows) };
  yield { type: 'commit', token };
}
export class StoneReceiver {
  private transfer?: { token: number; at: number; state: ExcavationState; cuts: number; veins: number; changes: ExcavationChanges[]; edits: number };
  get active() { return !!this.transfer; }
  clear() { this.transfer = undefined; }
  expire(now: number) { if (this.transfer && now - this.transfer.at > STONE_SYNC.timeout) { this.clear(); return true; } return false; }
  changes(changes: ExcavationChanges) {
    const transfer = this.transfer;
    if (!transfer || !changes || changes.seed !== transfer.state.seed || !Array.isArray(changes.edits) || !changes.edits.length || changes.edits.length > 64 || (transfer.edits += changes.edits.length) > STONE_SYNC.bufferedEdits) { this.clear(); return false; }
    transfer.changes.push(changes); return true;
  }
  receive(packet: StonePacket, now: number): { seed: number; excavation: Excavation } | false | undefined {
    const fail = () => { this.clear(); return false as const; };
    if (!packet || !Number.isSafeInteger(packet.token) || packet.token < 0) return fail();
    if (packet.type === 'begin') {
      if (![packet.cuts, packet.veins, packet.seed, packet.revision].every(Number.isInteger) || packet.cuts < 0 || packet.cuts > SCULPT.roomLimit || packet.veins < 0 || packet.veins > SCULPT.veinLimit || packet.seed < 0 || packet.seed > 0xffffffff || packet.revision < 0 || packet.revision >= 2 ** 31) return fail();
      this.transfer = { token: packet.token, at: now, state: { seed: packet.seed, revision: packet.revision, cuts: [], veins: [] }, cuts: packet.cuts, veins: packet.veins, changes: [], edits: 0 }; return;
    }
    const transfer = this.transfer;
    if (!transfer || packet.token !== transfer.token || now - transfer.at > STONE_SYNC.timeout) return fail();
    if (packet.type === 'chunk') {
      if (packet.kind !== 'cuts' && packet.kind !== 'veins') return fail();
      const rows = transfer.state[packet.kind];
      if (!Array.isArray(packet.cells) || !packet.cells.length || packet.cells.length > STONE_SYNC.rows || packet.offset !== rows.length || rows.length + packet.cells.length > transfer[packet.kind] || packet.cells.some(row => !Array.isArray(row) || row.length !== (packet.kind === 'cuts' ? 4 : 3))) return fail();
      if (packet.kind === 'cuts') transfer.state.cuts.push(...packet.cells as CutTuple[]); else transfer.state.veins.push(...packet.cells as StoneCell[]); return;
    }
    if (packet.type !== 'commit' || transfer.state.cuts.length !== transfer.cuts || transfer.state.veins.length !== transfer.veins) return fail();
    const replacement = new Excavation();
    if (!replacement.restore(transfer.state) || transfer.changes.some(changes => !replacement.apply(changes))) return fail();
    this.clear(); return { seed: transfer.state.seed, excavation: replacement };
  }
}
