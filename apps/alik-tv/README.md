# Alik TV

A small IPTV player for the LG TV remote. On first start it asks for a playlist:
any M3U link, a country from the [iptv-org](https://github.com/iptv-org/iptv)
catalog, the checked Armenian, Russian and movie-channel lists, or public-domain
films from the Internet Archive, all from this repository
(`playlists/`, rebuilt daily). Channels of all added playlists are merged into one menu. Films continue where they
stopped, channels that fail are marked for a day, and there is search, folders and a
group manager (hide and reorder).

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
| Yellow (home) | On a tile: put it into a folder. On a folder in the menu: rename or delete it |
| Magic Remote | Hold a tile and drag it onto a folder in the menu, or onto the trash to take it out of the open folder |
| Blue (while watching) | Audio and subtitle tracks, when a channel has several |
| Settings (blue) | Theme, 18+ content with an optional 4-digit PIN, Magic Remote wheel zapping |
| Back | Close the menu / exit |

Settings also hold the interface language (Русский, English, Հայերեն), a sleep timer and
restore from backup. A small service (`service/`) keeps a copy of playlists, folders,
favourites and settings in `/media/developer/temp/alik`, so updating or reinstalling Alik
does not lose them; a fresh install restores it automatically.

Playback uses [hls.js](https://github.com/video-dev/hls.js) 1.5.20 (Apache-2.0, `app/vendor`).
The TV runs Chromium 79: no optional chaining, `??` or CSS `inset`.
