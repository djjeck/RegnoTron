import { describe, expect, it } from 'vitest';
import { describe as describeNotice, NorelecGame, type TelegramMessage } from './norelec-game.ts';

const T0 = Date.UTC(2026, 9, 22, 2, 0, 0);

/** A game on an in-memory log. */
function fakeRun(now = (): number => T0) {
  const records: { type: string }[] = [];
  const printed: string[] = [];
  const run = new NorelecGame({
    log: { write: (r) => records.push(r) },
    print: (l) => printed.push(l),
    now,
    restS: 60,
    self: 'alice',
  });
  return { run, records, printed };
}

const bot = (text: string, time: number) => ({
  nick: 'Regno',
  text: `<N\u200borelecBot> ${text}`,
  time,
  playback: false,
});

describe('NorelecGame', () => {
  it("reads a Telegram player's command through the relay's other nick", () => {
    const { run } = fakeRun();
    const commands: string[] = [];
    run.onCommand((c) => commands.push(`${c.player} ${c.verb}`));
    run.line({ nick: 'Regno_', text: '<A\u200blfa> /raid @Bravo', time: T0, playback: false });
    expect(commands).toEqual(['Alfa raid']);
  });

  it('turns live bot lines into messages and notices, and logs everything', () => {
    let now = T0;
    const { run, records, printed } = fakeRun(() => now);
    run.line(
      bot('Juno parti per alice: arrivi tra 1 minuto e 30 secondi. Casa tua resta scoperta.', T0)
    );
    // Another speaker ends the bot's message (and the join window).
    run.line({ nick: 'Regno', text: '<Alfa> ciao', time: T0 + 100, playback: false });
    expect(records.map((r) => r.type)).toEqual(['message', 'notice']);
    expect(printed).toEqual(['02:01:30  incomingRaid alice by Juno']);
    expect(run.health.lastBotMessage).toBe(T0);

    run.line(
      bot('Bravo parti per Juno: arrivi tra 10 secondi. Casa tua resta scoperta.', T0 + 200)
    );
    now = T0 + 5000;
    run.tick();
    // Notices about others are logged, not printed.
    expect(printed).toHaveLength(1);
    expect(records.map((r) => r.type)).toEqual(['message', 'notice', 'message', 'notice']);
  });

  it("passes on players' commands, relayed or not, before the bot answers", () => {
    const { run } = fakeRun();
    const heard: string[] = [];
    run.onCommand((c) => heard.push(`${c.player} ${c.verb} ${c.args.join(' ')}`));
    run.line({ nick: 'Regno', text: '<M\u200birco777> /raid @alice', time: T0, playback: false });
    run.line({ nick: 'Bob', text: '!raid Juno', time: T0, playback: false });
    run.line({ nick: 'Regno', text: '<Alfa> ciao', time: T0, playback: false });
    run.line({ nick: 'Bob', text: '!raid Juno', time: T0, playback: true });
    expect(heard).toEqual(['Mirco777 raid alice', 'Bob raid Juno']);
  });

  it('ignores played-back lines, which irc logs', () => {
    const { run, records } = fakeRun();
    run.line({ ...bot('Bravo sei in @TheConquister37!', T0 - 60_000), playback: true });
    run.tick();
    expect(records).toEqual([]);
    expect(run.health.lastLine).toBeUndefined();
  });

  it('fires timers on the clock, printing only the notices that matter', () => {
    let now = T0;
    const { run, printed } = fakeRun(() => now);
    run.line(bot('Bravo (🎈) torni in Bravo con 10 palle.', T0));
    run.line(bot('alice (🎈) torni in alice con 10 palle.', T0 + 2000));
    now = T0 + 120_000;
    run.tick();
    expect(printed).toEqual(['02:01:02  restOver alice']);
  });

  it('tracks the connection in its health, leaving the log and the prints to irc', () => {
    const { run, records, printed } = fakeRun();
    run.status('joined');
    expect(run.health.connected).toBe(true);
    run.status('closed');
    expect(run.health.connected).toBe(false);
    run.status('joined');
    run.status('connecting');
    expect(run.health.connected).toBe(false);
    expect(records).toEqual([]);
    expect(printed).toEqual([]);
  });

  it('waits for a matching bot message, until a timeout or a cancel', async () => {
    let now = T0;
    const { run } = fakeRun(() => now);
    const hit = run.waitForMessage((m) => m.text.includes('Bravo'), 1000);
    const late = run.waitForMessage(() => false, 10);
    const cancelled = run.waitForMessage(() => true, 1000);
    cancelled.cancel();
    expect(await cancelled.reply).toBeUndefined();
    run.line(bot('Alfa sei in @TheConquister37!', T0));
    run.line(bot('Bravo sei già in @Bravo!', T0 + 5000));
    now = T0 + 400;
    run.tick();
    expect((await hit.reply)?.text).toBe('Bravo sei già in @Bravo!');
    expect(await late.reply).toBeUndefined();
  });

  it('describes a notice', () => {
    expect(
      describeNotice({ kind: 'frozen', at: T0, player: 'Juno', by: 'alice', detail: 'x' })
    ).toBe('02:00:00  frozen Juno by alice (x)');
  });

  it('replays logged bot messages into the state and its listeners, quietly', () => {
    const { run, records, printed } = fakeRun(() => T0 + 60_000);
    const seen: number[] = [];
    run.onMessage((m) => seen.push(m.time));
    const n = run.replay([
      {
        time: T0,
        text: 'Alfa parti per Juno: arrivi tra 10 secondi. Casa tua resta scoperta.',
      },
      {
        time: T0 + 1000,
        text: 'Juno parti per Alfa: arrivi tra 10 secondi. Casa tua resta scoperta.',
      },
      {
        time: T0 + 2000,
        text: 'alice congeli Juno: per 24 minuti non può partire e, se lo cacciano, non può rientrare.',
      },
    ]);
    expect(n).toBe(3);
    expect(seen).toEqual([T0, T0 + 1000, T0 + 2000]);
    expect(run.state.player('Juno').location).toBe('travelling');
    expect(run.state.player('Juno').frozenUntil).toBe(T0 + 2000 + 24 * 60_000);
    expect([records, printed]).toEqual([[], []]);
  });

  it('tells its notice listeners of each notice, once logged', () => {
    const { run, records } = fakeRun();
    const heard: string[] = [];
    run.onNotice((r) => heard.push(`${r.notice.kind} ${String(records.includes(r))}`));
    run.line(
      bot('Juno parti per alice: arrivi tra 1 minuto e 30 secondi. Casa tua resta scoperta.', T0)
    );
    run.line({ nick: 'Regno', text: '<Alfa> ciao', time: T0 + 100, playback: false });
    expect(heard).toEqual(['incomingRaid true']);
  });
});

