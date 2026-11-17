/**
 * The `loregame` parser and the `loregame-state` node on the owner's faked Telegram account, on an
 * instance's data volume and event log as the image's entry point makes them, so that a test stops
 * it and starts it again: what the state applies, keeps, announces and refuses. The owner is
 * `alice`.
 */
import { TELEGRAM_USER } from '@megabottron1999/connectors/plugins/telegram-user.ts';
import {
  type BusEvent,
  Core,
  CoreEventLog,
  FakeConnector,
  fakeConnectorPlugin,
  type Heard,
  VirtualClock,
} from '@megabottron1999/core';
import path from 'node:path';
import { LOREGAME_STATE } from '#src/loregame-state.ts';
import { loregamePlugin } from '#src/plugins/loregame.ts';
import { loregameStatePlugin } from '#src/plugins/loregame-state.ts';

export const OWNER = 'alice';
export const DM = '@LoreGameBot';
export const MIN = 60_000;
export const T0 = Date.parse('2026-11-06T12:00:00Z');

/** An instance in `dir`, from `at`; `config`, the state node's. */
export async function bootState(dir: string, o: { at?: number; config?: object } = {}) {
  const clock = new VirtualClock(o.at ?? T0);
  const log = new CoreEventLog(path.join(dir, 'events'));
  const account = new FakeConnector({ account: `telegram:${OWNER}` });
  const records: BusEvent[] = [];
  const core = new Core({
    clock,
    dataDir: path.join(dir, 'data'),
    events: log,
    print: () => undefined,
    record: (r) => {
      records.push(r as BusEvent);
      return log.write(r);
    },
    ...(o.config === undefined ? {} : { config: { [LOREGAME_STATE]: o.config } }),
  });
  core.register(fakeConnectorPlugin(TELEGRAM_USER, account), loregamePlugin, loregameStatePlugin);
  await core.start();
  account.open();
  // Message ids that no earlier start of the same instance used.
  let n = Math.floor(clock.now() / 1000);
  /** Lets the state keep what it applied (once the bus's delivery is over). */
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };
  /** A message of the bot, in private unless it says otherwise. */
  const bot = async (text: string, m: Partial<Heard> = {}): Promise<void> => {
    account.hear({
      chat: DM,
      sender: 'LoreGameBot',
      time: clock.now(),
      id: String(n++),
      text,
      ...m,
    });
    await settle();
  };
  /** A command of the owner's, in private. */
  const owner = async (text: string): Promise<void> => {
    account.hear({ chat: DM, sender: OWNER, own: true, time: clock.now(), id: String(n++), text });
    await settle();
  };
  /** A turn of the owner's and the bot's answer to it, a rest later (the next turn is allowed). */
  const turn = async (reply: string): Promise<void> => {
    await owner('/lore');
    await bot(reply);
    clock.advance(31 * MIN);
  };
  const read = (name: string, input?: Record<string, unknown>): unknown => {
    const r = core.controls.read(LOREGAME_STATE, name, input);
    if ('error' in r) throw new Error(r.error);
    return r.value;
  };
  const of = (type: string): BusEvent[] => records.filter((r) => r.type === type);
  return { core, clock, log, account, bot, owner, turn, read, of, settle };
}
