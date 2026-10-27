# Alik TV

A small IPTV player for the LG TV remote. It plays
`playlists/armenia-russia.m3u` from this repository (Armenian channels first,
then live Russian ones), built daily from [iptv-org](https://github.com/iptv-org/iptv).

| Key | Action |
|---|---|
| OK | Channel menu (OK again to watch) |
| ↑ ↓ / CH+ CH− | Next / previous channel; in the menu, move (CH± jumps by 8) |
| ← → | In the menu: groups and channels |
| Digits | Go to channel number |
| INFO | Show the channel info |
| Back | Close the menu / exit |

Playback uses [hls.js](https://github.com/video-dev/hls.js) 1.5.20 (Apache-2.0, `app/vendor`).
The TV runs Chromium 79: no optional chaining, `??` or CSS `inset`.
