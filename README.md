# webos-apps

My apps for LG webOS TVs, published as a Homebrew Channel repository. Works
without root: Developer Mode is enough.

| App | Folder | What it does |
|---|---|---|
| Alik TV | `apps/alik-tv` | IPTV and film player for the remote: channel tiles, favourites, your own M3U links |
| Dev Mode Renew | `apps/devmode-renew` | Renews the Developer Mode session once a week, right on the TV |
| Qoder IPTV | `apps/qoder-iptv` | [Qoder IPTV](https://github.com/HCLGitHub/qoder-iptv) M3U/IPTV player, unchanged mirror |
| YouTube | `apps/youtube-adfree` | [YouTube AdFree](https://github.com/webosbrew/youtube-webos) with the regular YouTube icon |

## Install on your TV

### 1. Turn on Developer Mode

1. Create a free account at [webostv.developer.lge.com](https://webostv.developer.lge.com)
   (Sign In → Create Account).
2. On the TV, open **LG Content Store**, find **Developer Mode** and install it.
3. Open **Developer Mode**, sign in with that account, switch **Dev Mode Status** on
   and let the TV restart.
4. Open **Developer Mode** again and switch **Key Server** on. Note the
   **IP address** and **passphrase** it shows.

The session lasts 1000 hours (about 41 days). Install **Dev Mode Renew** from this
repository later so it renews itself.

### 2. Install Homebrew Channel

The easiest way is [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop/releases)
(Windows, macOS, Linux):

1. Add the TV: **Add device** → enter the IP address and passphrase from step 1.
2. Open the **Apps** tab, find **Homebrew Channel** among the available apps and select **Install**.

Or with the [webOS CLI](https://webostv.developer.lge.com/develop/tools/cli-installation):

```sh
ares-setup-device                        # add the TV with its IP and passphrase
ares-novacom --device tv --getkey        # enter the passphrase when asked
curl -LO https://github.com/webosbrew/webos-homebrew-channel/releases/latest/download/org.webosbrew.hbchannel_0.7.3_all.ipk
ares-install --device tv org.webosbrew.hbchannel_0.7.3_all.ipk
```

Check the [releases page](https://github.com/webosbrew/webos-homebrew-channel/releases)
for the current file name.

### 3. Add this repository

1. Open **Homebrew Channel** → the gear icon (Settings) → **Add repository**.
2. Enter the address and confirm with **ADD REPOSITORY**:

   ```
   https://mailtoharutyunyan.github.io/webos-apps/hbrepo/apps.json
   ```

3. Go back. The apps of this repository are at the end of the list; open one
   and select **Install**.

Tip: typing the address is easier from a phone with the keyboard of the
**LG ThinQ** app.

### 4. First start of Alik TV

Alik opens the **Playlists** screen: paste a link to any M3U playlist, pick a
ready one (Armenia, Russia, movie channels, Internet Archive films) or a country
from the iptv-org catalog. Press **INFO** on the remote for the list of keys.

## Playlists

`playlists/armenia.m3u`, `playlists/russia.m3u` and `playlists/movies.m3u` are rebuilt every day by `.github/workflows/playlists.yml`
from the iptv-org lists (`playlists/build.py`): Armenian-language channels, Russian
channels and movie channels grouped by country. Outside Armenia only 24/7, not
geo-blocked channels stay, and only streams that answer are kept. Channel logos
are copied into `playlists/logos/` (resized to 320x180), because image hosts
such as imgur refuse requests from TV browsers.
`playlists/epg.json` is a 48-hour TV guide for those channels, taken from the free
XMLTV of epg.it999.ru and matched by channel names (iptv-org alt names).
`playlists/archive-films.m3u` lists the 300 most downloaded public-domain and
Creative Commons feature films of the Internet Archive that have an MP4.

## Releasing an app

```sh
tools/release.sh devmode-renew     # builds into dist/, updates hbrepo/
git add -A && git commit -m "Release devmode-renew 1.0.1" && git push
```

Bump the version in the app's `appinfo.json` first: Homebrew Channel offers an
update only when the version differs from the installed one.

## Adding an app

Create `apps/<name>/` with:

- `build.sh <output-dir>`: writes the `.ipk` and an `icon.png` into the output folder
- `hbrepo.json`: `{"description": "...", "sourceUrl": "..."}` (`sourceUrl` optional)

Then run `tools/release.sh <name>`.
