# media-seed

Builds what `loregame-state` takes from Telegram Desktop exports at its next start: the places'
pictures and their requirements. It replays the exports through the real `loregame` parser and
`loregame-state` node, as lore-check does (tools/lore-check/README.md), and writes one file:

- **The pictures:** each place whose creation card, arrival or `/v` the exports hold a photo of
  (docs/game-bots.md §6.2), its pictures in the order seen (`via: "export"`, a picture changed a new
  entry), and each picture's bytes once, by its id (`sha256:<hex>`). Each photo is found by the
  message it belongs to (`tools/lore-check/photos.ts`: an export keeps its photos as files, which
  MegaBotTron1999's readers leave out).
- **The requirements** (`requirements`): each place's level, items and guardians as the replayed
  state holds them at its end, with when they were last told (`as_of`: a refusal, a `/requisiti`, an
  arrival; docs/game-bots.md §5.9). A place none were told of is left out.

```sh
npm run media-seed -- <export folder>… --owner "<your display name>" --username <your username> \
  --bot "<the bot's display name>" --out media-seed.json [--since 2026-08-17] [--time-zone Europe/Rome]
```

- **The arguments** are lore-check's, and `--out`, the file written. Only exports made with their
  photos hold any picture ("Photos" ticked in Telegram Desktop's export); the others give none, and
  the requirements still. It prints each place's requirements it carries.
- **Loading it:** put the file in the state's store on the instance's volume, as `media-seed.json`
  (`/data/instances/<the loregame-state node>/media-seed.json`), and restart: at its next start
  `loregame-state` (game-bots 0.45.0 or later) writes each picture into its files (`sha256-<hex>`;
  one it holds already is kept once), adds the entries to its places' lists in the order seen (the
  same picture next to itself kept once), and removes the file. From game-bots 0.46.0 it also takes
  each place's requirements, where those it holds were told before the seed's `as_of`, or never (its
  places' exits and pictures kept); those told since are kept. A seed it cannot read is left in
  place, and logged.
- **The pictures are the group's, and the chats are named by their titles:** the file stays on your
  computer and the instance's volume, never in the repository (CLAUDE.md).
