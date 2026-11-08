import { type Core, parseManifest } from '@megabottron1999/core';
import { describe, expect, it } from 'vitest';
import { NOT_YET } from '#src/map/map-command.ts';
import { type Pair } from '#src/map/measurements.ts';
import { type MapService, MEASUREMENTS, MEASUREMENTS_VERSION } from '#src/map/service.ts';
import { syntheticHomes } from '#test/homes.ts';
import { answer, kitWith, RAID, T0 } from '#test/plugins.ts';
import { MAP_COMMANDS, NORELEC_MAP, norelecMapPlugin, plugins } from './norelec-map.ts';

/** The map, as the plugin's interface offers it. */
const mapOf = (core: Core): MapService | undefined => {
  const r = core.controls.read(NORELEC_MAP, 'map');
  return 'value' in r ? (r.value as MapService) : undefined;
};

/** Measurements of synthetic homes, as the store keeps them. */
function measured(seed: number, n: number) {
  const pairs: Pair[] = syntheticHomes(seed, n).pairs.map(({ a, b, d }) => ({
    a,
    b,
    lo: d,
    hi: d,
    slack: 1,
    trips: 1,
    first: T0 - 60_000,
    last: T0 - 60_000,
    toB: [],
    toA: [],
  }));
  return { version: MEASUREMENTS_VERSION, holdings: {}, through: T0 - 60_000, pairs };
}

describe('the norelec-map plugin', () => {
  it('declares /map, the game it reads, and the map it offers', () => {
    const m = parseManifest(norelecMapPlugin.manifest);
    expect(Object.keys(m.interface.commands ?? {})).toEqual(Object.keys(MAP_COMMANDS));
    expect(m.inputs['game']).toMatchObject({ type: 'interface', plugin: 'norelec' });
    expect(m.outputs['interface']).toMatchObject({ members: ['state.map'] });
    expect(plugins).toEqual([norelecMapPlugin]);
    expect(norelecMapPlugin.manifest.config?.parse({})).toEqual({ restS: 90, settleMs: 60_000 });
  });

  it('answers /map with a line until the map can be drawn, and reads a first start’s trips', async () => {
    const { command, lines, k } = await kitWith(NORELEC_MAP, norelecMapPlugin, {
      config: { settleMs: 0 },
      logged: [{ time: T0 - 1000, text: RAID }],
    });
    expect(lines).toContain('norelec-map: map: read the trips of 1 logged bot messages');
    expect(mapOf(k.core)?.hasMeasurements).toBe(true);
    const r = answer();
    await command('map').run(r.a, { args: '' });
    expect(r.texts.map((t) => t.text)).toEqual([NOT_YET]);
  });

  it('starts with no trips without a log, and takes them live from the bus', async () => {
    const { k, say, lines, game } = await kitWith(NORELEC_MAP, norelecMapPlugin, {
      config: { settleMs: 0 },
    });
    expect(lines).toContain('norelec-map: map: read the trips of 0 logged bot messages');
    // Known to carry no 🚀, so that the trip's time is the base time.
    game().state.player('Alfa').carried = [];
    say(RAID, T0 + 1000);
    k.runUntil(T0 + 2000);
    expect(mapOf(k.core)?.baseS('Alfa', 'Bravo')).toBeGreaterThan(0);
    await k.stop();
  });

  it('draws the map with the shell’s render service, and sends it as a photo', async () => {
    const { command, lines } = await kitWith(NORELEC_MAP, norelecMapPlugin, {
      config: { settleMs: 0 },
      documents: { [MEASUREMENTS]: measured(1, 8) },
    });
    // Kept measurements: no first start's backfill.
    expect(lines.some((l) => l.includes('read the trips'))).toBe(false);
    const r = answer();
    await command('map').run(r.a, { args: '' });
    expect(r.texts).toEqual([]);
    const photo = r.photos[0] as { data: Uint8Array; filename: string };
    expect(photo.filename).toBe('mappa.png');
    expect(Buffer.from(photo.data.subarray(1, 4)).toString('latin1')).toBe('PNG');
    expect(lines.some((l) => l.startsWith('norelec-map: map drawn: '))).toBe(true);
    // Sent again by the id Telegram gave it.
    const again = answer();
    await command('map').run(again.a, { args: '' });
    expect(again.photos).toEqual(['file-1']);
  }, 60_000);
});
