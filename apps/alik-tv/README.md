# Alik TV

An IPTV and film player for LG webOS TVs, made for the remote: channel tiles with
logos and the current programme, folders, favourites, your own M3U playlists and a
PIN lock for 18+. Russian, English and Armenian interface. Works in Developer Mode,
no root needed.

"Alik" (ալիք) is Armenian for both *channel* and *wave*.

## First start

Alik opens the **Playlists** screen. Pick one or more:

- **your own link** to any M3U / M3U8 playlist (or send it from a phone, see below);
- a **ready playlist** from this repository, checked every day: Armenia, Russia, movie
  channels (English, Russian, Armenian), classic films and an 18+ vintage-film list
  from the Internet Archive;
- a **country** from the [iptv-org](https://github.com/iptv-org/iptv) catalogue.

**From a phone:** while the Playlists screen is open, it shows a QR code. Scan it with
a phone on the same network, paste the link on the page that opens and send it; the
playlist appears on the TV at once. The page is served by Alik's own service on port
8095 (or the next free one up to 8099), under a random path that changes every time the
screen opens, and the server stops when you leave the screen.

Channels of all playlists are merged into one menu. The same stream in two playlists
shows once.

## Home screen

On the left: Search, Favourites, your folders, All channels, All films, one row per
playlist, then the groups. Groups named like `Russia: Kids` are nested under a
collapsible **Russia ›** row (OK opens or closes it, → shows all its channels); which
folders are open is remembered. Groups with one or two channels are folded into
"Other". On the right: tiles with the channel number, logo, the programme on air and
its progress.

## TV guide screen

**TV guide** at the top of the menu shows every channel that has a guide, in channel
number order, three hours across, with a line at the current time. The programme in
focus is shown large above the grid. ▲ ▼ change the channel, ◀ ▶ go to the previous or
next programme (up to an hour back and as far ahead as the guide goes), CH± page
through channels, OK switches to the channel, Back returns to the menu. Hidden groups
are left out. With the Magic Remote, the first click selects a programme and the
second switches to its channel.

## Remote control

| Key | Home screen | While watching |
|---|---|---|
| OK | watch the tile; on a parent group, open or close it | live TV: home screen; film: pause / resume |
| Long OK | in a folder or Favourites: take the channel out (yellow undoes); elsewhere: folder picker | — |
| ← → ▲ ▼ | move between tiles and sections | live TV: ← → quick channel strip over the picture, ▲ ▼ channel info; film: ← → seek (10 s, faster presses 1 and 5 min) |
| CH+ CH− | page through tiles | switch channel (the only keys that do) |
| 0–9 | go to channel number | go to channel number |
| Red | add to / remove from Favourites | add to / remove from Favourites |
| Green | Playlists | Playlists |
| Yellow | tile: put into a folder, set your own channel number; folder row: rename or delete | previous channel |
| Blue | Settings | audio and subtitle tracks (when a channel has several), otherwise Settings |
| INFO | help with all keys | channel info |
| Back | ask to exit | home screen |

**Magic Remote:** point and press the wheel to open; the wheel scrolls menus.

## Settings (blue key)

- **Language:** Русский, English, Հայերեն (Alik restarts).
- **Playlists and catalogues**, **Groups** (hide groups, change their order with CH±).
- **Theme:** Apricot, Pomegranate, Sevan or the light Ararat, with an Ararat backdrop.
- **Show 18+:** needs a 4-digit PIN first. With a PIN, 18+ is locked on every start;
  "Unlock 18+" / "Lock 18+" are at the bottom of Settings. A playlist with any group
  named 18+, adult or XXX is hidden as a whole while 18+ is locked.
- **Start in the player:** open straight on the last channel.
- **Hide channels that do not work:** channels that failed in the last 24 hours (they are
  greyed out with "not answering" otherwise).
- **Restore from backup.**

## Films

Films (MP4 from the Internet Archive or any playlist) continue where you stopped;
near the end they start over next time. The player bar shows the position, what is
loaded and the time left.

## Backup

A small service (`service/`) keeps a copy of playlists, folders, favourites, own
numbers, open folders and settings. The service jail hides `/media/developer/temp`,
so the copy lives next to the service: updating Alik or installing it over itself
keeps it, and a fresh install restores it automatically. Uninstalling Alik deletes it.

## TV guide

`playlists/epg.json` in this repository is a 48-hour guide for the channels of the
ready playlists, rebuilt daily from free XMLTV sources (epg.it999.ru and Pluto TV via
i.mjh.nz) and matched by channel names. About 230 channels have a guide.

## Building

```sh
tools/release.sh alik-tv      # from the repository root: builds the IPK, updates hbrepo/
```

Strings: Russian is the key; `app/i18n.js` holds English and Armenian. Playback uses
[hls.js](https://github.com/video-dev/hls.js) 1.5.20 (Apache-2.0, `app/vendor`); QR codes
use [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) 1.4.4 (MIT). The TV
runs Chromium 79 and Node 8: no optional chaining, `??`, CSS `inset`, flex `gap` or
`aspect-ratio`.
