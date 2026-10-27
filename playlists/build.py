"""Builds playlists/armenia-russia.m3u from the iptv-org lists.

Armenian channels come first. Russian channels are kept only when they are
24/7, not geo-blocked and their stream answers right now. Each channel gets a
single group, so the player's menu stays short.

Usage: python3 playlists/build.py
"""
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SOURCES = [
    ('Armenia', 'https://iptv-org.github.io/iptv/languages/hye.m3u'),
    ('Russia', 'https://iptv-org.github.io/iptv/countries/ru.m3u'),
]
OUT = Path(__file__).resolve().parent / 'armenia-russia.m3u'
SKIP_TAGS = ('[Not 24/7]', '[Geo-blocked]')
TIMEOUT = 8
USER_AGENT = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/79.0 Safari/537.36'


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode('utf-8', 'replace')


def parse(text):
    """Yields (extinf_line, stream_url) pairs; option lines like #EXTVLCOPT are dropped."""
    extinf = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith('#EXTINF'):
            extinf = line
        elif line and not line.startswith('#') and extinf:
            yield extinf, line
            extinf = None


def clean(extinf, group):
    # Attribute values may contain commas (user agents), which break the
    # name parsing of some players, so drop the ones players do not need.
    extinf = re.sub(r'\s(http-user-agent|http-referrer)="[^"]*"', '', extinf)
    name = extinf.rsplit('",', 1)[-1].strip()
    if group == 'Russia':
        category = re.search(r'group-title="([^"]*)"', extinf)
        category = (category.group(1).split(';')[0] if category else '') or 'Other'
        group = 'Russia: ' + ('Other' if category == 'Undefined' else category)
    extinf = re.sub(r'\sgroup-title="[^"]*"', '', extinf)
    head = extinf.rsplit('",', 1)[0] + '"'
    return f'{head} group-title="{group}",{name}', name


def alive(url):
    try:
        request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status == 200 and bool(response.read(512))
    except Exception:
        return False


def main():
    entries = []
    seen = set()
    for group, url in SOURCES:
        for extinf, stream in parse(fetch(url)):
            line, name = clean(extinf, group)
            if stream in seen:
                continue
            if group == 'Russia' and any(tag in name for tag in SKIP_TAGS):
                continue
            seen.add(stream)
            entries.append((group, line, stream))

    with ThreadPoolExecutor(max_workers=32) as pool:
        checks = list(pool.map(lambda e: e[0] == 'Armenia' or alive(e[2]), entries))
    kept = [e for e, ok in zip(entries, checks) if ok]

    body = ['#EXTM3U'] + [f'{line}\n{stream}' for _, line, stream in kept]
    OUT.write_text('\n'.join(body) + '\n')
    armenian = sum(1 for e in kept if e[0] == 'Armenia')
    print(f'{OUT.name}: {len(kept)} channels ({armenian} Armenian, {len(kept) - armenian} Russian)')


if __name__ == '__main__':
    main()
