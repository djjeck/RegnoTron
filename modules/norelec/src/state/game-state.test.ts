import { describe, expect, it } from 'vitest';
import { type BotMessage } from '#src/game/bot-message.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { address, GameState, recent, richest } from './game-state.ts';

const S = 1000;
const msg = (time: number, ...lines: string[]): BotMessage => {
  const text = lines.join('\n');
  return { time, text, events: parseMessage(text) };
};
const kinds = (notices: { kind: string }[]): string[] => notices.map((n) => n.kind);

describe('trips', () => {
  it('follows a raid from departure to return, and the rest after it', () => {
    const g = new GameState({ restS: 60 });
    g.apply(msg(0, 'Bravo', 'Con te: 🎈', '1000 palle, 1° su 2 in classifica'));
    g.apply(msg(0, 'Alfa', '10 palle, 2° su 2 in classifica'));
    const out = g.apply(
      msg(0, 'Alfa parti per Bravo: arrivi tra 1 minuto e 30 secondi. Casa tua resta scoperta.')
    );
    expect(out).toEqual([{ kind: 'incomingRaid', at: 90 * S, player: 'Bravo', by: 'Alfa' }]);
    expect(g.player('Alfa')).toMatchObject({
      location: 'travelling',
      trip: { to: 'Bravo', arriveAt: 90 * S },
    });

    g.apply(
      msg(
        90 * S,
        'Alfa (🎈) hai rubato 630 palle a Bravo (🎈), che non era a casa! Torni in Alfa tra 1 minuto e 30 secondi.'
      )
    );
    expect(g.player('Alfa').trip).toMatchObject({ arrived: true, returnAt: 180 * S });
    expect(g.player('Bravo').balance?.balls).toBe(370);
    // Within the margin after the return due at 180 s (120 s by default): nothing yet.
    expect(g.tick(300 * S)).toEqual([]);

    g.apply(msg(180 * S, 'Alfa (🎈) rientri in Alfa portando 630 palle.'));
    expect(g.player('Alfa')).toMatchObject({
      location: 'home',
      restUntil: 240 * S,
      balance: { balls: 640 },
    });
    expect(g.tick(239 * S)).toEqual([]);
    expect(g.tick(240 * S)).toEqual([{ kind: 'restOver', at: 240 * S, player: 'Alfa' }]);
    expect(g.tick(300 * S)).toEqual([]);
  });

  it('takes a trip with no arrival for a dream', () => {
    const g = new GameState({ dreamMarginS: 60 });
    g.apply(msg(0, 'Alfa parti per Bravo: arrivi tra 30 secondi. Casa tua resta scoperta.'));
    expect(g.tick(90 * S)).toEqual([]);
    expect(g.tick(91 * S)).toEqual([
      { kind: 'tripDreamt', at: 30 * S, player: 'Alfa', detail: 'Bravo' },
    ]);
    expect(g.player('Alfa').location).toBe('home');
  });

  it('learns the form of a name from the bot not knowing the other', () => {
    const g = new GameState();
    g.player('Gianpier');
    g.player('Juno').telegram = true;
    g.apply(msg(0, 'alice non conosco nessun giocatore di nome Gianpier.'));
    expect(address(g, 'Gianpier')).toBe('@Gianpier');
    g.apply(msg(1, 'alice non conosco nessun giocatore di nome @Juno.'));
    expect(address(g, 'Juno')).toBe('Juno');
    // A name never seen, a typo say, teaches nothing.
    g.apply(msg(2, 'alice non conosco nessun giocatore di nome Lcuy.'));
    expect(g.players.has('Lcuy')).toBe(false);
  });

  it('takes a player home once a return line never read is well overdue', () => {
    const g = new GameState({ dreamMarginS: 60, restS: 90 });
    g.apply(msg(0, 'Alfa parti per Bravo: arrivi tra 30 secondi. Casa tua resta scoperta.'));
    g.apply(
      msg(
        30 * S,
        'Alfa hai rubato 10 palle a Bravo, che non era a casa! Torni in Alfa tra 30 secondi.'
      )
    );
    expect(g.tick(120 * S)).toEqual([]);
    expect(g.player('Alfa').location).toBe('travelling');
    expect(g.tick(121 * S)).toEqual([
      { kind: 'returnMissed', at: 60 * S, player: 'Alfa', detail: 'Bravo' },
    ]);
    const alfa = g.player('Alfa');
    expect(alfa.location).toBe('home');
    expect(alfa.trip).toBeUndefined();
    expect(alfa.lastReturnAt).toBe(60 * S);
    expect(alfa.restUntil).toBe(150 * S);
  });

  it('reads a late dream line as about an earlier dreamt trip, not the trip under way', () => {
    const g = new GameState({ dreamMarginS: 60 });
    g.apply(msg(0, 'Alfa parti per Bravo: arrivi tra 30 secondi. Casa tua resta scoperta.'));
    expect(kinds(g.tick(100 * S))).toEqual(['tripDreamt']);
    g.apply(msg(200 * S, 'Alfa parti per Bravo: arrivi tra 30 secondi. Casa tua resta scoperta.'));
    const dream =
      'Alfa eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!';
    expect(g.apply(msg(210 * S, dream))).toEqual([]);
    expect(g.player('Alfa').location).toBe('travelling');
    // Once the trip has arrived, a dream line cannot be about it either.
    g.apply(msg(230 * S, 'Alfa (🎈) hai rubato 420 palle a Bravo! Torni in Alfa tra 30 secondi.'));
    expect(g.apply(msg(240 * S, dream))).toEqual([]);
    expect(g.player('Alfa').trip?.arrived).toBe(true);
  });

  it('ends a trip when the bot says it was dreamt', () => {
    const g = new GameState();
    g.apply(msg(0, 'Alfa parti per Bravo: arrivi tra 30 secondi. Casa tua resta scoperta.'));
    const out = g.apply(
      msg(
        5 * S,
        'Alfa eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!'
      )
    );
    expect(kinds(out)).toEqual(['tripDreamt']);
    expect(
      kinds(
        g.apply(
          msg(
            6 * S,
            'Alfa eri così stanco che hai solo sognato di partire: non ti sei mai mosso da casa!'
          )
        )
      )
    ).toEqual([]);
  });

  it('tells throws from raids', () => {
    const g = new GameState();
    expect(
      kinds(
        g.apply(
          msg(
            0,
            'Alfa parti per Bravo con 🧊 da consegnare: arrivi tra 30 secondi. Casa tua resta scoperta.'
          )
        )
      )
    ).toEqual(['incomingThrow']);
  });

  it('reads the other arrivals and the ways home', () => {
    const g = new GameState();
    g.apply(msg(0, 'Alfa parti per Bravo: arrivi tra 30 secondi. Casa tua resta scoperta.'));
    g.apply(
      msg(
        30 * S,
        'Alfa (🎈) il cane di Bravo (🐶) ti ha intercettato: niente bottino. Torni in Alfa tra 30 secondi.'
      )
    );
    expect(g.player('Alfa').trip?.arrived).toBe(true);
    g.apply(msg(31 * S, 'Alfa lasci perdere e torni in Alfa: arrivi tra 5 secondi.'));
    expect(g.player('Alfa').trip?.returnAt).toBe(36 * S);
    g.apply(
      msg(
        60 * S,
        'Alfa non hai scelto nessuna strada al bivio: ti sei perso e sei tornato in Alfa a mani vuote.'
      )
    );
    expect(g.player('Alfa').location).toBe('home');
    // An arrival without a departure seen (the log started mid-trip) is still an arrival.
    g.apply(
      msg(
        70 * S,
        'Charlie (🎈) la tua 💦 è arrivata a casa di @Bravo: tra 9 ore si vedrà. Torni in @Charlie tra 2 minuti.'
      )
    );
    expect(g.player('Charlie').trip?.arrived).toBe(true);
    g.apply(
      msg(
        70 * S,
        'Delta la tua 💦 è arrivata addosso a Bravo in @TheConquister37: tra 9 ore si vedrà.'
      )
    );
    expect(g.player('Delta').trip).toBeUndefined();
    g.apply(msg(80 * S, 'Alfa sei già in viaggio, torni tra 5 secondi.'));
  });
});

