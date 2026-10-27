# webos-apps

My apps for the LG webOS TV, published as a Homebrew Channel repository.

Add this repository in Homebrew Channel → Settings → Add repository:

```
https://mailtoharutyunyan.github.io/webos-apps/hbrepo/apps.json
```

| App | Folder | What it does |
|---|---|---|
| Alik TV | `apps/alik-tv` | IPTV player: Armenian channels first, then Russian |
| Dev Mode Renew | `apps/devmode-renew` | Renews the Developer Mode session once a week, right on the TV |
| Qoder IPTV | `apps/qoder-iptv` | [Qoder IPTV](https://github.com/HCLGitHub/qoder-iptv) M3U/IPTV player, unchanged mirror |
| YouTube | `apps/youtube-adfree` | [YouTube AdFree](https://github.com/webosbrew/youtube-webos) with the regular YouTube icon |

## Playlists

`playlists/armenia-russia.m3u` is rebuilt every day by `.github/workflows/playlists.yml`
from the iptv-org lists (`playlists/build.py`): Armenian-language channels first,
then Russian ones that are 24/7, not geo-blocked and answering.

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
