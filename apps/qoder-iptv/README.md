# Qoder IPTV

Unchanged mirror of [Qoder IPTV](https://github.com/HCLGitHub/qoder-iptv) (MIT),
so it stays installable while the official Homebrew repositories are switched off.
`build.sh` downloads the upstream release and checks its sha256.

To update: change `VERSION` and `SHA256` in `build.sh`, then `tools/release.sh qoder-iptv`.