describe('freezes and 🧊', () => {
  it('freezes a target for 30 minutes, less 10% per 🔥 it carries', () => {
    const g = new GameState();
    g.apply(msg(0, 'Bravo (🎈🔥🔥) sei già in viaggio, torni tra 5 secondi.'));
    const out = g.apply(
      msg(
        0,
        'Alfa (🎈) congeli Bravo: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in Alfa tra 30 secondi.'
      )
    );
    expect(out).toEqual([{ kind: 'frozen', at: 0, player: 'Bravo', by: 'Alfa' }]);
    expect(g.player('Bravo').frozenUntil).toBe(24 * 60 * S);

    g.apply(
      msg(
        60 * S,
        'Bravo una 🧊 ti ha congelato: non puoi entrare in @TheConquister37 né partire per altri 20 minuti.'
      )
    );
    expect(g.player('Bravo').frozenUntil).toBe(21 * 60 * S);
    expect(g.tick(21 * 60 * S)).toEqual([
      { kind: 'freezeEnded', at: 21 * 60 * S, player: 'Bravo' },
    ]);
  });

  it('reports a bounce, a salt payment and an unknown line', () => {
    const g = new GameState();
    expect(
      g.apply(
        msg(
          0,
          'La cassetta di Bravo rispedisce 🧊 al mittente: Alfa resta congelato. Torni in @Alfa tra 1 minuto.'
        )
      )
    ).toEqual([{ kind: 'bounced', at: 0, player: 'Alfa', by: 'Bravo', detail: '🧊' }]);
    expect(g.player('Alfa').trip?.returnAt).toBe(60 * S);
    expect(
      g.apply(msg(0, 'La cassetta di Bravo rispedisce 🧊 al mittente: Alfa resta congelato.'))
    ).toHaveLength(1);
    expect(
      g.apply(
        msg(
          0,
          'Alfa parti per Bravo: arrivi tra 30 secondi. Casa tua resta scoperta.',
          'Ci torni troppo presto: il 🧂 di @Bravo ti costa 86 palle, che vanno a lui.'
        )
      )[1]
    ).toEqual({ kind: 'saltPaid', at: 0, player: 'Bravo', by: 'Alfa', detail: '86' });
    expect(
      g.apply(
        msg(0, 'Ci torni troppo presto: il 🧂 di @Bravo ti costa 86 palle, che vanno a lui.')
      )[0]
    ).not.toHaveProperty('by');
    expect(g.apply(msg(0, 'Una riga nuova.'))).toEqual([
      { kind: 'unknownLine', at: 0, player: '', detail: 'Una riga nuova.' },
    ]);
  });
});

