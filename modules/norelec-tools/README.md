# @regnotron/norelec-tools

Read-only tools for NorelecBot's group, on the `norelec` module's game:

- `src/map/`: the map of the players' homes, fitted to the trip times the bot announces, drawn as an
  SVG and rendered to a PNG by the shell's render service (`ctx.render.svgToPng`), with a bundled
  font (IBM Plex Mono, OFL, `src/map/fonts/`);
- `src/clock/`: the nuclear clock, which posts when the balls in the game cross each 50,000, and
  `/nuclear_warning`;
- `src/plugins/`: the plugins `norelec-map` (`/map`, and the map offered as `state.map`) and
  `nuclear-clock` (`/nuclear_warning`, and the posts in the group while its `nuclearClock` setting
  is on).

Both read the game through the `norelec` plugin's `state.game` and hear its `norelec.message`
events. The map's fit runs on the event loop, about half a second on a full map, only when the
measured trips have changed and settled; the rendering runs off it, in the shell.

## Configuration

Both are built from their node's config alone, and read the bot messages of the event log
(`ctx.events`) once, at a first start, to measure the trips and take the clock's level. Each store's
one migration is a no-op, so that v0's `norelec-utilities` store (at version 1), which kept the map
and the clock, can be imported as either instance (MegaBotTron1999's docs/bot-os.md D54).

**`norelec-map`:** inputs `game` (`norelec`'s `state.game`) and `messages` (`norelec`'s events).

| Config     | Default | Meaning                                                                          |
| ---------- | ------- | -------------------------------------------------------------------------------- |
| `restS`    | `90`    | Rest after a return, in seconds, for the game state a first start replays        |
| `settleMs` | `60000` | Quiet after the trips change before the map is drawn again; `0`: only when asked |

**`nuclear-clock`:** inputs `game`, `messages` and `group`, a chat edge from a `telegram-bot` node
that sends to the group; the setting `nuclearClock` (off until the owner turns it on).

| Config  | Default | Meaning                                                                     |
| ------- | ------- | --------------------------------------------------------------------------- |
| `group` | none    | The game's Telegram group, by its chat id: the posts go there; none without |
| `restS` | `90`    | Rest after a return, in seconds, for the game state a first start replays   |
