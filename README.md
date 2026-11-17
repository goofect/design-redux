# Design Redux

Design Redux is a desktop Obsidian plugin for browsing a vault as a library.
It brings folders and notes together with note properties, maps, and property
tools in a shared visual design.

## Development

Install the dependencies with `npm ci`, then run `npm run build` to build
`main.js` and `styles.css`. Run `npm test` for the simulation suites; this also
builds the plugin and its design specimen. The real-Obsidian suite is available
with `npm run test:obsidian`.

Source modules live in `src/`, styles in `styles/`, and icons in
`assets/icons/`. See [AGENTS.md](AGENTS.md) for the code structure and project
rules, [the design language](docs/design-language.md) for the visual system,
and [the specimen](docs/specimen.html) for its components.

See [the rewrite notes](docs/release-notes.md) for changes and settings
migration details. The version in `manifest.json` identifies the current
repository version.
