/**
 * The 🐔 in each player's house (docs/game-rules.md §5.3): they pay a ball a minute in silence, so
 * the balances the bot shows fall behind between readings. Kept by the game state
 * (modules/norelec/src/state/game-state.ts) and read by `/stats`
 *.
 */
import { type GameEvent } from '#src/game/events.ts';
import { emojiKind, type PlayerRef } from '#src/game/player.ts';

const HEN = '🐔';
const isHen = (x: string | undefined): boolean => x !== undefined && emojiKind(x) === HEN;
const hens = (slots: readonly (string | null)[] | undefined): number =>
  (slots ?? []).filter((c) => c !== null && isHen(c)).length;

/**
 * The 🐔 in each player's house, as the log shows them: a `/house` or `/profile` sets the count, and
 * the lines between move it. A house never read starts from 0. What the log cannot tell apart is
 * settled by the player's carried slots as last listed: a 🐔 given leaves them first if one is there
 * (as the bot takes it, docs/game-rules.md §6), and so does one burnt or bombed. A purchase into a
 * named slot replaces what was there unseen: a 🐔 bought over another one counts twice until the
 * house is read again.
 */
export class HenCount {
  private readonly count = new Map<string, number>();
  private readonly carried = new Map<string, readonly (string | null)[]>();

  /** The 🐔 in `name`'s house now. */
  in(name: string): number {
    return this.count.get(name) ?? 0;
  }

  /** The players whose 🐔 are counted, with their count. */
  entries(): IterableIterator<[string, number]> {
    return this.count.entries();
  }

  /** Takes the events of one bot message. */
  apply(events: readonly GameEvent[]): void {
    const victim = events.find((e) => e.kind === 'theft')?.victim.name;
    for (const e of events) {
      switch (e.kind) {
        case 'house':
          this.count.set(e.player.name, hens(e.slots));
          break;
        case 'profile':
          if (e.hens !== undefined) this.count.set(e.player.name, e.hens);
          break;
        case 'bought':
          if (!e.carried && isHen(e.emoji)) this.add(e.player.name, 1);
          break;
        case 'moved':
          // `/take` sends home the 🐔 it swaps; `/store` puts one in, `/take` one out.
          if (isHen(e.emoji)) this.add(e.player.name, e.carried ? -1 : 1);
          if (e.carried && isHen(e.swapped)) this.add(e.player.name, 1);
          break;
        case 'pirate':
          if (isHen(e.emoji) && victim !== undefined) this.add(victim, -1);
          break;
        case 'giftDelivered':
          if (isHen(e.emoji)) this.add(e.to.name, 1);
          break;
        case 'depart':
          if (e.gift && isHen(e.load)) this.leave(e.player.name);
          break;
        case 'bombAtHome':
          if (isHen(e.destroyed)) this.leave(e.victim.name);
          break;
        case 'burned':
          if (isHen(e.what)) this.leave(e.player.name);
          break;
        default:
          break;
      }
    }
    // The carried slots as last listed: next to a name, or as a profile or a 🏴‍☠️ lists them.
    for (const e of events) {
      for (const ref of Object.values(e))
        if (typeof ref === 'object' && ref !== null && 'name' in ref) {
          const r = ref as PlayerRef;
          if (r.carried !== undefined) this.carried.set(r.name, r.carried);
        }
      if (
        (e.kind === 'profile' || e.kind === 'pirate') &&
        e.carried !== undefined &&
        e.player !== undefined
      )
        this.carried.set(e.player.name, e.carried);
    }
  }

  private add(name: string, delta: number): void {
    this.count.set(name, Math.max(0, this.in(name) + delta));
  }

  /** A 🐔 left the player: from the carried slots if they hold one, else from the house. */
  private leave(name: string): void {
    if (hens(this.carried.get(name)) === 0) this.add(name, -1);
  }
}
