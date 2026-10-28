"""Builds the checked playlists in playlists/ from the iptv-org lists.

A channel is kept only when its stream answers right now; outside the Armenian
list it must also be 24/7 and not geo-blocked. Each channel gets a single group, so the
player's menu stays short.

Usage: python3 playlists/build.py
"""
import calendar
import gzip
import hashlib
import io
import time
import xml.etree.ElementTree as ET
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# (label, source, output file, how channels are grouped: single / category / country / language)
SOURCES = [
    ('Armenia', 'https://iptv-org.github.io/iptv/languages/hye.m3u', 'armenia.m3u', 'single'),
    ('Russia', 'https://iptv-org.github.io/iptv/countries/ru.m3u', 'russia.m3u', 'category'),
    ('Movies', 'https://iptv-org.github.io/iptv/categories/movies.m3u', 'movies.m3u', 'language'),
]
HERE = Path(__file__).resolve().parent
LOGOS = HERE / 'logos'
LOGO_BASE = 'https://mailtoharutyunyan.github.io/webos-apps/playlists/logos/'

# Public-domain and Creative Commons feature films from the Internet Archive.
ARCHIVE_SEARCH = 'https://archive.org/advancedsearch.php'
ARCHIVE_QUERY = 'collection:feature_films AND mediatype:movies'
ARCHIVE_FILMS = 300
ARCHIVE_FILE = 'archive-films.m3u'
# Adult and exploitation titles go to a separate, opt-in playlist.
ARCHIVE_ADULT_FILE = 'archive-films-18.m3u'
ARCHIVE_ADULT_QUERY = ('collection:feature_films AND mediatype:movies AND '
                       '(subject:sexploitation OR subject:erotica OR subject:erotic OR subject:nudist OR subject:grindhouse)')
ARCHIVE_ADULT_FILMS = 150
# Strong words count anywhere in the title, tags or description; "sex" only in the title.
ADULT_STRONG = re.compile(r'\b(porn\w*|erotic\w*|nudis\w*|nudity|nude|sexploitation|x-rated|nsfw|topless|'
                          r'grindhouse|softcore|stag film)\b', re.I)
ADULT_TITLE = re.compile(r'\b(sex\w*|naked|orgy|orgies)\b', re.I)
SKIP_TAGS = ('[Not 24/7]', '[Geo-blocked]')
# 'language' grouping keeps only these languages (iptv-org feed languages).
FEEDS_URL = 'https://iptv-org.github.io/api/feeds.json'
LANGUAGES = {'eng': 'English', 'rus': 'Russian', 'hye': 'Armenian'}
_feeds = {}


def feed_languages():
    if not _feeds:
        for feed in json.loads(fetch(FEEDS_URL)):
            _feeds[(feed['channel'], feed['id'])] = feed.get('languages') or []
    return _feeds
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
    elif grouping == 'language':
        # tvg-id looks like "Name.us@SD": channel "Name.us", feed "SD".
        feed = re.search(r'tvg-id="([^"@]+)@([^"]+)"', extinf)
        languages = feed_languages().get((feed.group(1), feed.group(2)), []) if feed else []
        wanted = [code for code in languages if code in LANGUAGES]
        if not wanted:
            return None, name
        group = label + ': ' + LANGUAGES[wanted[0]]
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


def merge_small_groups(entries, label, minimum=5):
    """Folds countries with fewer than `minimum` channels into "<label>: Other"."""
    def group_of(line):
        return re.search(r'group-title="([^"]*)"', line).group(1)
    counts = {}
    for line, _ in entries:
        counts[group_of(line)] = counts.get(group_of(line), 0) + 1
    merged = []
    for line, stream in entries:
        group = group_of(line)
        if counts[group] < minimum:
            line = line.replace(f'group-title="{group}"', f'group-title="{label}: Other"')
        merged.append((line, stream))
    return merged


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
        if line is None or stream in seen:
            continue
        if label != 'Armenia' and any(tag in name for tag in SKIP_TAGS):
            continue
        seen.add(stream)
        entries.append((line, stream))

    with ThreadPoolExecutor(max_workers=32) as pool:
        checks = list(pool.map(lambda e: alive(e[1]), entries))
    kept = [e for e, ok in zip(entries, checks) if ok]
    if grouping == 'country':
        kept = merge_small_groups(kept, label)
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
    info = meta.get('metadata', {})
    words = ' '.join(str(info.get(k, '')) for k in ('title', 'subject', 'description'))
    adult = bool(ADULT_STRONG.search(words) or ADULT_TITLE.search(str(info.get('title', ''))))
    year = str(doc.get('year') or '')[:4]
    decade = year[:3] + '0s' if year.isdigit() else 'Other'
    title = re.sub(r'\s+', ' ', str(doc.get('title', doc['identifier']))).replace(',', ' ').strip()
    name = f'{title} ({year})' if year else title
    thumb = 'https://archive.org/services/img/' + doc['identifier']
    group = 'Films 18+' if adult else 'Films: ' + decade
    return f'#EXTINF:-1 tvg-logo="{thumb}" group-title="{group}",{name}', url, adult


