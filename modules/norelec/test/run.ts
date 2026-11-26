/**
 * The `norelec` parser on a faked IRC account reading the game's channel, with the `norelec-state`
 * node, on an instance's data volume and event log, so that a test can stop it and start it again.
 * The owner plays as `alice`; the bot's messages come as IRC carries them, one line each.
 */
import { IRC } from '@megabottron1999/connectors/plugins/irc.ts';
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
import { withChats } from './graph.ts';

export const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);
const CHANNEL = '#lobby';
export const OWNER = 'alice';

/** An instance in `dir`, from `at`, its `norelec-state` node configured with `state`. */
export async function bootRun(
  dir: string,
  o: { at?: number; state?: Record<string, unknown> } = {}
) {
  const clock = new VirtualClock(o.at ?? T0);
  const log = new CoreEventLog(path.join(dir, 'events'));
  const account = new FakeConnector({ account: `irc:${OWNER}` });
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
    config: {
      norelec: { channel: CHANNEL, self: OWNER },
      ...(o.state === undefined ? {} : { [NORELEC_STATE]: o.state }),
    },
    graph: (defaults) => withChats(defaults, 'norelec.channel', { reads: [CHANNEL] }),
  });
  core.register(fakeConnectorPlugin(IRC, account), norelecPlugin, norelecStatePlugin);
  await core.start();
  account.open('joined');
  /** Lets the parser's clock read what waited, and the state keep what it applied. */
  const settle = async (): Promise<void> => {
    clock.advance(500);
    await Promise.resolve();
    await Promise.resolve();
  };
  /** A message of the bot, its lines joined as IRC joins them. */
  const bot = async (text: string, m: Partial<Heard> = {}): Promise<void> => {
    account.hear({
      chat: CHANNEL,
      sender: 'NorelecBot',
      time: clock.now(),
      text: text.split('\n').join(' · '),
      ...m,
    });
    await settle();
  };
  /** A player's line on the channel: `sender`'s, or the owner's own. */
  const say = async (sender: string, text: string): Promise<void> => {
    account.hear({
      chat: CHANNEL,
      sender,
      time: clock.now(),
      text,
      ...(sender === OWNER ? { own: true } : {}),
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
  return { core, clock, log, account, bot, say, read, of, told, settle };
}
