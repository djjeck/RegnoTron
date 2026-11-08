import { describe, expect, it } from 'vitest';
import { parseMessage } from '#src/game/parse-message.ts';
import { address, GameState } from '#src/state/game-state.ts';
import { type StoredAccounts, TelegramAccounts } from './norelec-accounts.ts';

const msg = (time: number, text: string) => ({ time, text, events: parseMessage(text) });

/** A document in memory, counting its writes. */
function doc(initial?: StoredAccounts) {
  const d = { value: initial, writes: 0 };
  return {
    d,
    read: () => d.value,
    write: (v: StoredAccounts) => {
      d.value = v;
      d.writes++;
    },
  };
}

describe('TelegramAccounts', () => {
  it('reads the accounts from the whole log once, keeps them, and marks them in a new state', () => {
    const kept = doc();
    const first = new TelegramAccounts(kept);
    expect(first.kept).toBe(false);
    first.backfill([
      msg(0, 'Juno (🎈) hai bucato il palloncino di @Gianpier il lombardo (🎈)!'),
      msg(1, 'Mirco777 parti per Juno: arrivi tra 10 secondi. Casa tua resta scoperta.'),
    ]);
    expect(first.list()).toEqual(['Gianpier']);
    // After a restart, whatever the replayed hours show.
    const again = new TelegramAccounts(kept);
    expect(again.kept).toBe(true);
    const g = new GameState();
    again.apply(g);
    expect(address(g, 'Gianpier')).toBe('@Gianpier');
    expect(address(g, 'Juno')).toBe('Juno');
  });

  it('keeps what the state learns, and drops an account a refusal showed to be IRC', () => {
    const kept = doc({ names: ['Gianpier', 'Gone'] });
    const accounts = new TelegramAccounts(kept);
    const g = new GameState();
    accounts.apply(g);
    g.players.delete('Gone');
    g.apply(msg(0, 'Juno (🎈) hai bucato il palloncino di @Mirco777 (🎈)!'));
    accounts.sync(g);
    expect(kept.d.value).toEqual({ names: ['Gianpier', 'Gone', 'Mirco777'] });
    g.apply(msg(1, 'alice non conosco nessun giocatore di nome @Mirco777.'));
    accounts.sync(g);
    expect(kept.d.value).toEqual({ names: ['Gianpier', 'Gone'] });
    // Nothing new: the document is not written again.
    const writes = kept.d.writes;
    accounts.sync(g);
    expect(kept.d.writes).toBe(writes);
  });
});
