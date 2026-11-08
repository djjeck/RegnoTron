import { describe, expect, it } from 'vitest';
import { type BotMessage } from '#src/game/bot-message.ts';
import { parseMessage } from '#src/game/parse-message.ts';
import { address, GameState, icePrice, recent, richest } from './game-state.ts';

const S = 1000;
const msg = (time: number, ...lines: string[]): BotMessage => {
  const text = lines.join('\n');
  return { time, text, events: parseMessage(text) };
};
const kinds = (notices: { kind: string }[]): string[] => notices.map((n) => n.kind);

describe('trips', () => {
  it('follows a raid from departure to return, and the rest after it', () => {
    const g = new GameState({ restS: 60 });
    g.apply(msg(0, '1) Bravo (🎈) — 1000 palle', '2) Alfa — 10 palle'));
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

  it('tells throws and gifts from raids', () => {
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
    expect(
      kinds(
        g.apply(
          msg(
            0,
            'Charlie parti per Bravo con 500 palle da consegnare: arrivi tra 30 secondi. Casa tua resta scoperta.'
          )
        )
      )
    ).toEqual(['incomingGift']);
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

describe('@TheConquister37', () => {
  it('follows the holder, and spots an entry that ousts nobody', () => {
    const g = new GameState();
    expect(kinds(g.apply(msg(0, 'Alfa sei in @TheConquister37!')))).toEqual(['holderChanged']);
    expect(g.holder).toEqual({ name: 'Alfa', since: 0 });
    expect(g.player('Alfa').location).toBe('conquister');

    const real = g.apply(
      msg(
        10 * S,
        'Bravo (🎈) hai bucato il palloncino di Alfa (🎈)!',
        'Bravo hai cacciato Alfa da @TheConquister37.',
        'Alfa hai guadagnato 10 palle!',
        'Bravo sei in @TheConquister37!'
      )
    );
    expect(kinds(real)).toEqual(['holderChanged']);
    expect(g.player('Alfa').location).toBe('home');

    const fake = g.apply(
      msg(
        20 * S,
        'Charlie (🎈) hai bucato il palloncino di Bravo (🎈)!',
        'Charlie sei in @TheConquister37!'
      )
    );
    expect(fake).toEqual([{ kind: 'fakeEntry', at: 20 * S, player: 'Charlie', detail: 'Bravo' }]);
    expect(g.holder?.name).toBe('Bravo');

    expect(kinds(g.apply(msg(30 * S, 'In @TheConquister37 ora: Bravo (🎈)')))).toEqual([]);
    g.apply(msg(40 * S, 'Bravo torni da @TheConquister37 in @Bravo con 30 palle.'));
    expect(g.holder).toBeUndefined();
    expect(kinds(g.apply(msg(50 * S, 'In @TheConquister37 ora: Charlie (🎈)')))).toEqual([
      'holderChanged',
    ]);
  });

  it('times the penalty after a failed entry', () => {
    const g = new GameState({ penaltyS: 300 });
    g.apply(
      msg(
        0,
        'Alfa (🎈) il palloncino di Bravo (🎈) ha resistito e prendi una penalità. Ora il palloncino ha il 50% di probabilità di essere bucato.'
      )
    );
    expect(g.player('Alfa').penaltyUntil).toBe(300 * S);
    expect(g.tick(300 * S)).toEqual([{ kind: 'penaltyOver', at: 300 * S, player: 'Alfa' }]);
    g.apply(
      msg(
        0,
        'Alfa (🎈) il palloncino di Bravo (🎈) ha resistito e prendi 2 minuti di penalità. Ora il palloncino ha il 75% di probabilità di essere bucato.'
      )
    );
    expect(g.player('Alfa').penaltyUntil).toBe(120 * S);
  });
});

describe('freezes and 🧊', () => {
  it('freezes a target for 30 minutes, less 10% per 🔥 it carries', () => {
    const g = new GameState();
    g.apply(msg(0, 'In @TheConquister37 ora: Bravo (🎈🔥🔥)'));
    g.iceCopies = { n: 2, at: 0 };
    const out = g.apply(
      msg(
        0,
        'Alfa (🎈) congeli Bravo: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende. Torni in Alfa tra 30 secondi.'
      )
    );
    expect(out).toEqual([{ kind: 'frozen', at: 0, player: 'Bravo', by: 'Alfa' }]);
    expect(g.player('Bravo').frozenUntil).toBe(24 * 60 * S);
    expect(g.iceCopies).toEqual({ n: 1, at: 0 });

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

  it('counts the 🧊 in the game from purchases and refusals, and prices the next one', () => {
    const g = new GameState();
    expect(g.icePrice()).toBeUndefined();
    g.apply(msg(0, 'Alfa (🎈) hai speso 1000 palle: 🧊 in casa nel posto 2.'));
    expect(g.iceCopies).toEqual({ n: 1, at: 0 });
    g.apply(msg(0, 'Alfa ti servono 2250 palle per 🧊 (ce ne sono già 2 in giro, ne hai 641).'));
    expect(g.icePrice()).toBe(2250);
    g.apply(msg(0, 'Bravo (🎈) hai speso 2250 palle: 🧊 in casa nel posto 3.'));
    expect(g.iceCopies?.n).toBe(3);
    g.apply(
      msg(
        0,
        "Charlie (🎈) hai speso 3375 palle: 🧊 ora è con te (ce n'erano già 3 in giro, prezzo x3.37)."
      )
    );
    expect(g.iceCopies?.n).toBe(4);
    g.apply(msg(0, 'Charlie ti servono 1000 palle per 💣 (ce ne sono già 0 in giro, ne hai 5).'));
    expect(g.iceCopies?.n).toBe(4);
    expect(icePrice(0)).toBe(1000);
    expect(icePrice(4)).toBe(5062);
  });

  it('takes a profile in @TheConquister37 for the holder', () => {
    const g = new GameState();
    const out = g.apply(
      msg(
        0,
        'Juno\nCon te: 🥷🎈🔥\n152505 palle, 1° su 37 in classifica\nin @TheConquister37 da 42 minuti e 23 secondi'
      )
    );
    expect(kinds(out)).toEqual(['holderChanged']);
    expect([g.holder?.name, g.player('Juno').carried]).toEqual(['Juno', ['🥷', '🎈', '🔥']]);
  });

  it('takes the stated minutes of the wording of 23 Oct, 🔥 already counted', () => {
    const g = new GameState();
    g.apply(msg(0, 'In @TheConquister37 ora: Bravo (🎈🔥🔥)'));
    g.apply(
      msg(
        0,
        'Alfa congeli Bravo in @TheConquister37: per 24 minuti non può partire e, se lo cacciano, non può rientrare.'
      )
    );
    expect(g.player('Bravo').frozenUntil).toBe(24 * 60 * S);
    expect(g.player('Alfa').trip).toBeUndefined();
  });

  it("keeps each player's 🧊: bought, carried off with 🏴‍☠️, thrown", () => {
    const g = new GameState();
    g.player('Bravo').ice = 1;
    g.apply(msg(0, 'Alfa (🎈) hai speso 1000 palle: 🧊 in casa nel posto 2.'));
    expect(g.player('Alfa').ice).toBe(1);
    g.apply(
      msg(
        0,
        'Alfa (🏴‍☠️🎈) hai rubato 411 palle a Bravo (🎈), che non era a casa! Torni in Alfa tra 58 secondi.',
        'Arrembaggio: ti porti via anche 🧊 da casa sua: ora hai con te 🏴‍☠️🧊🎈.'
      )
    );
    expect([g.player('Alfa').ice, g.player('Bravo').ice]).toEqual([2, 0]);
    g.apply(
      msg(
        0,
        'Alfa (🎈) congeli Bravo in @TheConquister37: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende.'
      )
    );
    expect(g.player('Alfa').ice).toBe(1);
    // A throw at the holder is instant: it starts no trip for the thrower.
    const fresh = new GameState();
    fresh.apply(
      msg(
        0,
        'Charlie congeli Bravo in @TheConquister37: per 30 minuti non può entrare in @TheConquister37 né partire, e il suo 🎈 non difende.'
      )
    );
    expect(fresh.player('Charlie').trip).toBeUndefined();
    g.apply(msg(0, 'Alfa (🏴‍☠️🎈) hai rubato 411 palle a Bravo (🎈)! Torni in Alfa tra 58 secondi.'));
    g.apply(msg(0, 'Arrembaggio: ti porti via anche 💣 da casa sua'));
    expect([g.player('Alfa').ice, g.player('Bravo').ice]).toEqual([1, 0]);
  });

  it('prices every emoji from purchases and refusals, less the copies used up', () => {
    const g = new GameState();
    expect([g.price('🎈'), g.price('☢️'), g.price('🐔')]).toEqual([1000, 1_000_000, undefined]);
    g.apply(msg(0, 'Alfa (🎈) hai speso 2250 palle: 💣 in casa nel posto 2.'));
    g.apply(msg(0, 'Alfa ti servono 1500 palle per ⚡️ (ne hai 10).'));
    g.apply(msg(0, 'Alfa (🎈) hai speso 1000 palle: 🎈 in casa nel posto 3.'));
    expect([g.price('💣'), g.price('⚡️'), g.price('⚡'), g.copies.has('🎈')]).toEqual([
      3375,
      1500,
      undefined,
      false,
    ]);
    g.apply(
      msg(
        0,
        'Alfa la tua bomba esplode addosso a @Bravo (🎈⚡️) in @TheConquister37 e si porta via ⚡️: ora @Bravo ha con sé 🎈.'
      )
    );
    expect([g.price('💣'), g.price('⚡️')]).toEqual([2250, 1000]);
    g.apply(msg(0, 'Alfa (🎈) hai speso 1000 palle: 💦 ora è con te.'));
    g.apply(
      msg(0, 'Alfa la tua 💦 è arrivata addosso a Bravo in @TheConquister37: tra 9 ore si vedrà.')
    );
    expect(g.price('💦')).toBe(1000);
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
      'Charlie congeli Bravo in @TheConquister37: per 24 minuti non può partire e, se lo cacciano, non può rientrare.'
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
  it("keeps when the balance was stated whole, a refused gift's included, and the 🐔", () => {
    const g = new GameState();
    g.apply(msg(0, '1) Alfa (🎈) — 5000 palle — 1 citazioni'));
    g.apply(
      msg(10 * S, 'Alfa (🎈) hai rubato 300 palle a Bravo (🎈)! Torni in Alfa tra 1 minuto.')
    );
    // A theft moves the balance, but the bot did not state it.
    expect(g.player('Bravo').balanceReadAt).toBeUndefined();
    expect(g.player('Alfa').balanceReadAt).toBe(0);
    g.apply(msg(20 * S, 'Alfa hai solo 4900 palle a disposizione.'));
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

  it("moves a gift's balls: from the giver at departure, to the recipient on delivery", () => {
    const g = new GameState();
    g.apply(
      msg(0, '1) Alfa (🎈) — 5000 palle — 1 citazioni', '2) Bravo (🎈) — 300 palle — 0 citazioni')
    );
    g.apply(
      msg(
        1 * S,
        'Alfa parti per Bravo con 4000 palle da consegnare: arrivi tra 1 minuto. Casa tua resta scoperta.'
      )
    );
    expect(g.player('Alfa').balance?.balls).toBe(1000);
    expect(g.player('Alfa').trip?.carrying).toBe(4000);
    expect(g.player('Bravo').balance?.balls).toBe(300);
    g.apply(
      msg(
        61 * S,
        'Alfa (🎈) hai consegnato 4000 palle a @Bravo (🎈)! Torni in @Alfa tra 57 secondi.'
      )
    );
    expect(g.player('Bravo').balance?.balls).toBe(4300);
    expect(g.player('Alfa').trip?.carrying).toBeUndefined();
    // An emoji given moves no balls.
    g.apply(
      msg(
        200 * S,
        'Alfa parti per Bravo con 🍕 da regalare: arrivi tra 1 minuto. Casa tua resta scoperta.'
      )
    );
    expect(g.player('Alfa').balance?.balls).toBe(1000);
  });

  it("carries a theft's loot, and a gift turned back, home", () => {
    const g = new GameState();
    g.apply(msg(0, '1) Alfa (🎈) — 5000 palle', '2) Bravo (🎈) — 300 palle'));
    g.apply(
      msg(10 * S, 'Alfa (🎈) hai rubato 200 palle a Bravo (🎈)! Torni in Alfa tra 1 minuto.')
    );
    expect(g.player('Alfa').trip?.carrying).toBe(200);
    g.apply(msg(70 * S, 'Alfa (🎈) torni in Alfa con 200 palle.'));
    expect(g.player('Alfa').trip).toBeUndefined();
    expect(g.player('Alfa').balance?.balls).toBe(5200);
    g.apply(
      msg(
        100 * S,
        'Alfa parti per Bravo con 5200 palle da consegnare: arrivi tra 1 minuto. Casa tua resta scoperta.'
      )
    );
    g.apply(msg(110 * S, 'Alfa lasci perdere e torni in Alfa: arrivi tra 10 secondi.'));
    expect(g.player('Alfa').trip?.carrying).toBe(5200);
    g.apply(msg(120 * S, 'Alfa (🎈) torni in Alfa con le tue 5200 palle ancora in tasca.'));
    expect(g.player('Alfa').trip).toBeUndefined();
    expect(g.player('Alfa').balance?.balls).toBe(5200);
  });

  it('counts the balls found, collected, paid for salt, spent on quotes and burnt', () => {
    const g = new GameState();
    g.apply(msg(0, '1) Alfa (🎈) — 5000 palle', '2) Bravo (🎈) — 300 palle'));
    g.apply(
      msg(
        1 * S,
        'Alfa parti per Bravo: arrivi tra 58 secondi. Casa tua resta scoperta.',
        'Lungo la via trovi 210 palle!'
      )
    );
    expect(g.player('Alfa').balance?.balls).toBe(5210);
    g.apply(
      msg(
        59 * S,
        'Alfa (🎈) hai rubato 0 palle a Bravo (🎈)! Torni in Alfa tra 1 minuto.',
        'Ci torni troppo presto: il 🧂 di @Bravo ti costa 210 palle, che vanno a lui.'
      )
    );
    expect(g.player('Alfa').balance).toEqual({ balls: 5000, at: 59 * S });
    expect(g.player('Bravo').balance).toEqual({ balls: 210, at: 59 * S });
    g.apply(msg(60 * S, '🎒 Bravo raccoglie il sacchetto del viandante: 1762 palle!'));
    expect(g.player('Bravo').balance?.balls).toBe(1972);
    g.apply(msg(61 * S, 'Alfa hai aggiunto la citazione spendendo 1000 palle!'));
    expect(g.player('Alfa').balance?.balls).toBe(4000);
    g.apply(msg(62 * S, 'Alfa hai bruciato 159 palle: sono uscite dal gioco. Te ne restano 3841.'));
    g.apply(msg(63 * S, 'Alfa hai bruciato 🏴‍☠️: è uscita dal gioco.'));
    expect(g.player('Alfa').balance).toEqual({ balls: 3841, at: 62 * S });
  });

  it('empties a home a ☢️ hits, and every balance when it hits the place', () => {
    const g = new GameState();
    g.apply(
      msg(0, '1) Alfa (🎈) — 5000 palle', '2) Bravo (🎈) — 300 palle', '3) Charlie — 9 palle')
    );
    g.apply(msg(1 * S, 'Alfa ha sganciato la bomba nucleare su casa di @Bravo: riparte da zero.'));
    expect(g.player('Bravo').balance).toEqual({ balls: 0, at: 1 * S });
    expect(g.player('Alfa').balance?.balls).toBe(5000);
    g.apply(
      msg(
        2 * S,
        'Alfa ha sganciato la bomba nucleare su @TheConquister37: il gioco riparte da zero.'
      )
    );
    expect([...g.players.values()].map((p) => p.balance)).toEqual([
      { balls: 0, at: 2 * S },
      { balls: 0, at: 2 * S },
      { balls: 0, at: 2 * S },
    ]);
  });

  it('brings a balance known above the last row of a leaderboard down to it', () => {
    const g = new GameState();
    g.player('Delta').balance = { balls: 9000, at: 0 };
    g.player('Echo').balance = { balls: 50, at: 0 };
    g.player('Alfa').balance = { balls: 1, at: 0 };
    g.apply(
      msg(
        10 * S,
        'Classifica @TheConquister37',
        '1) Alfa (🎈) — 5000 palle — 3 citazioni',
        '2) Bravo (🎈) — 300 palle',
        '3) Charlie — 100 palle'
      )
    );
    expect(g.player('Alfa').balance).toEqual({ balls: 5000, at: 10 * S });
    expect(g.player('Delta').balance).toEqual({ balls: 100, at: 10 * S });
    expect(g.player('Echo').balance).toEqual({ balls: 50, at: 0 });
    // Rows missing in the middle, or none, cap nobody.
    g.player('Delta').balance = { balls: 9000, at: 0 };
    g.apply(msg(20 * S, '1) Alfa (🎈) — 5000 palle', '3) Charlie — 100 palle'));
    g.apply(msg(20 * S, 'Classifica @TheConquister37'));
    expect(g.player('Delta').balance?.balls).toBe(9000);
  });

  it('takes the balance a refused purchase states', () => {
    const g = new GameState();
    g.player('Alfa').balance = { balls: 5000, at: 0 };
    g.apply(
      msg(10 * S, 'Alfa ti servono 2250 palle per 🧊 (ce ne sono già 2 in giro, ne hai 1485).')
    );
    expect(g.player('Alfa').balance).toEqual({ balls: 1485, at: 10 * S });
    expect(g.icePrice()).toBe(2250);
  });

  it("counts a player's 🧊 from the house and the carried emoji", () => {
    const g = new GameState();
    g.apply(msg(0, 'Casa di Alfa (3/10):', '1 🧊  2 💣  3 🧊', '4', '5', '6', '7', '8', '9', '10'));
    expect(g.player('Alfa')).toMatchObject({ ice: 2, house: { 0: '🧊', 1: '💣', 3: null } });
    g.apply(msg(0, 'Alfa', 'Con te: 🎈🧊', '740 palle, 5° su 37 in classifica', 'a casa, in Alfa'));
    g.apply(msg(0, 'Casa di Alfa (2/10):', '1 🧊  2 💣  3', '4', '5', '6', '7', '8', '9', '10'));
    expect(g.player('Alfa').ice).toBe(2);
    // Never fewer than those carried, the house unread (after a restart, say).
    const restarted = new GameState();
    restarted.apply(msg(0, 'Alfa (🏴‍☠️🚀🎈🧊) sei tornato in @Alfa.'));
    expect(restarted.player('Alfa').ice).toBe(1);
  });

  it('keeps the house as purchases fill it, and forgets it when it turns out full', () => {
    const g = new GameState();
    g.apply(msg(0, 'Casa di Alfa (1/10):', '1 🎈  2', '3', '4', '5', '6', '7', '8', '9', '10'));
    g.apply(
      msg(0, 'Alfa (🎈) hai speso 1000 palle: 💣 in casa nel posto 2 (). Non dà nessun bonus.')
    );
    expect(g.player('Alfa').house?.slice(0, 3)).toEqual(['🎈', '💣', null]);
    // Carried, the house is as it was.
    g.apply(
      msg(0, "Alfa (🎈🎈) hai speso 1000 palle: 🎈 ora è con te (ce n'erano già 45 in giro).")
    );
    expect(g.player('Alfa').house?.[2]).toBeNull();
    g.apply(msg(0, 'Alfa hai già tutti i 10 posti della casa pieni: scegli quale sostituire.'));
    expect(g.player('Alfa').house).toBeUndefined();
    // A purchase into a house never read, or a slot not named, leaves it unknown.
    g.apply(
      msg(0, 'Alfa (🎈) hai speso 1000 palle: 💣 in casa nel posto 3 (). Non dà nessun bonus.')
    );
    expect(g.player('Alfa').house).toBeUndefined();
  });

  it("keeps a target's house as a 🏴‍☠️ empties it, and the raider's slots after the plunder", () => {
    const g = new GameState();
    const house = (n: string, first: string): BotMessage =>
      msg(5 * S, `Casa di Bravo (${n}/10):`, first, '4', '5', '6', '7', '8', '9', '10');
    g.apply(house('2', '1 🧊  2 🏳️‍⚧️  3'));
    expect(g.player('Bravo').houseAt).toBe(5 * S);
    const plunder = (t: number, emoji: string): void => {
      g.apply(
        msg(
          t,
          'Alfa (🏴‍☠️[]🎈) hai rubato 0 palle a Bravo, che non era a casa! Torni in Alfa tra 58 secondi.',
          `Arrembaggio: ti porti via anche ${emoji} da casa sua: ora hai con te 🏴‍☠️${emoji}🎈.`
        )
      );
    };
    plunder(10 * S, '🧊');
    expect(g.player('Bravo').house?.slice(0, 2)).toEqual([null, '🏳️‍⚧️']);
    expect(g.player('Alfa').carried).toEqual(['🏴‍☠️', '🧊', '🎈']);
    expect([g.player('Alfa').ice, g.player('Bravo').ice]).toEqual([1, 0]);
    // An emoji the house as read does not hold: the house is out of date, and to be read again.
    plunder(20 * S, '🐔');
    expect(g.player('Bravo').house).toBeUndefined();
  });

  it('forgets a house that a 💣 or a gift changed, which the log does not detail', () => {
    const g = new GameState();
    const read = (): void => {
      g.apply(msg(0, 'Casa di Bravo (1/10):', '1 🐔  2  3', '4', '5', '6', '7', '8', '9', '10'));
    };
    read();
    g.apply(
      msg(
        0,
        'Alfa (🎈) la tua bomba esplode in casa di @Bravo (🎈) e si porta via 🐔! Torni in Alfa tra 1 minuto e 46 secondi.'
      )
    );
    expect(g.player('Bravo').house).toBeUndefined();
    read();
    g.apply(
      msg(
        0,
        'Alfa (🎈) la tua bomba esplode in casa di @Bravo (🎈) ma non trova niente da portarsi via. Torni in Alfa tra 44 secondi.'
      )
    );
    expect(g.player('Bravo').house).toBeDefined();
    g.apply(msg(0, 'Alfa (🎈) hai regalato 🏳️‍⚧️ a Bravo (🎈)! Torni in @Alfa tra 49 secondi.'));
    expect(g.player('Bravo').house).toBeUndefined();
  });

  it('moves emoji between the house and the carried slots on /store and /take', () => {
    const g = new GameState();
    g.apply(msg(0, 'Casa di Alfa (1/10):', '1 🧊  2  3', '4', '5', '6', '7', '8', '9', '10'));
    g.apply(msg(0, 'Alfa (🧊🎈) 🧊 ora è con te: non dà nessun bonus.'));
    expect(g.player('Alfa').house?.[0]).toBeNull();
    g.apply(msg(0, 'Alfa ([]🎈) 🧊 ora è in casa: non dà nessun bonus.'));
    expect(g.player('Alfa').house?.[0]).toBe('🧊');
    g.apply(
      msg(0, 'Alfa (🧊) 🧊 ora è con te al posto di 🎈, che torna in casa: non dà nessun bonus.')
    );
    expect(g.player('Alfa').house?.[0]).toBe('🎈');
    // Into a full house the slot is not known: read it again.
    g.apply(
      msg(
        0,
        'Casa di Alfa (10/10):',
        '1 🎈  2 🐔  3 🐔',
        '4 🐔',
        '5 🐔',
        '6 🐔',
        '7 🐔',
        '8 🐔',
        '9 🐔',
        '10 🐔'
      )
    );
    g.apply(msg(0, 'Alfa ([]) 🧊 ora è in casa: non dà nessun bonus.'));
    expect(g.player('Alfa').house).toBeUndefined();
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
