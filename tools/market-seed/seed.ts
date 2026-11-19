/**
 * The market's history, from a replay of the exports (tools/market-seed/README.md): what
 * `loregame-state` holds of it after the replay, as the seed its migration to 0.35.0 takes
 * (`market-seed` in its store): the market (the companies there are, by id, each its name, latest
 * value and page; the bot's updates' schedule), its history (each company's series, those gone),
 * and each player's investments, by company id, under their username.
 *
 * An export names a player by their display name, the state by their username: a profile (it names
 * its player, "👤 <username>") answering a player's own `/info` or `/me` tells which is whose.
 */
import { type Inbound } from '@megabottron1999/core';
import { type LoreState } from '@regnotron/game-bots/loregame-state.ts';
import { parseProfile } from '@regnotron/game-bots/profile.ts';

/** What the migration takes. */
export interface MarketSeed {
  market: LoreState['market'];
  market_history: LoreState['market_history'];
  players: Record<string, { investments: LoreState['players'][string]['investments'] }>;
}

/**
 * Each player's username by their display name, as the bot's profiles answering their own `/info`
 * or `/me` (the command alone, or addressed to the bot) tell it; the first told wins.
 */
export function usernames(inbounds: readonly Inbound[], bot: string): Map<string, string> {
  const byId = new Map<string, Inbound>();
  for (const m of inbounds) if (m.id !== undefined) byId.set(`${m.chat}\n${m.id}`, m);
  const names = new Map<string, string>();
  for (const m of inbounds) {
    if (m.sender.toLowerCase() !== bot.toLowerCase() || m.replyTo === undefined) continue;
    const asked = byId.get(`${m.chat}\n${m.replyTo}`);
    if (asked === undefined || !/^\/(?:info|me)(?:@\w+)?$/iu.test(asked.text.trim())) continue;
    const profile = parseProfile(m.text);
    if (profile !== undefined && !names.has(asked.sender)) names.set(asked.sender, profile.player);
  }
  return names;
}

/**
 * The seed of `state` (a replay's): its market and its history whole; each player's investments
 * under their username (`names`, by display name; one not known keeps the name the replay gave,
 * the owner's being their username already), those with none left out.
 */
export function seedOf(state: LoreState, names: ReadonlyMap<string, string>): MarketSeed {
  const players: MarketSeed['players'] = {};
  for (const [name, p] of Object.entries(state.players)) {
    if (Object.keys(p.investments).length === 0) continue;
    Object.defineProperty(players, names.get(name) ?? name, {
      value: { investments: p.investments },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { market: state.market, market_history: state.market_history, players };
}
