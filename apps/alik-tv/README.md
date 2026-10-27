# Alik TV

A small IPTV player for the LG TV remote. On first start it asks for a playlist:
any M3U link, a country from the [iptv-org](https://github.com/iptv-org/iptv)
catalog, the checked Armenian, Russian and movie-channel lists, or public-domain
films from the Internet Archive, all from this repository
(`playlists/`, rebuilt daily). Channels of all added playlists are merged into one menu.

| Key | Action |
|---|---|
| OK | Channel menu (OK again to watch) |
| ↑ ↓ / CH+ CH− | Next / previous channel; in the menu, move (CH± jumps by 8) |
| ← → | In the menu: groups and channels |
| Digits | Go to channel number |
| ← → / REW FF | Films: back / forward 30 s |
| Play / Pause | Films: pause and resume |
| INFO | Show the channel info |
| Green | Playlists: add a link, a preset or a country, remove one |
| Back | Close the menu / exit |

Playback uses [hls.js](https://github.com/video-dev/hls.js) 1.5.20 (Apache-2.0, `app/vendor`).
The TV runs Chromium 79: no optional chaining, `??` or CSS `inset`.
