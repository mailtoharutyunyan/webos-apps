"""Builds the checked playlists in playlists/ from the iptv-org lists.

A channel is kept only when its stream answers right now; outside the Armenian
list it must also be 24/7 and not geo-blocked. Each channel gets a single group, so the
player's menu stays short.

Usage: python3 playlists/build.py
"""
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# (label, source, output file, how channels are grouped: single / category / country)
SOURCES = [
    ('Armenia', 'https://iptv-org.github.io/iptv/languages/hye.m3u', 'armenia.m3u', 'single'),
    ('Russia', 'https://iptv-org.github.io/iptv/countries/ru.m3u', 'russia.m3u', 'category'),
    ('Movies', 'https://iptv-org.github.io/iptv/categories/movies.m3u', 'movies.m3u', 'country'),
]
HERE = Path(__file__).resolve().parent
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


def clean(extinf, label, grouping):
    # Attribute values may contain commas (user agents), which break the
    # name parsing of some players, so drop the ones players do not need.
    extinf = re.sub(r'\s(http-user-agent|http-referrer)="[^"]*"', '', extinf)
    name = extinf.rsplit('",', 1)[-1].strip()
    group = label
    if grouping == 'category':
        category = re.search(r'group-title="([^"]*)"', extinf)
        category = (category.group(1).split(';')[0] if category else '') or 'Other'
        group = label + ': ' + ('Other' if category == 'Undefined' else category)
    elif grouping == 'country':
        # tvg-id looks like "Name.us@SD"; the part after the dot is the country.
        country = re.search(r'tvg-id="[^".]*\.([a-z]{2})@', extinf)
        group = label + ': ' + (country.group(1).upper() if country else 'Other')
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


def build(label, url, filename, grouping):
    entries = []
    seen = set()
    for extinf, stream in parse(fetch(url)):
        line, name = clean(extinf, label, grouping)
        if stream in seen:
            continue
        if label != 'Armenia' and any(tag in name for tag in SKIP_TAGS):
            continue
        seen.add(stream)
        entries.append((line, stream))

    with ThreadPoolExecutor(max_workers=32) as pool:
        checks = list(pool.map(lambda e: alive(e[1]), entries))
    kept = [e for e, ok in zip(entries, checks) if ok]

    body = ['#EXTM3U'] + [f'{line}\n{stream}' for line, stream in kept]
    (HERE / filename).write_text('\n'.join(body) + '\n')
    print(f'{filename}: {len(kept)} of {len(entries)} channels answer')


def main():
    for label, url, filename, grouping in SOURCES:
        build(label, url, filename, grouping)


if __name__ == '__main__':
    main()
