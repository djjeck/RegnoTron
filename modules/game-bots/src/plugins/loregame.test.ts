import { runParser as run, T0 } from '@megabottron1999/turns/test/parser-run.ts';
import { describe, expect, it } from 'vitest';
import { loregamePlugin } from './loregame.ts';

const GROUP = '-1001000000001';
const MIN = 60_000;

describe('the loregame parser', () => {
  it("reads replies to alice's turns, by hand or sent by the actor, with the rests", async () => {
    const p = await run(loregamePlugin, {}, GROUP);
    const lore = { sender: 'LoreGameBot' };
    // By hand in the group, addressed to it.
    const hand = p.hear({
      chat: GROUP,
      sender: 'alice',
      own: true,
      text: '/avventura@LoreGameBot',
    });
    p.hear({
      ...lore,
      chat: GROUP,
      replyTo: hand,
      text: "Storia\nHai ottenuto un'ancora di burro [B1]!",
    });
    // Another's turn in the group is not alice's.
    p.hear({ ...lore, chat: GROUP, replyTo: '1', text: "Hai ottenuto un'ancora di burro [B1]!" });
    // Sent by the actor in private: a fight lost, 30 minutes' rest.
    await p.iface.sent({ chat: '@LoreGameBot', id: '77', t: p.kit.clock.now() });
    await p.iface.sent({ chat: '@LoreGameBot', id: '77', t: p.kit.clock.now() });
    p.hear({
      ...lore,
      chat: '@LoreGameBot',
      replyTo: '77',
      text: 'X sconfigge alice!\n\nTorni a casa dolorante e a mani vuote...',
    });
    expect(p.outcomes()).toEqual(['gain', 'nothing']);
    expect(p.iface.rest()).toMatchObject({ until: T0 + 30 * MIN, why: 'defeated' });
    // An unknown reply to a turn is drift; one to another command is not its business.
    p.hear({ ...lore, chat: '@LoreGameBot', replyTo: '77', text: 'È giunto il livello 5!' });
    p.hear({ ...lore, chat: '@LoreGameBot', replyTo: '78', text: 'Il tuo inventario: …' });
    // In private, a reply it reads as a turn's still counts, its turn unknown (a race with `sent`).
    p.hear({
      ...lore,
      chat: '@LoreGameBot',
      replyTo: '79',
      text: 'Non è passato abbastanza tempo! Riprova fra 40 minuti.',
    });
    p.hear({ ...lore, chat: '@LoreGameBot', replyTo: '80', text: 'Stai calmo maschio...' });
    p.hear({
      ...lore,
      chat: '@LoreGameBot',
      replyTo: '81',
      text: "Hai ottenuto un'ampolla di nebbia [C]!",
    });
    p.hear({
      ...lore,
      chat: '@LoreGameBot',
      replyTo: '82',
      text: "Nessuno vince\n\nL'oggetto si perde nello scontro...",
    });
    p.hear({ ...lore, chat: '@LoreGameBot', text: 'Un messaggio qualunque' });
    expect(p.outcomes()).toEqual([
      'gain',
      'nothing',
      'unknown',
      'nothing',
      'nothing',
      'gain',
      'nothing',
    ]);
    expect(p.iface.rest()).toMatchObject({ until: T0 + 40 * MIN, why: 'it said too soon' });
    expect(p.drift()).toMatchObject({ read: 6, unread: 1 });
  });

  it('counts /lore as a turn, as /avventura, in the group and in private', async () => {
    const p = await run(loregamePlugin, {}, GROUP);
    const lore = { sender: 'LoreGameBot' };
    const hand = p.hear({ chat: GROUP, sender: 'alice', own: true, text: '/lore@LoreGameBot' });
    p.hear({ ...lore, chat: GROUP, replyTo: hand, text: "Hai ottenuto un'ampolla di nebbia [C]!" });
    // In private, the first answer to a /lore it cannot read is a turn's (drift); to another
    // command, not its business.
    p.hear({ chat: '@LoreGameBot', sender: 'alice', own: true, text: '/inventario' });
    p.hear({ ...lore, chat: '@LoreGameBot', text: 'Il tuo inventario: …' });
    p.hear({ chat: '@LoreGameBot', sender: 'alice', own: true, text: '/lore' });
    p.hear({ ...lore, chat: '@LoreGameBot', text: 'Un messaggio qualunque' });
    expect(p.outcomes()).toEqual(['gain', 'unknown']);
  });

  it('rests a cut-off turn 15 minutes, 30 when the fight it kept was lost', async () => {
    const p = await run(loregamePlugin, {}, GROUP);
    const lore = { sender: 'LoreGameBot' };
    const cut = (fight: string): string =>
      [
        'Lore - Il Bosco Inventato ⛅️ [B1]',
        '',
        'x'.repeat(900),
        'Durante il tuo cammino compare un orso di burro 🧈 [L4]!',
        'Il combattimento inizia...',
        fight,
      ]
        .join('\n')
        .padEnd(1024, '.');
    const first = p.hear({ chat: GROUP, sender: 'alice', own: true, text: '/lore@LoreGameBot' });
    p.hear({
      ...lore,
      chat: GROUP,
      replyTo: first,
      text: cut('alice [L6] sconfigge un orso di burro 🧈 [L4]!'),
    });
    expect(p.iface.rest()).toMatchObject({ until: T0 + 15 * MIN });
    const second = p.hear({ chat: GROUP, sender: 'alice', own: true, text: '/lore@LoreGameBot' });
    p.hear({
      ...lore,
      chat: GROUP,
      replyTo: second,
      text: cut('un orso di burro 🧈 [L4] sconfigge alice [L2]!'),
    });
    expect(p.outcomes()).toEqual(['nothing', 'nothing']);
    expect(p.iface.rest()).toMatchObject({ until: T0 + 30 * MIN });
    expect(p.drift()).toMatchObject({ read: 2, unread: 0 });
  });

  it('counts /l, the short alias, as a turn too, in the group and in private', async () => {
    const p = await run(loregamePlugin, {}, GROUP);
    const lore = { sender: 'LoreGameBot' };
    const hand = p.hear({ chat: GROUP, sender: 'alice', own: true, text: '/l@LoreGameBot' });
    p.hear({ ...lore, chat: GROUP, replyTo: hand, text: "Hai ottenuto un'ampolla di nebbia [C]!" });
    p.hear({ chat: '@LoreGameBot', sender: 'alice', own: true, text: '/l' });
    p.hear({
      ...lore,
      chat: '@LoreGameBot',
      text: 'Non è passato abbastanza tempo! Riprova fra 40 minuti.',
    });
    expect(p.outcomes()).toEqual(['gain', 'nothing']);
    // The longer wait is the one that stands.
    expect(p.iface.rest()).toMatchObject({ until: T0 + 40 * MIN, why: 'it said too soon' });
  });
});
