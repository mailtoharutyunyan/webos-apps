"""Builds the IPK and writes it into a Homebrew Channel repository folder.

Usage: python3 tools/publish-hbrepo.py <repo-dir> <public-base-url>
Example: python3 tools/publish-hbrepo.py ~/Desktop/personal-lampa/hbrepo \
    https://mailtoharutyunyan.github.io/personal-lampa/hbrepo
"""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def main(repo_dir, base_url):
    repo = Path(repo_dir).expanduser()
    base_url = base_url.rstrip('/')
    info = json.loads((ROOT / 'app' / 'appinfo.json').read_text())
    app_id, version = info['id'], info['version']

    dist = ROOT / 'dist'
    shutil.rmtree(dist, ignore_errors=True)
    subprocess.run(['ares-package', '-o', str(dist), 'app', 'service'], cwd=ROOT, check=True)
    ipk_name = f'{app_id}_{version}_all.ipk'

    (repo / 'ipk').mkdir(parents=True, exist_ok=True)
    (repo / 'icons').mkdir(exist_ok=True)
    for old in (repo / 'ipk').glob(f'{app_id}_*.ipk'):
        old.unlink()
    shutil.copy(dist / ipk_name, repo / 'ipk' / ipk_name)
    shutil.copy(ROOT / 'app' / 'largeIcon.png', repo / 'icons' / f'{app_id}.png')

    ipk = (repo / 'ipk' / ipk_name).read_bytes()
    icon_url = f'{base_url}/icons/{app_id}.png'
    package = {
        'id': app_id,
        'title': info['title'],
        'iconUri': icon_url,
        'shortDescription': 'Renews the Developer Mode session once a week, right on the TV.',
        'manifest': {
            'id': app_id,
            'version': version,
            'type': info['type'],
            'title': info['title'],
            'iconUri': icon_url,
            'rootRequired': False,
            'ipkUrl': f'{base_url}/ipk/{ipk_name}',
            'ipkHash': {'sha256': hashlib.sha256(ipk).hexdigest()},
            'ipkSize': len(ipk),
        },
    }

    index_path = repo / 'apps.json'
    index = json.loads(index_path.read_text()) if index_path.exists() else {'packages': []}
    index['packages'] = [p for p in index['packages'] if p['id'] != app_id] + [package]
    index['paging'] = {'page': 1, 'count': 1, 'maxPage': 1, 'itemsTotal': len(index['packages'])}
    index_path.write_text(json.dumps(index, indent=2) + '\n')
    print(f'{app_id} {version} -> {index_path} (sha256 {package["manifest"]["ipkHash"]["sha256"][:12]}…)')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
