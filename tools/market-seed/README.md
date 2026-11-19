# market-seed

Builds the market's history from Telegram Desktop exports, for `loregame-state` to take once: what
the companies were worth through time, the bot's updates' schedule, the companies' pages and each
player's investments, as the state holds them after the exports are replayed through the real
`loregame` parser and `loregame-state` node (as lore-check replays them,
tools/lore-check/README.md).

```sh
npm run market-seed -- <export folder>… --owner "<your display name>" --username <your username> \
  --bot "<the bot's display name>" --out market-seed.json [--since 2026-05-01] [--time-zone Europe/Rome]
```

- **The arguments** are lore-check's, and `--out`, the file written. The market started in May 2026:
  `--since 2026-05-01` replays what it needs.
- **Who is who:** an export names a player by their display name, the state by their username. A
  profile of the bot's (`👤 <username>`) answering a player's own `/info` or `/me` tells which is
  whose; a player never told keeps their display name.
- **Loading it**, once: put the file in the state's store on the instance's volume, as
  `market-seed.json` (`/data/instances/<the loregame-state node>/market-seed.json`), **before** the
  instance first starts `game-bots` 0.35.0: its migration takes it then (the market, the companies,
  and each player's investments), and never again.
- **It names players, and the companies' values are the group's:** the file stays on your computer
  and the instance's volume, never in the repository (CLAUDE.md).