describe('NorelecGame on Telegram', () => {
  const tg = (text: string, o: Partial<TelegramMessage> = {}): TelegramMessage => ({
    sender: 'NorelecBot',
    text,
    time: T0,
    private: false,
    own: false,
    playback: false,
    ...o,
  });
  const RAID = 'Juno parti per alice: arrivi tra 1 minuto e 30 secondi. Casa tua resta scoperta.';

  it("reads the bot's messages, and the players' commands, the owner's as theirs", () => {
    const { run, records } = fakeRun();
    const commands: string[] = [];
    run.onCommand((c) => commands.push(`${c.player} ${c.verb}`));
    run.telegram(tg(RAID));
    run.telegram(tg('/raid @Juno', { sender: 'Bravo' }));
    run.telegram(tg('/back', { sender: 'whatever', own: true }));
    run.telegram(tg('/back', { sender: '' }));
    expect(records.map((r) => r.type)).toEqual(['message', 'notice']);
    expect(commands).toEqual(['Bravo raid', 'alice back']);
    expect(run.health.lastBotMessage).toBe(T0);
  });

  it('reads the copy of the other network once, the first that came', () => {
    const { run, records } = fakeRun();
    const read: string[] = [];
    run.publish = (_m, r) => read.push(`${r.source}${r.duplicate ? ' copy' : ''}`);
    run.telegram(tg(RAID));
    run.line({ nick: 'NorelecBot', text: `\u200b${RAID}`, time: T0 + 500, playback: false });
    // The relay's copy of the bot's IRC line, in the group: the IRC side's too.
    run.telegram(tg(`<NorelecBot> ${RAID}`, { sender: 'Regno' }));
    // Another message, and one long after.
    run.line({
      nick: 'NorelecBot',
      text: 'Juno sei già in viaggio, torni tra 5 secondi.',
      time: T0 + 1000,
      playback: false,
    });
    run.telegram(tg(RAID, { time: T0 + 120_000 }));
    expect(read).toEqual(['telegram', 'irc copy', 'irc copy', 'irc', 'telegram']);
    expect(records.map((r) => r.type)).toEqual(['notice', 'notice']);
  });

  it("takes the relay's copy of an IRC player's command, and plays back no command", () => {
    const { run } = fakeRun();
    const commands: string[] = [];
    run.onCommand((c) => commands.push(`${c.player} ${c.verb}`));
    run.telegram(tg('<Bravo> !raid Juno', { sender: 'Regno' }));
    run.telegram(tg('<Bravo> !raid Juno', { sender: 'Regno', playback: true }));
    run.telegram(tg('/raid @Juno', { sender: 'Bravo', playback: true }));
    expect(commands).toEqual(['Bravo raid']);
  });

  it('names the banned player from their command, and the owner in the private chat', () => {
    const { run } = fakeRun();
    const banned: unknown[] = [];
    run.onMessage((m) => banned.push(...m.events.filter((e) => e.kind === 'banned')));
    run.telegram(tg('/avventura', { sender: 'Bravo' }));
    run.telegram(tg('COGLIONE', { time: T0 + 1000 }));
    run.telegram(tg('COGLIONE', { time: T0 + 60_000 }));
    run.telegram(tg('COGLIONE', { time: T0 + 61_000, private: true }));
    expect(banned).toEqual([
      expect.objectContaining({ player: { name: 'Bravo' } }),
      expect.not.objectContaining({ player: expect.anything() }),
      expect.objectContaining({ player: { name: 'alice' } }),
    ]);
  });

  it('applies a message played back, telling no listener and no notice', () => {
    const { run, records } = fakeRun();
    const heard: number[] = [];
    run.onMessage((m) => heard.push(m.time));
    run.telegram(tg(RAID, { playback: true }));
    expect(heard).toEqual([]);
    expect(records.map((r) => r.type)).toEqual(['message']);
    expect(run.state.player('Juno').location).toBe('travelling');
    expect(run.health.lastBotMessage).toBeUndefined();
  });
});
describe('a banned player', () => {
  it('is named from the command the bot answers, the latest just before it', () => {
    const { run } = fakeRun();
    const banned: unknown[] = [];
    run.onMessage((m) => banned.push(...m.events.filter((e) => e.kind === 'banned')));
    run.line({ nick: 'Regno_', text: '<B\u200bravo> /avventura', time: T0, playback: false });
    run.line({ nick: 'NorelecBot', text: 'COGLIONE', time: T0 + 1000, playback: false });
    run.line({ nick: 'NorelecBot', text: 'COGLIONE', time: T0 + 60_000, playback: false });
    expect(banned).toEqual([
      expect.objectContaining({ player: { name: 'Bravo' } }),
      expect.not.objectContaining({ player: expect.anything() }),
    ]);
  });
});
