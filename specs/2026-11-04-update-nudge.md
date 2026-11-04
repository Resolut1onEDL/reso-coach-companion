# Update nudge: the player is told to update when he sits down to play

1. **Problem.** KvartmaN (112337537) runs 0.1.14 (parser 4.14.0) two weeks after 0.1.15
   (parser 4.15.4) was released on 21.10: all 24 of his lobby uploads since then lack the
   lane-wave metrics. The app checks for updates once at start and installs only on quit; it
   lives in the tray, so a player who never quits it never updates — silently.
2. **Goal (the founder, 04.11).** An update never hangs silently: when the player sits down
   to play and a newer version is out, he gets «нужно обновить» like in any app, and one
   click updates.
3. **Already there.** `electron-updater` with GitHub releases, `autoDownload = true`,
   `autoInstallOnAppQuit = true`; the «Обновление» card in `index.html` with a restart
   button (`quit-and-install`); Russian UI strings are literals in `main.js` / `index.html`.
   macOS builds are unsigned (CI `CSC_IDENTITY_AUTO_DISCOVERY=false`) — Squirrel.Mac refuses
   to install an unsigned update, so on a Mac «Обновить» opens the download page instead.
4. **Change.**
   - Check for updates at start, then every 3 hours, and again when Dota starts (if the last
     check is older than 10 minutes).
   - Dota start = the `dota2` process appears (polled once a minute: `tasklist` on Windows,
     `pgrep` elsewhere).
   - When Dota starts and a newer version is available or downloaded → a system notification
     (once per Dota session). Also when the download finishes while Dota is already running.
   - A tray menu item «Обновить до X.Y.Z» at the top while an update is pending.
   - «Обновить» (notification click / tray item / window button): if downloaded → restart
     into the new version; if still downloading → install the moment it is downloaded.
5. **Copy (Russian only — the companion's UI is Russian).**
   - Title: «Обнови компаньон» (the founder picked the short version, 04.11)
   - Body: «Новый парсер, версия X.Y.Z — нажми, чтобы обновить.» (Mac: «…чтобы скачать.»)
   - Mac notification button: «Обновить».
   - Tray: «Обновить до X.Y.Z».
6. **Not doing.** No forced update, no blocking of uploads on an old version (the web side
   replaces a lobby re-uploaded by a newer parser — ResoAI-web PR #23), no Mac signing.
7. **Check.** `npm test` (the decision logic and the process check are unit-tested in
   `test/update-nudge.test.js`); by hand: an old packaged build in the tray, Dota started →
   the notification shows, «Обновить» installs the new version. Release (tag) — the founder.
