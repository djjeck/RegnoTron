/**
 * The `norelec` parser on a faked Telegram account alone (no IRC channel), with the `norelec-state`
 * node, on an instance's data volume and event log, so that a test can stop it and start it again.
 * The game's bot is the invented `@ExampleGameBot`; the owner plays as `alice`.
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
import { norelecPlugin } from '#src/plugins/norelec.ts';
import { NORELEC_STATE, norelecStatePlugin } from '#src/plugins/norelec-state.ts';

export const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
export const GROUP = '-100123';
export const DM = '@ExampleGameBot';
export const BOT = 'ExampleGameBot';
export const OWNER = 'alice';

/** An instance in `dir`, from `at`. */
export async function bootTelegram(dir: string, o: { at?: number } = {}) {
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
    config: { norelec: { bot: `@${BOT}`, self: OWNER, historyHours: 6 } },
    graph: (defaults) => ({
      ...defaults,
      edges: [
        ...defaults.edges,
        { from: `${TELEGRAM_USER}.chat`, to: 'norelec.telegram', type: 'chat-in', reads: '*' },
      ],
    }),
  });
  core.register(fakeConnectorPlugin(TELEGRAM_USER, account), norelecPlugin, norelecStatePlugin);
  await core.start();
  account.open();
  let n = 1000;
  /** Lets the state keep what it applied (once the bus's delivery is over). */
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };
  /** A message of the bot, in the group unless it says otherwise. */
  const bot = async (text: string, m: Partial<Heard> = {}): Promise<void> => {
    account.hear({ chat: GROUP, sender: BOT, time: clock.now(), id: String(n++), text, ...m });
    await settle();
  };
  /** A message of someone in the group: `sender`'s, or the owner's own. */
  const say = async (sender: string, text: string, m: Partial<Heard> = {}): Promise<void> => {
    account.hear({
      chat: GROUP,
      sender,
      time: clock.now(),
      id: String(n++),
      text,
      ...(sender === OWNER ? { own: true } : {}),
      ...m,
    });
    await settle();
  };
  const read = (name: string, input?: Record<string, unknown>): unknown => {
    const r = core.controls.read(NORELEC_STATE, name, input);
    if ('error' in r) throw new Error(r.error);
    return r.value;
  };
  const of = (type: string): BusEvent[] => records.filter((r) => r.type === type);
  /** What the state told (its own events but `changed`), in order. */
  const told = (): BusEvent[] =>
    records.filter((r) => r.type.startsWith(`${NORELEC_STATE}.`) && !r.type.endsWith('.changed'));
  return { core, clock, log, account, bot, say, read, of, told, settle, records };
}
