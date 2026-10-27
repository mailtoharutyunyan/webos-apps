# YouTube AdFree with the YouTube icon

A repackaged build of [YouTube AdFree](https://github.com/webosbrew/youtube-webos)
v0.5.3 (GPL-3.0, source at that link). The only changes: the app icons, the
splash and recents images are replaced with the regular YouTube play button
(`tile.svg`, `wide.svg`, `play.svg`), and the title is "YouTube".

Uninstall the official YouTube app before installing it (same app id).

```sh
extras/youtube-adfree/build.sh dist/youtube
python3 tools/publish-hbrepo.py hbrepo https://mailtoharutyunyan.github.io/webos-devmode-renew/hbrepo \
    --ipk dist/youtube/youtube.leanback.v4_0.5.3_all.ipk --icon dist/youtube/youtube-icon.png \
    --description "YouTube without ads, with SponsorBlock. Regular YouTube icon." \
    --source-url https://github.com/webosbrew/youtube-webos
```
