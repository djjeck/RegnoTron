import { runParser as run, T0 } from '@megabottron1999/turns/test/parser-run.ts';
import { describe, expect, it } from 'vitest';
import { EPICLORELECBOT, TURN_COMMANDS } from '#src/replies.ts';
import { epiclorelecPlugin } from './epiclorelec.ts';

const GROUP = '-1001000000001';
const MIN = 60_000;

describe('the epiclorelec parser', () => {
  it('reads its count in private and its cooldown where it answers a turn', async () => {
    const p = await run(epiclorelecPlugin, { commands: TURN_COMMANDS[EPICLORELECBOT] }, GROUP);
    const epic = { sender: 'EpicLorelecBot' };
    p.hear({
      ...epic,
      chat: '@EpicLorelecBot',
      text: 'Complimenti 7, alice, mi hai rotto il cazzo 53 volte!',
    });
    // In the group the count names a display name: not alice's for sure.
    p.hear({ ...epic, chat: GROUP, text: 'Complimenti 7, Juno, mi hai rotto il cazzo 3 volte!' });
    const hand = p.hear({ chat: GROUP, sender: 'alice', own: true, text: '/rompimiilcazzo' });
    const cooldown =
      "(🔟 piedento) Non è passato abbastanza tempo dall'ultima rottura! Riprova fra 1 minuto e 22 secondi.";
    p.hear({ ...epic, chat: GROUP, replyTo: hand, text: cooldown });
    p.hear({ ...epic, chat: GROUP, replyTo: '5', text: cooldown });
    p.hear({
      ...epic,
      chat: '@EpicLorelecBot',
      text: "Non è passato abbastanza tempo dall'ultima rottura! Riprova fra poco.",
    });
    expect(p.outcomes()).toEqual(['count', 'nothing', 'nothing']);
    expect(p.iface.rest()).toMatchObject({ until: T0 + 15 * MIN });
    // A turn's first answer in private that it cannot read is drift.
    p.hear({ chat: '@EpicLorelecBot', sender: 'alice', own: true, text: '/avventura' });
    p.hear({ ...epic, chat: '@EpicLorelecBot', text: 'Turno 1\n\nBasi - 1000 HP' });
    p.hear({ ...epic, chat: '@EpicLorelecBot', text: 'Turno 2' });
    expect(p.outcomes()).toEqual(['count', 'nothing', 'nothing', 'unknown']);
  });
});