describe('a house balloon', () => {
  it('is learned from raids on an empty house, but not while its owner is frozen', () => {
    const g = new GameState();
    const away = (t: number, line: string) => g.apply(msg(t, line));
    away(
      0,
      'Alfa (🎈) hai bucato il palloncino di Bravo (🎈) e rubato 1 palla, che non era a casa! Torni in Alfa tra 1 minuto.'
    );
    expect(g.player('Bravo').houseBalloon).toBe(true);
    away(
      100 * S,
      'Charlie congeli Bravo: per 24 minuti non può partire e, se lo cacciano, non può rientrare.'
    );
    away(
      200 * S,
      'Alfa (🎈) hai rubato 630 palle a Bravo (🎈), che non era a casa! Torni in Alfa tra 1 minuto.'
    );
    expect(g.player('Bravo').houseBalloon).toBe(true);
    away(
      2000 * S,
      'Alfa (🎈) hai rubato 630 palle a Bravo (🎈), che non era a casa! Torni in Alfa tra 1 minuto.'
    );
    expect(g.player('Bravo').houseBalloon).toBe(false);
  });
});

describe('Telegram accounts', () => {
  it('marks a player the bot writes with @, for good, and addresses them so', () => {
    const g = new GameState();
    g.apply(msg(0, 'Alfa (🎈) hai rubato 40 palle a @Bravo (🎈)! Torni in Alfa tra 1 minuto.'));
    expect(g.player('Bravo').telegram).toBe(true);
    expect(g.player('Alfa').telegram).toBeUndefined();
    // The bot also writes Telegram accounts without @: that proves nothing.
    g.apply(msg(S, 'Bravo parti per Alfa: arrivi tra 5 secondi. Casa tua resta scoperta.'));
    expect(g.player('Bravo').telegram).toBe(true);
    expect([address(g, 'Bravo'), address(g, 'Alfa'), address(g, 'Nobody')]).toEqual([
      '@Bravo',
      'Alfa',
      'Nobody',
    ]);
  });
});

describe('richest', () => {
  it('ranks the known balances with the balls on the road, leaving out whom it is told', () => {
    const g = new GameState();
    g.player('Alfa').balance = { balls: 100, at: 0 };
    g.player('Bravo').balance = { balls: 90, at: 0 };
    g.player('Bravo').trip = {
      to: 'Alfa',
      departedAt: 0,
      arriveAt: 0,
      arrived: false,
      carrying: 30,
    };
    g.player('Charlie').balance = { balls: 110, at: 0 };
    g.player('Delta');
    expect(richest(g, 2)).toEqual(['Bravo', 'Charlie']);
    expect(richest(g, 5, ['Charlie'])).toEqual(['Bravo', 'Alfa']);
  });
});

