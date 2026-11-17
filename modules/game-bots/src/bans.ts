/**
 * @LoreGameBot's bans, as the `loregame` parser watches them and an actor checks them (docs/game-
 * bots.md §5, §6). Pure, but for what a plugin hands it.
 *
 * A banned player gets "Sei stato bannato fino al …" to **every** message of theirs, whatever the
 * command (even another bot's, or no command), so a ban is read off any reply, in the private chat
 * (the owner's) and in the group (anybody's). The group's reply names nobody: it replies to the
 * banned player's message, so the watch remembers who sent each message it heard (`Senders`) and
 * names the player from the message replied to.
 *
 * The bot also lifts bans early [M] and says nothing when it does: a reply that is anything but a
 * ban, to a player known banned, ends their ban here (`BanWatch`).
 */
import { type Inbound, ME } from '@megabottron1999/core';
import { isPrivate } from '@megabottron1999/turns/turn-parser.ts';
import { parseLoreGameBot } from '#src/replies.ts';

/** How many messages' senders are remembered per watch. */
const KEPT_SENDERS = 5000;

/** Who sent each message heard, to name the player a reply replies to; the oldest forgotten first. */
export class Senders {
  private readonly senders = new Map<string, string>();

  remember(chat: string, id: string, sender: string): void {
    const key = `${chat}\n${id}`;
    this.senders.delete(key);
    this.senders.set(key, sender);
    if (this.senders.size > KEPT_SENDERS)
      this.senders.delete(this.senders.keys().next().value as string);
  }

  of(chat: string, id: string): string | undefined {
    return this.senders.get(`${chat}\n${id}`);
  }
}

/** What a message told of a player's ban. */
export type BanNews =
  /** `owner`: the player is the account's owner. */
  | { type: 'ban'; player: string; until: number; owner: boolean }
  | { type: 'unban'; player: string; owner: boolean };

/** The fields of a message the watch reads. */
export type Heard = Pick<
  Inbound,
  'chat' | 'sender' | 'text' | 'time' | 'id' | 'replyTo' | 'own' | 'private'
>;

/**
 * The bans of the players it heard of, as the bot told them: `hear` is given every message of the
 * chats the parser reads, and gives the news a message brings, only when a ban is new, changed or
 * ended (a banned player's hundred replies are one piece of news).
 */
export class BanWatch {
  private readonly senders = new Senders();
  private readonly banned: Map<string, number>;
  private readonly bot: string;

  /** `kept`: the bans it knew at its last stop, `[player, until]` (a name may be anything). */
  constructor(bot: string, kept: readonly (readonly [string, number])[] = []) {
    this.bot = bot.toLowerCase();
    this.banned = new Map(kept);
  }

  /** The bans it knows, to keep. */
  entries(): [string, number][] {
    return [...this.banned];
  }

  /** Until when `player` is banned, as far as it knows (ms), if still at `now`. */
  until(player: string, now: number): number | undefined {
    const until = this.banned.get(player);
    return until !== undefined && until > now ? until : undefined;
  }

  /** The player who is the account's owner: its username once known, else the shell's name for it. */
  static owner(self: string | undefined): string {
    return self ?? ME;
  }

  hear(m: Heard, self: string | undefined): BanNews | undefined {
    const owner = BanWatch.owner(self);
    if (m.own === true || m.sender.toLowerCase() !== this.bot) {
      const who = m.own === true ? owner : m.sender;
      if (!isPrivate(m) && m.id !== undefined && who !== '')
        this.senders.remember(m.chat, m.id, who);
      return undefined;
    }
    // The bot's: in private, the owner's; in the group, that of the message it replies to.
    const player = isPrivate(m)
      ? owner
      : m.replyTo === undefined
        ? undefined
        : this.senders.of(m.chat, m.replyTo);
    if (player === undefined) return undefined;
    const said = parseLoreGameBot(m.text);
    if (said.kind === 'banned') {
      if (said.until <= m.time || this.banned.get(player) === said.until) return undefined;
      this.banned.set(player, said.until);
      return { type: 'ban', player, until: said.until, owner: player === owner };
    }
    if (said.kind === 'unknown') return undefined;
    // The bot served them: no ban in force, whatever date it gave.
    const until = this.banned.get(player);
    if (until === undefined) return undefined;
    this.banned.delete(player);
    return until > m.time ? { type: 'unban', player, owner: player === owner } : undefined;
  }
}

/** The ban as a state's `ban` query gives it: when it ends (an ISO time), none if it does not say. */
export interface BanView {
  until: string | null;
}

/** What an actor uses of `loregame-state`: its bans. */
export interface BansInterface {
  state: { ban(input: { player?: string }): BanView | null };
}

/** The members of the contract, as an actor's input names them. */
export const BANS_MEMBERS = ['state.ban'];

/**
 * Until when the player (the owner, unless named) is banned at `now`, in ms: `Infinity` for a ban
 * with no end stated, undefined for none. An actor calls it as it wakes, before each command: the
 * ban is the account's, whatever the command, and the bot answers a banned player's command with
 * the ban alone.
 *
 * ```ts
 * const ban = bannedUntil(ctx.use<BansInterface>('bans'), ctx.clock.now());
 * if (ban !== undefined) return sleepUntil(ban); // not Infinity: wait for the state to change
 * ```
 */
export function bannedUntil(bans: BansInterface, now: number, player?: string): number | undefined {
  const ban = bans.state.ban(player === undefined ? {} : { player });
  if (ban === null) return undefined;
  const until = ban.until === null ? Infinity : Date.parse(ban.until);
  return until > now ? until : undefined;
}