def archive_search(query, rows):
    params = urllib.parse.urlencode([
        ('q', query), ('fl[]', 'identifier'), ('fl[]', 'title'), ('fl[]', 'year'),
        ('sort[]', 'downloads desc'), ('rows', str(rows)), ('output', 'json'),
    ])
    return json.loads(fetch(ARCHIVE_SEARCH + '?' + params))['response']['docs']


def build_archive():
    docs = archive_search(ARCHIVE_QUERY, ARCHIVE_FILMS)
    seen = {doc['identifier'] for doc in docs}
    docs += [doc for doc in archive_search(ARCHIVE_ADULT_QUERY, ARCHIVE_ADULT_FILMS) if doc['identifier'] not in seen]

    def safe(doc):
        try:
            return archive_film(doc)
        except Exception:
            return None

    with ThreadPoolExecutor(max_workers=16) as pool:
        films = [f for f in pool.map(safe, docs) if f]
    films.sort(key=lambda f: f[0].split('group-title="', 1)[1])
    for filename, wanted in ((ARCHIVE_FILE, False), (ARCHIVE_ADULT_FILE, True)):
        chosen = [f for f in films if f[2] == wanted]
        body = ['#EXTM3U'] + [f'{line}\n{url}' for line, url, _ in chosen]
        (HERE / filename).write_text('\n'.join(body) + '\n')
        print(f'{filename}: {len(chosen)} films')


# ---------- TV guide ----------

EPG_SOURCE = 'http://epg.it999.ru/epg.xml.gz'   # free XMLTV, mostly Russian-language channels
EPG_FILE = 'epg.json'
EPG_HOURS = 48
CHANNELS_URL = 'https://iptv-org.github.io/api/channels.json'


def norm(name):
    """Comparable form of a channel name: no quality tags, brackets, case or punctuation."""
    name = re.sub(r'\(.*?\)|\[.*?\]', ' ', name.lower())
    name = re.sub(r'\b(hd|fhd|uhd|4k|sd|orig|int|international|\+\d)\b', ' ', name)
    return re.sub(r'[^0-9a-zа-яёա-ֆ]+', '', name)


def xmltv_time(value):
    """'20261028040000 +0300' -> Unix seconds."""
    stamp = time.strptime(value[:14], '%Y%m%d%H%M%S')
    seconds = calendar.timegm(stamp)
    offset = value[14:].strip()
    if offset:
        sign = 1 if offset[0] == '+' else -1
        seconds -= sign * (int(offset[1:3]) * 3600 + int(offset[3:5]) * 60)
    return seconds


def build_epg():
    """Writes epg.json: {tvg-id: [[start, stop, title], ...]} for the next EPG_HOURS."""
    wanted = {}   # tvg-id -> names to look for
    for _, _, filename, _ in SOURCES:
        text = (HERE / filename).read_text()
        for tvg_id, name in re.findall(r'tvg-id="([^"@]+)[^"]*"[^\n]*",([^\n]*)', text):
            wanted.setdefault(tvg_id, set()).add(name)
    for channel in json.loads(fetch(CHANNELS_URL)):
        if channel['id'] in wanted:
            wanted[channel['id']].update([channel['name']] + (channel.get('alt_names') or []))

    request = urllib.request.Request(EPG_SOURCE, headers={'User-Agent': 'curl/8.7'})
    with urllib.request.urlopen(request, timeout=300) as response:
        raw = response.read()

    now = int(time.time())
    until = now + EPG_HOURS * 3600
    by_name = {}
    guide = {}
    source_to_ids = {}
    with gzip.open(io.BytesIO(raw)) as stream:
        for _, element in ET.iterparse(stream, events=('end',)):
            if element.tag == 'channel':
                for display in element.findall('display-name'):
                    if display.text:
                        by_name.setdefault(norm(display.text), element.get('id'))
                element.clear()
            elif element.tag == 'programme':
                if not source_to_ids:
                    # All <channel> elements come first: match them to our channels once.
                    for tvg_id, names in wanted.items():
                        for name in names:
                            source = by_name.get(norm(name))
                            if source:
                                source_to_ids.setdefault(source, []).append(tvg_id)
                                break
                ids = source_to_ids.get(element.get('channel'))
                if ids:
                    start = xmltv_time(element.get('start'))
                    stop = xmltv_time(element.get('stop'))
                    if stop > now and start < until:
                        title = element.findtext('title') or ''
                        for tvg_id in ids:
                            guide.setdefault(tvg_id, []).append([start, stop, title.strip()])
                element.clear()
    for shows in guide.values():
        shows.sort()
    (HERE / EPG_FILE).write_text(json.dumps(guide, ensure_ascii=False, separators=(',', ':')))
    print(f'{EPG_FILE}: {len(guide)} channels, {sum(len(v) for v in guide.values())} programmes')


def main():
    for label, url, filename, grouping in SOURCES:
        build(label, url, filename, grouping)
    build_archive()
    try:
        build_epg()
    except Exception as error:   # keep yesterday's guide rather than fail the whole build
        print(f'{EPG_FILE}: not updated ({error})')


if __name__ == '__main__':
    main()
