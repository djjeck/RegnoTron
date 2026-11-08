import { describe, expect, it } from 'vitest';
import { playerCommand } from './player-command.ts';

describe('playerCommand', () => {
  it('reads a command from Telegram or IRC, @ and the bot name dropped', () => {
    expect(playerCommand(5, 'Mirco777', '/raid @Juno')).toEqual({
      time: 5,
      player: 'Mirco777',
      verb: 'raid',
      args: ['Juno'],
    });
    expect(playerCommand(5, 'Bob', ' !RAID  alice ')).toMatchObject({
      verb: 'raid',
      args: ['alice'],
    });
    expect(playerCommand(5, 'Bob', '/raid@NorelecBot @alice')?.args).toEqual(['alice']);
    expect(playerCommand(5, 'Bob', '/avventura')).toMatchObject({ verb: 'avventura', args: [] });
  });

  it('is null for chat, and for the bot', () => {
    expect(playerCommand(5, 'Bob', 'ciao /raid Juno')).toBeNull();
    expect(playerCommand(5, 'NorelecBot', '/raid Juno')).toBeNull();
  });
});