describe('recent', () => {
  it('lists the players a bot line named lately, latest first, whatever their balls', () => {
    const g = new GameState();
    g.apply({
      time: 10 * S,
      text: 'x',
      events: parseMessage(
        'TeamPalla (🎈) hai rubato 0 palle a Bravo, che non era a casa! Torni in TeamPalla tra 58 secondi.'
      ),
    });
    g.apply({
      time: 20 * S,
      text: 'x',
      events: parseMessage(
        'Charlie parti per Delta: arrivi tra 1 minuto. Casa tua resta scoperta.'
      ),
    });
    expect(g.player('TeamPalla').seenAt).toBe(10 * S);
    expect(recent(g, 30 * S, 60 * S, 5)).toEqual(['Charlie', 'Delta', 'Bravo', 'TeamPalla']);
    expect(recent(g, 30 * S, 15 * S, 5, ['Charlie'])).toEqual(['Delta']);
    expect(recent(g, 30 * S, 60 * S, 1)).toEqual(['Charlie']);
  });
});

describe('balances and emoji', () => {
  it("keeps when the balance was stated whole, a refused purchase's included, and the 🐔", () => {
    const g = new GameState();
    g.apply(msg(0, 'Alfa', 'Con te: 🎈', '5000 palle, 1° su 3 in classifica'));
    g.apply(
      msg(10 * S, 'Alfa (🎈) hai rubato 300 palle a Bravo (🎈)! Torni in Alfa tra 1 minuto.')
    );
    // A theft moves the balance, but the bot did not state it.
    expect(g.player('Bravo').balanceReadAt).toBeUndefined();
    expect(g.player('Alfa').balanceReadAt).toBe(0);
    g.apply(msg(20 * S, 'Alfa ti servono 9000 palle per 💣 (ne hai 4900).'));
    expect(g.player('Alfa').balance).toEqual({ balls: 4900, at: 20 * S });
    expect(g.player('Alfa').balanceReadAt).toBe(20 * S);
    g.apply(msg(30 * S, 'Casa di Alfa (2/10):\n1 🐔  2 🐔  3  4  5  6  7  8  9  10'));
    expect(g.player('Alfa').hens).toBe(2);
  });

  it('finds a victim empty when a theft takes nothing, whatever it believed', () => {
    const g = new GameState();
    g.player('Bravo').balance = { balls: 641, at: 0 };
    g.apply(msg(10 * S, 'Alfa (🎈) hai rubato 0 palle a Bravo (🎈)! Torni in Alfa tra 1 minuto.'));
    expect(g.player('Bravo').balance).toEqual({ balls: 0, at: 10 * S });
  });

  it("carries a theft's loot home", () => {
    const g = new GameState();
    g.apply(msg(0, 'Alfa', 'Con te: 🎈', '5000 palle, 1° su 3 in classifica'));
    g.apply(
      msg(10 * S, 'Alfa (🎈) hai rubato 200 palle a Bravo (🎈)! Torni in Alfa tra 1 minuto.')
    );
    expect(g.player('Alfa').trip?.carrying).toBe(200);
    g.apply(msg(70 * S, 'Alfa (🎈) torni in Alfa con 200 palle.'));
    expect(g.player('Alfa').trip).toBeUndefined();
    expect(g.player('Alfa').balance?.balls).toBe(5200);
  });

  it('takes the balance a refused purchase states', () => {
    const g = new GameState();
    g.player('Alfa').balance = { balls: 5000, at: 0 };
    g.apply(msg(10 * S, 'Alfa ti servono 2250 palle per 🧊 (ne hai 1485).'));
    expect(g.player('Alfa').balance).toEqual({ balls: 1485, at: 10 * S });
    g.apply(msg(20 * S, 'Alfa (🎈) hai speso 1000 palle: 🧊 in casa nel posto 2.'));
    expect(g.player('Alfa').balance).toEqual({ balls: 485, at: 20 * S });
  });

  it('reads profiles and keeps the carried emoji current', () => {
    const g = new GameState();
    g.apply(msg(0, 'Alfa', 'Con te: 🥷🎈', '740 palle, 5° su 37 in classifica', 'a casa, in Alfa'));
    expect(g.player('Alfa')).toMatchObject({
      location: 'home',
      balance: { balls: 740 },
      carried: ['🥷', '🎈'],
    });
    g.apply(
      msg(
        0,
        'Alfa',
        '740 palle, 5° su 37 in classifica',
        'in viaggio verso Bravo: rientra tra 1 minuto'
      )
    );
    g.apply(msg(0, 'Alfa (🚀🎈) sei tornato in Alfa.'));
    expect(g.player('Alfa').carried).toEqual(['🚀', '🎈']);
    g.apply(msg(0, 'Alfa (🚀🎈) hai speso 1000 palle: 🎈 ora è con te.'));
    g.apply(msg(0, 'Bravo hai guadagnato 59 palle col ⚡ x1.1!'));
    expect(g.player('Alfa').balance?.balls).toBe(0);
    expect(g.player('Bravo').balance).toBeUndefined();
  });
});
