"""Writes packages into a Homebrew Channel repository folder.

Usage:
  python3 tools/publish-hbrepo.py <repo-dir> <public-base-url>
      Builds Dev Mode Renew from app/ and service/ and publishes it.
  python3 tools/publish-hbrepo.py <repo-dir> <public-base-url> --ipk <file> \
      --icon <png> --description <text> [--source-url <url>]
      Publishes an already built IPK.

Example:
  python3 tools/publish-hbrepo.py hbrepo \
      https://mailtoharutyunyan.github.io/webos-devmode-renew/hbrepo
"""
import argparse
import hashlib
import io
import json
import shutil
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read_ar_member(ipk_bytes, prefix):
    """Returns the first member of an ar archive (an IPK) whose name starts with prefix."""
    offset = 8  # skip the "!<arch>\n" magic
    while offset < len(ipk_bytes):
        header = ipk_bytes[offset:offset + 60]
        name = header[:16].decode().strip().rstrip('/')
        size = int(header[48:58].decode().strip())
        data = ipk_bytes[offset + 60:offset + 60 + size]
        if name.startswith(prefix):
            return data
        offset += 60 + size + (size % 2)
    raise ValueError(f'No {prefix}* member in the IPK')


def appinfo_from_ipk(ipk_bytes):
    data = read_ar_member(ipk_bytes, 'data.tar')
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for member in tar.getmembers():
            if member.name.endswith('/appinfo.json') and '/applications/' in member.name:
                return json.load(tar.extractfile(member))
    raise ValueError('No appinfo.json in the IPK')


def build_devrenew():
    dist = ROOT / 'dist'
    shutil.rmtree(dist, ignore_errors=True)
    subprocess.run(['ares-package', '-o', str(dist), 'app', 'service'], cwd=ROOT, check=True)
    return next(dist.glob('*.ipk'))


def publish(repo, base_url, ipk_path, icon_path, description, source_url):
    ipk = ipk_path.read_bytes()
    info = appinfo_from_ipk(ipk)
    app_id, version = info['id'], info['version']
    ipk_name = f'{app_id}_{version}_all.ipk'

    (repo / 'ipk').mkdir(parents=True, exist_ok=True)
    (repo / 'icons').mkdir(exist_ok=True)
    for old in (repo / 'ipk').glob(f'{app_id}_*.ipk'):
        old.unlink()
    (repo / 'ipk' / ipk_name).write_bytes(ipk)
    shutil.copy(icon_path, repo / 'icons' / f'{app_id}.png')

    icon_url = f'{base_url}/icons/{app_id}.png'
    manifest = {
        'id': app_id,
        'version': version,
        'type': info['type'],
        'title': info['title'],
        'iconUri': icon_url,
        'rootRequired': False,
        'ipkUrl': f'{base_url}/ipk/{ipk_name}',
        'ipkHash': {'sha256': hashlib.sha256(ipk).hexdigest()},
        'ipkSize': len(ipk),
    }
    if source_url:
        manifest['sourceUrl'] = source_url
    package = {
        'id': app_id,
        'title': info['title'],
        'iconUri': icon_url,
        'shortDescription': description,
        'manifest': manifest,
    }

    index_path = repo / 'apps.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {'packages': []}
    index['packages'] = [p for p in index['packages'] if p['id'] != app_id] + [package]
    index['packages'].sort(key=lambda p: p['title'].lower())
    index['paging'] = {'page': 1, 'count': 1, 'maxPage': 1, 'itemsTotal': len(index['packages'])}
    index_path.write_text(json.dumps(index, indent=2) + '\n')
    print(f'{app_id} {version} -> {index_path} (sha256 {manifest["ipkHash"]["sha256"][:12]}…)')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('repo_dir')
    parser.add_argument('base_url')
    parser.add_argument('--ipk', type=Path)
    parser.add_argument('--icon', type=Path)
    parser.add_argument('--description')
    parser.add_argument('--source-url')
    args = parser.parse_args()

    repo = Path(args.repo_dir).expanduser()
    base_url = args.base_url.rstrip('/')
    if args.ipk:
        if not (args.icon and args.description):
            parser.error('--ipk needs --icon and --description')
        publish(repo, base_url, args.ipk, args.icon, args.description, args.source_url)
    else:
        publish(repo, base_url, build_devrenew(), ROOT / 'app' / 'largeIcon.png',
                'Renews the Developer Mode session once a week, right on the TV.', None)


if __name__ == '__main__':
    main()
