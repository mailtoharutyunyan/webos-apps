"""Builds the checked playlists in playlists/ from the iptv-org lists.

A channel is kept only when its stream answers right now; outside the Armenian
list it must also be 24/7 and not geo-blocked. Each channel gets a single group, so the
player's menu stays short.

Usage: python3 playlists/build.py
"""
import hashlib
import io
import json
import re
import urllib.parse
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
LOGOS = HERE / 'logos'
LOGO_BASE = 'https://mailtoharutyunyan.github.io/webos-apps/playlists/logos/'

# Public-domain and Creative Commons feature films from the Internet Archive.
ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php'
ARCHIVE_QUERY = 'collection:feature_films AND mediatype:movies'
ARCHIVE_FILMS = 300
ARCHIVE_FILE = 'archive-films.m3u'
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


def mirror_logo(url):
    """Copies a channel logo into playlists/logos and returns its Pages URL.

    Image hosts such as imgur answer TV browsers with HTTP 429, so the TV gets
    logos from this repository instead. Returns '' when the logo cannot be fetched.
    """
    if not url.startswith('http'):
        return ''
    name = hashlib.sha1(url.encode()).hexdigest()[:16] + '.png'
    path = LOGOS / name
    if not path.exists():
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'curl/8.7'})
            with urllib.request.urlopen(request, timeout=15) as response:
                data = response.read(2_000_000)
            if not data or response.status != 200:
                return ''
            path.write_bytes(shrink(data))
        except Exception:
            return ''
    return LOGO_BASE + name


def shrink(data):
    """Fits a logo into 320x180 PNG, small enough for a TV tile."""
    from PIL import Image
    image = Image.open(io.BytesIO(data))
    image = image.convert('RGBA')
    image.thumbnail((320, 180))
    out = io.BytesIO()
    image.save(out, 'PNG', optimize=True)
    return out.getvalue()


def with_mirrored_logo(line):
    logo = re.search(r'tvg-logo="([^"]*)"', line)
    if not logo or not logo.group(1):
        return line
    mirrored = mirror_logo(logo.group(1))
    return line.replace(logo.group(0), f'tvg-logo="{mirrored}"')


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
    LOGOS.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=16) as pool:
        lines = list(pool.map(lambda e: with_mirrored_logo(e[0]), kept))
    kept = [(line, stream) for line, (_, stream) in zip(lines, kept)]

    body = ['#EXTM3U'] + [f'{line}\n{stream}' for line, stream in kept]
    (HERE / filename).write_text('\n'.join(body) + '\n')
    print(f'{filename}: {len(kept)} of {len(entries)} channels answer')


def archive_film(doc):
    """Returns an (#EXTINF, url) pair for one Internet Archive item, or None without a free MP4."""
    meta = json.loads(fetch('https://archive.org/metadata/' + urllib.parse.quote(doc['identifier'])))
    licence = meta.get('metadata', {}).get('licenseurl', '')
    if 'publicdomain' not in licence and 'creativecommons' not in licence:
        return None
    files = [f for f in meta.get('files', []) if f['name'].lower().endswith('.mp4')]
    if not files:
        return None
    # The 512kb derivative streams well on the TV; otherwise take the smallest MP4.
    files.sort(key=lambda f: ('512kb' not in f['name'], int(f.get('size') or 0)))
    url = 'https://archive.org/download/{}/{}'.format(doc['identifier'], urllib.parse.quote(files[0]['name']))
    year = str(doc.get('year') or '')[:4]
    decade = year[:3] + '0s' if year.isdigit() else 'Other'
    title = re.sub(r'\s+', ' ', str(doc.get('title', doc['identifier']))).replace(',', ' ').strip()
    name = f'{title} ({year})' if year else title
    thumb = 'https://archive.org/services/img/' + doc['identifier']
    return f'#EXTINF:-1 tvg-logo="{thumb}" group-title="Films: {decade}",{name}', url


def build_archive():
    params = urllib.parse.urlencode([
        ('q', ARCHIVE_QUERY), ('fl[]', 'identifier'), ('fl[]', 'title'), ('fl[]', 'year'),
        ('sort[]', 'downloads desc'), ('rows', str(ARCHIVE_FILMS)), ('output', 'json'),
    ])
    docs = json.loads(fetch(ARCHIVE_SEARCH + '?' + params))['response']['docs']

    def safe(doc):
        try:
            return archive_film(doc)
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=16) as pool:
        films = [f for f in pool.map(safe, docs) if f]
    films.sort(key=lambda f: f[0].split('group-title="', 1)[1])
    body = ['#EXTM3U'] + [f'{line}\n{url}' for line, url in films]
    (HERE / ARCHIVE_FILE).write_text('\n'.join(body) + '\n')
    print(f'{ARCHIVE_FILE}: {len(films)} of {len(docs)} films have a free MP4')


def main():
    for label, url, filename, grouping in SOURCES:
        build(label, url, filename, grouping)
    build_archive()


if __name__ == '__main__':
    main()
