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
