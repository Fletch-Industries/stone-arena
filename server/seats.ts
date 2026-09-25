/** One connection per tab identity, including its temporary reconnect reservation. */
export class SeatRegistry {
  private seats = new Map<string, { room: string; player: string }>();
  claim(key: string, room: string, player: string) {
    const seat = this.seats.get(key);
    if (seat && (seat.room !== room || seat.player !== player)) return false;
    this.seats.set(key, { room, player }); return true;
  }
  releasePlayer(room: string, player: string) { for (const [key, seat] of this.seats) if (seat.room === room && seat.player === player) this.seats.delete(key); }
  releaseRoom(room: string) { for (const [key, seat] of this.seats) if (seat.room === room) this.seats.delete(key); }
}
