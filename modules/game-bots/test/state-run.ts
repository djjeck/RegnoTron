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
  GraphFile,
  type Heard,
  VirtualClock,
} from '@megabottron1999/core';
import fs from 'node:fs';
import path from 'node:path';
import { LOREGAME_STATE } from '#src/loregame-state.ts';
import { loregamePlugin } from '#src/plugins/loregame.ts';
import { loregameStatePlugin } from '#src/plugins/loregame-state.ts';

export const OWNER = 'alice';
export const DM = '@LoreGameBot';
export const MIN = 60_000;
export const T0 = Date.parse('2026-11-06T12:00:00Z');
/** The game's group, when a test reads it. */
export const GROUP = '-1001';

/**
 * An instance in `dir`, from `at`; `config`, the state node's; `group`: the parser also reads the
 * game's group (`GROUP`), from every sender, as a graph that names the bans' players needs.
 */
export async function bootState(
  dir: string,
  o: { at?: number; config?: object; group?: boolean } = {}
) {
  if (o.group === true) {
    const graph = {
      version: 2,
      nodes: [
        { id: TELEGRAM_USER, plugin: TELEGRAM_USER, account: `telegram:${OWNER}` },
        { id: 'loregame', plugin: 'loregame' },
        { id: LOREGAME_STATE, plugin: LOREGAME_STATE },
      ],
      edges: [
        {
          from: `${TELEGRAM_USER}.chat`,
          to: 'loregame.chat',
          type: 'chat-in',
          reads: [DM, GROUP],
        },
        { from: 'loregame.events', to: `${LOREGAME_STATE}.events`, type: 'events' },
        { from: 'loregame.interface', to: `${LOREGAME_STATE}.parser`, type: 'interface' },
      ],
    };
    fs.mkdirSync(path.join(dir, 'graph'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'graph', 'graph.json'), JSON.stringify(graph));
  }
  const clock = new VirtualClock(o.at ?? T0);
  const log = new CoreEventLog(path.join(dir, 'events'));
  const account = new FakeConnector({ account: `telegram:${OWNER}` });
  const records: BusEvent[] = [];
  const core = new Core({
    clock,
    dataDir: path.join(dir, 'data'),
    ...(o.group === true ? { graphFile: new GraphFile(path.join(dir, 'graph')) } : {}),
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
  /** A message in the group: from `sender`, replying to `replyTo`; the bot's, if `sender` is its. */
  const group = async (
    sender: string,
    text: string,
    m: { replyTo?: string; own?: boolean } = {}
  ): Promise<string> => {
    const id = String(n++);
    account.hear({ chat: GROUP, sender, time: clock.now(), id, text, ...m });
    await settle();
    return id;
  };
  /**
   * An edit of a message of the bot's (MegaBotTron1999's D144: a button pressed changes it): its
   * `id`, its text now, the message it replies to, when it was said (`time`); edited now.
   */
  const edit = async (
    id: string,
    text: string,
    m: { chat?: string; replyTo?: string; time: number }
  ): Promise<void> => {
    account.hearEdit({
      chat: m.chat ?? GROUP,
      sender: 'LoreGameBot',
      time: m.time,
      id,
      text,
      ...(m.replyTo === undefined ? {} : { replyTo: m.replyTo }),
      edited: clock.now(),
    });
    await settle();
  };
  /**
   * Each command's readiness, as the state tells a shell player (`state.ready`, MegaBotTron1999's
   * D141).
   */
  const ready = (): Record<string, { ready: boolean; until?: number; why?: string }> => {
    const r = core.controls.read(LOREGAME_STATE, 'ready');
    if ('error' in r) throw new Error(r.error);
    return r.value as Record<string, { ready: boolean; until?: number; why?: string }>;
  };
  /** Until when the bot rests, and why, as the state's readiness of the turn (`/lore`) says. */
  const rest = (): { until: number; why: string } | undefined => {
    const lore = ready()['/lore'];
    return lore === undefined || lore.ready || lore.until === undefined
      ? undefined
      : { until: lore.until, why: lore.why ?? '' };
  };
  const of = (type: string): BusEvent[] => records.filter((r) => r.type === type);
  return {
    core,
    clock,
    log,
    account,
    bot,
    owner,
    turn,
    read,
    of,
    settle,
    group,
    edit,
    rest,
    ready,
  };
}
