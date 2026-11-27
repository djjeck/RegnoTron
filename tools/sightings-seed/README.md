# sightings-seed

Builds what `loregame-state` takes from Telegram Desktop exports at its next start: **each player's
ladder steps seen** (docs/game-bots.md §6.1), first and last, by their Telegram id, so that the
players' high-water marks, and their marks through time (`state.mark`), reach back before the live
event log. It replays the exports through the real `loregame` parser and `loregame-state` node, as
lore-check does (tools/lore-check/README.md), and writes one file.

```sh
npm run sightings-seed -- <export folder>… --owner "<your display name>" --username <your username> \
  --bot "<the bot's display name>" --since <the season's start> --out sightings-seed.json \
  [--time-zone Europe/Rome]
```

- **The arguments** are lore-check's, and `--out`, the file written. `--since` is the season's
  start, as the node's `season_start` (an older season's steps are another ladder's): what came
  before it is left out.
- **Who is who:** an export gives each sender's id and display name, never a username. A turn is its
  command's sender's, an arrival's or a `/v`'s the sender's of the command the bot's answer replies
  to, the owner's profile the owner's; another player's profile names a username, which the export
  does not tie to an id, and is left out, as is any sighting whose message the exports do not hold.
  It prints how many it read, and how many no message tied to an id.
- **Loading it:** put the file in the state's store on the instance's volume, as
  `sightings-seed.json` (`/data/instances/<the loregame-state node>/sightings-seed.json`), and
  restart: at its next start `loregame-state` (game-bots 0.58.0 or later) merges each player's steps
  into those it keeps, by id (the owner's under the owner's key, their id then known), each step's
  first sighting the earliest of the two and its last the latest, and removes the file. A second
  seed, or a sighting the live log holds already, adds nothing. A player the state keeps by username
  alone is kept apart under their id until an event links the two, then merged. It writes nothing
  else: no picture, no file, no other seed (a media seed is its own, tools/media-seed). A seed it
  cannot read is left in place, and logged.
- **It names players:** the file stays on your computer and the instance's volume, never in the
  repository (CLAUDE.md).
