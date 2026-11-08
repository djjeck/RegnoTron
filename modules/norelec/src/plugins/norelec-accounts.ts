/**
 * The players known to be Telegram accounts, kept in the `norelec` plugin's store (the document
 * `accounts`). The game state learns them from the bot's lines (an `@` before the name,
 * docs/bot-protocol.md §2), but a restart replays only the last hours, and a player the bot did not
 * write with `@` in them was named bare, which the bot refuses ("non conosco nessun giocatore di
 * nome Name", 4 Nov). Kept here, every command names them as `@Name` (`address()`), whenever
 * the bot last showed it.
 */
import { type BotMessage } from '#src/game/bot-message.ts';
import { type GameState } from '#src/state/game-state.ts';

/** The kept document. */
export interface StoredAccounts {
  names: string[];
}

/** Where the accounts are kept: a document of the plugin's store. */
export interface AccountsDocument {
  read(): StoredAccounts | undefined;
  write(value: StoredAccounts): void;
}

export class TelegramAccounts {
  private readonly doc: AccountsDocument;
  private names: Set<string>;
  /** Whether they were kept: if not, `backfill` from the whole log first. */
  readonly kept: boolean;

  constructor(doc: AccountsDocument) {
    this.doc = doc;
    const kept = doc.read();
    this.names = new Set(kept?.names ?? []);
    this.kept = kept !== undefined;
  }

  /** The accounts known, sorted. */
  list(): string[] {
    return [...this.names].sort();
  }

  /** Learns the accounts the logged messages show, oldest first; saves. */
  backfill(messages: Iterable<BotMessage>): void {
    for (const m of messages)
      for (const e of m.events) for (const n of e.telegram ?? []) this.names.add(n);
    this.save();
  }

  /** Marks the accounts known in `state`, so that commands name them `@Name` from the start. */
  apply(state: GameState): void {
    for (const n of this.names) state.player(n).telegram = true;
  }

  /**
   * Takes what `state` knows now, after a message: the accounts it learned, and those a refusal
   * showed to be IRC players after all; saves on a change.
   */
  sync(state: Pick<GameState, 'players'>): void {
    const next = new Set<string>();
    for (const n of this.names) if (!state.players.has(n)) next.add(n);
    for (const p of state.players.values()) if (p.telegram === true) next.add(p.name);
    if (next.size === this.names.size && [...next].every((n) => this.names.has(n))) return;
    this.names = next;
    this.save();
  }

  private save(): void {
    this.doc.write({ names: this.list() });
  }
}
