# Reso Coach Companion

Desktop companion for [app.reso.coach](https://app.reso.coach) — the Dota 2 AI coach.

Watches your Dota 2 replays folder, parses every `.dem` locally with a bundled
Go parser and uploads the parsed match to your reso.coach account, where the
coach analyzes it. Works for Immortal games that never reach public match
databases — the replay comes straight from your PC.

## Features

- **Steam sign-in** — link the app to your reso.coach account in one click
- **Auto-upload** — every finished match appears on your reso.coach home, ready for analysis
- **Backfill** — upload your local replays for the last week / month / all at once
- **Tray app** — closes to tray, auto-starts with the system, auto-updates

## Install

Download the latest installer from
[Releases](https://github.com/Resolut1onEDL/reso-coach-companion/releases):
`.exe` for Windows, `.dmg` for macOS (Apple Silicon).

macOS builds are unsigned — on first launch right-click the app → Open.

## Development

```bash
npm install   # also stages the parser binaries into bin/ (postinstall)
npm run dev
```

The replay parser binary is downloaded from the pinned release of
`dota-replay-parser` (see `parserVersion` in package.json).

## Release

Push a tag `vX.Y.Z` — CI builds mac + windows installers and publishes them to
GitHub Releases together with the auto-update manifests.
