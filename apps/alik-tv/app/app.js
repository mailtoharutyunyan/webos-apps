// Alik: an IPTV and film player built for the LG TV remote.
// The TV browser is Chromium 79, so no optional chaining or `??`.
(function () {
    'use strict';

    // Interface language: Russian strings are the keys, i18n.js holds English and Armenian.
    // Read first, because constants below already use t().
    var LANG = (function () {
        try {
            return JSON.parse(window.localStorage.getItem('alik.settings') || '{}').lang || 'ru';
        } catch (e) {
            return 'ru';
        }
    }());

    function t(text) {
        var table = LANG !== 'ru' && window.ALIK_I18N && window.ALIK_I18N[LANG];
        return (table && table[text]) || text;
    }

    // Checked daily in the webos-apps repository: only streams that answer stay in.
    var PRESETS = [
        { name: t('Армения'), url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/armenia.m3u' },
        { name: t('Россия'), url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/russia.m3u' },
        { name: t('Фильмы со всего мира'), url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/movies.m3u' },
        { name: t('Классика кино (Internet Archive)'), url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/archive-films.m3u' },
        { name: t('18+ · винтажное кино (Internet Archive)'), url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/archive-films-18.m3u', adult: true }
    ];
    var CATALOG_URL = 'https://iptv-org.github.io/api/countries.json';
    // 48-hour guide for the channels of the ready playlists, rebuilt daily.
    var GUIDE_URL = 'https://mailtoharutyunyan.github.io/webos-apps/playlists/epg.json';
    var guide = {};
    var CATALOG_PINNED = ['AM', 'RU'];

    var STORE = { last: 'alik.lastChannel', sources: 'alik.sources', favourites: 'alik.favourites', recent: 'alik.recent', settings: 'alik.settings', folders: 'alik.folders',
        positions: 'alik.positions', dead: 'alik.dead', groups: 'alik.groups' };
    var DEAD_FOR = 24 * 3600 * 1000;   // a failed channel is marked for a day
    var DRAG_DELAY = 400;
    var ADULT_GROUP = /18\+|adult|xxx/i;

    var THEMES = [
        { id: 'apricot', name: t('Абрикос'), colours: ['#0f1420', '#f39c4a'] },
        { id: 'pomegranate', name: t('Гранат'), colours: ['#170f15', '#e0475b'] },
        { id: 'sevan', name: t('Севан'), colours: ['#0b1719', '#3cc6b4'] },
        { id: 'ararat', name: t('Арарат'), colours: ['#eef1f5', '#d9742b'] }
    ];

    var SLEEP_OPTIONS = [
        { id: 'off', name: t('Выключен'), colours: [] },
        { id: '30', name: t('30 минут'), colours: [] },
        { id: '60', name: t('1 час'), colours: [] },
        { id: '90', name: t('1,5 часа'), colours: [] },
        { id: '120', name: t('2 часа'), colours: [] }
    ];
    var sleepChoice = 'off';
    var sleepAt = 0;

    var LANGUAGES = [
        { id: 'ru', name: 'Русский', colours: [] },
        { id: 'en', name: 'English', colours: [] },
        { id: 'hy', name: 'Հայերեն', colours: [] }
    ];

    var SETTINGS = [
        { id: 'lang', kind: 'choice', title: t('Язык'), text: t('Язык интерфейса Alik. Приложение перезапустится.'), options: LANGUAGES },
        { id: 'playlists', kind: 'link', title: t('Плейлисты и каталоги'), text: t('Добавить ссылку M3U, готовый плейлист или страну из iptv-org. OK — открыть.') },
        { id: 'theme', kind: 'choice', title: t('Тема'), text: t('Цвета Alik. ← → или OK — сменить.'), options: THEMES },
        { id: 'adult', title: t('Показывать 18+'), text: t('Включено — добавляется плейлист 18+ и группа «Films 18+». Выключено — скрыто.') },
        { id: 'wheelZap', title: t('Колесо Magic Remote переключает каналы'), text: t('Во время просмотра. Выключено — только CH+ и CH−.') },
        { id: 'hideDead', title: t('Скрыть неработающие каналы'), text: t('Каналы, которые не ответили за последние сутки.') },
        { id: 'sleep', kind: 'choice', title: t('Таймер сна'), text: t('Остановит просмотр через выбранное время.'), options: SLEEP_OPTIONS, session: true },
        { id: 'backup', kind: 'link', title: t('Восстановить из резервной копии'), text: t('Копия плейлистов, папок, избранного и настроек сохраняется сама на ТВ.') },
        { id: 'groups', kind: 'link', title: t('Группы'), text: t('Скрыть ненужные группы и поменять порядок.') },
        { id: 'pinSet', kind: 'link', title: t('Задать PIN для 18+'), text: t('4 цифры. После этого 18+ закрыто при каждом запуске Alik.'), when: function () { return !pinSet(); } },
        { id: 'pinChange', kind: 'link', title: t('Сменить PIN для 18+'), text: t('Нужен текущий PIN.'), when: pinSet },
        { id: 'pinRemove', kind: 'link', title: t('Убрать PIN'), text: t('Нужен текущий PIN. 18+ снова управляется только переключателем.'), when: pinSet }
    ];

    function visibleSettings() {
        return SETTINGS.filter(function (item) { return !item.when || item.when(); });
    }

    function setting(id) {
        return read(STORE.settings, {})[id] === true;
    }

    var adultUnlocked = false;   // per app start; a PIN locks 18+ again on every launch

    function pinSet() {
        return /^\d{4}$/.test(read(STORE.settings, {}).pin || '');
    }

    function adultVisible() {
        return setting('adult') && (!pinSet() || adultUnlocked);
    }

    function applyTheme() {
        var theme = read(STORE.settings, {}).theme || 'apricot';
        if (theme === 'apricot') {
            document.documentElement.removeAttribute('data-theme');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }
    var RECENT_LIMIT = 30;
    var OSD_TIMEOUT = 5000;
    var DIGIT_TIMEOUT = 1500;
    // Seeking grows while ← → are pressed in quick succession: 10 s, 1 min, 5 min.
    var SEEK_STEPS = [10, 10, 30, 60, 60, 300];
    var SEEK_RESET = 900;
    var seekRun = 0;

    var KEY = {
        OK: 13, BACK: 461, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
        CH_UP: 33, CH_DOWN: 34, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, INFO: 457,
        PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, FAST_FORWARD: 417, REWIND: 412
    };

    // Tile grid geometry (see .grid and .tile in style.css).
    // The 16 px inset leaves room for the focused tile to grow without being clipped.
    var GRID = { cols: 4, tileW: 316, tileH: 244, gapX: 28, gapY: 28, rows: 3, inset: 16 };

    var $ = function (id) { return document.getElementById(id); };
    var video = $('video');

    var channels = [];      // { name, group, logo, url, number, film }
    var sections = [];      // rail entries: { kind, name, icon, items, action }
    var current = -1;       // index into channels
    var previous = -1;
    var playList = [];      // channel indexes the up/down keys walk through
    var hls = null;
    var autoMuted = false;
    var screen = 'player';  // player | home | sources | help | dialog
    var dialogReturn = 'home';
    var timers = {};
    var digits = '';

    // ---------- Small helpers ----------

    function read(key, fallback) {
        try {
            var value = window.localStorage.getItem(key);
            return value === null ? fallback : JSON.parse(value);
        } catch (e) {
            return fallback;
        }
    }

    function write(key, value) {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            /* storage is only a convenience */
        }
        if (BACKED_UP && BACKED_UP.indexOf(key) >= 0) {
            restartTimer('backup', 3000, saveBackup);
        }
    }

    // ---------- Backup ----------

    // What a reinstall must not lose. Film positions and dead marks are cheap to rebuild.
    var BACKED_UP = [STORE.sources, STORE.favourites, STORE.folders, STORE.settings, STORE.groups];
    var SERVICE = 'luna://com.arayik.alik.service/';
    var lastBackup = 0;

    function callService(method, params, callback) {
        try {
            var bridge = new PalmServiceBridge();
            bridge.onservicecallback = function (raw) {
                var payload;
                try {
                    payload = JSON.parse(raw);
                } catch (e) {
                    payload = { returnValue: false };
                }
                callback(payload);
            };
            bridge.call(SERVICE + method, JSON.stringify(params || {}));
        } catch (e) {
            callback({ returnValue: false, errorText: 'no service' });
        }
    }

    function saveBackup() {
        var data = {};
        BACKED_UP.forEach(function (key) {
            var value = window.localStorage.getItem(key);
            if (value !== null) {
                data[key] = value;
            }
        });
        callService('save', { data: data }, function (result) {
            if (result.returnValue) {
                lastBackup = result.savedAt;
            }
        });
    }

    // On a fresh install (no playlists yet) bring back the last backup, then start.
    function restoreIfEmpty(start) {
        if (window.localStorage.getItem(STORE.sources) !== null) {
            callService('load', {}, function (result) {
                if (result.found) {
                    lastBackup = result.savedAt;
                }
            });
            start();
            return;
        }
        callService('load', {}, function (result) {
            if (result.found && result.data) {
                Object.keys(result.data).forEach(function (key) {
                    window.localStorage.setItem(key, result.data[key]);
                });
                lastBackup = result.savedAt;
                toast(t('Настройки восстановлены из резервной копии'));
            }
            start();
        });
    }

    function restoreBackup() {
        callService('load', {}, function (result) {
            if (!result.found) {
                toast(t('Резервной копии пока нет'));
                return;
            }
            Object.keys(result.data).forEach(function (key) {
                window.localStorage.setItem(key, result.data[key]);
            });
            toast(t('Восстановлено. Перезапускаю…'));
            setTimeout(function () { window.location.reload(); }, 1200);
        });
    }

    function restartTimer(name, delay, callback) {
        clearTimeout(timers[name]);
        timers[name] = setTimeout(callback, delay);
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function clockText(seconds) {
        var s = Math.floor(seconds);
        var h = Math.floor(s / 3600);
        var m = ('0' + Math.floor(s % 3600 / 60)).slice(-2);
        return (h ? h + ':' : '') + m + ':' + ('0' + s % 60).slice(-2);
    }

    function isVideoFile(url) {
        return /\.(mp4|m4v|webm|mov)(\?|#|$)/i.test(url);
    }

    // ---------- Icons and key hints ----------

    var PATHS = {
        up: 'M6 15l6-6 6 6', down: 'M6 9l6 6 6-6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
        updown: 'M7 9l5-5 5 5M7 15l5 5 5-5', leftright: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
        back: 'M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3',
        star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
        clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
        tv: 'M3 6h18v11H3zM8 21h8M12 17v4',
        film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
        folder: 'M3 7h6l2 2h10v10H3z',
        list: 'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1',
        help: 'M12 21a9 9 0 100-18 9 9 0 000 18zM9.5 9a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 3.5M12 17h.01',
        play: 'M8 5l11 7-11 7z',
        plus: 'M12 5v14M5 12h14',
        search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
        tracks: 'M4 6h16M4 12h10M4 18h7M18 14v6M15 17h6',
        lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
        heartfolder: 'M3 7h6l2 2h10v10H3zM12 17l-2.6-2.4a1.6 1.6 0 012.3-2.2l.3.3.3-.3a1.6 1.6 0 012.3 2.2z',
        gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .3-1.4-1.4.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L5.8 7.3 4 7 3 10l2 1v2l-2 1 1 3 2-.3 1.4 1.4-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.4-1.4 2 .3 1-3-2-1z',
        pause: 'M8 5v14M16 5v14'
    };

    function svg(name) {
        return '<svg viewBox="0 0 24 24"><path d="' + PATHS[name] + '"/></svg>';
    }

    // A key chip: 'OK', 'CH', digits text, a colour dot or an icon.
    function key(spec) {
        if (spec === 'red' || spec === 'green' || spec === 'yellow' || spec === 'blue') {
            return '<span class="key dot ' + spec + '"></span>';
        }
        if (PATHS[spec]) {
            return '<span class="key round">' + svg(spec) + '</span>';
        }
        return '<span class="key">' + spec + '</span>';
    }

    function setHints(container, list) {
        container.innerHTML = list.map(function (hint) {
            return '<span class="hint">' + hint[0].map(key).join('') + hint[1] + '</span>';
        }).join('');
    }

    // ---------- Playlists ----------

    function attr(line, name) {
        var match = new RegExp(name + '="([^"]*)"').exec(line);
        return match ? match[1] : '';
    }

    function parseM3u(text) {
        var list = [];
        var info = null;
        text.split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (line.indexOf('#EXTINF') === 0) {
                // The name follows the comma after the last attribute.
                var cut = line.lastIndexOf('",');
                var name = (cut >= 0 ? line.slice(cut + 2) : line.slice(line.indexOf(',') + 1)).trim();
                info = {
                    name: name.replace(/\s*\((\d{3,4}p)\)/, '').trim(),
                    group: attr(line, 'group-title') || t('Другое'),
                    logo: attr(line, 'tvg-logo'),
                    tvgId: attr(line, 'tvg-id').split('@')[0]
                };
            } else if (line && line.charAt(0) !== '#' && info) {
                info.url = line;
                info.film = isVideoFile(line);
                list.push(info);
                info = null;
            }
        });
        return list;
    }

    function fetchSource(source) {
        return fetch(source.url, { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(t('сервер ответил ') + response.status);
                }
                return response.text();
            })
            .then(function (text) {
                var list = parseM3u(text);
                if (!list.length) {
                    throw new Error(t('в нём нет каналов'));
                }
                return { source: source, channels: list };
            }, function (err) {
                return { source: source, error: err.message || t('нет связи') };
            });
    }

    function loadPlaylists() {
        var sources = read(STORE.sources, []).map(function (source) {
            if (/^raw\.githubusercontent\.com \//.test(source.name)) {
                source.name = nameFromUrl(source.url);
            }
            return source;
        });
        write(STORE.sources, sources);
        if (!sources.length) {
            stopPlayback();
            openSources();
            return;
        }
        showScreen('player');
        showStatus(t('Загружаю список каналов…'));
        loadGuide();
        Promise.all(sources.map(fetchSource)).then(function (results) {
            var failed = [];
            channels = [];
            results.forEach(function (result) {
                if (result.error) {
                    failed.push('«' + result.source.name + '»: ' + result.error);
                } else {
                    // One adult group marks the whole playlist, so ungrouped entries are hidden too.
                    var adultSource = result.channels.some(function (channel) { return ADULT_GROUP.test(channel.group); });
                    result.channels.forEach(function (channel) {
                        channel.source = result.source.name;
                        channel.adult = adultSource;
                    });
                    channels = channels.concat(result.channels);
                }
            });
            if (!adultVisible()) {
                channels = channels.filter(function (channel) { return !channel.adult; });
            }
            // The same stream in two playlists shows once, from the first playlist.
            var seenUrls = {};
            channels = channels.filter(function (channel) {
                if (seenUrls[channel.url]) {
                    return false;
                }
                seenUrls[channel.url] = true;
                return true;
            });
            if (setting('hideDead')) {
                channels = channels.filter(function (channel) { return !isDead(channel.url); });
            }
            channels.forEach(function (channel, index) { channel.number = index + 1; });
            if (!channels.length) {
                showStatus(t('Не удалось загрузить плейлисты. ') + failed.join('; ') +
                    t('. OK — повторить, зелёная кнопка — изменить плейлисты.'));
                statusBox.dataset.retry = '1';
                return;
            }
            buildSections();
            var last = read(STORE.last, '');
            var start = 0;
            channels.some(function (channel, index) {
                if (channel.url === last) {
                    start = index;
                    return true;
                }
                return false;
            });
            play(start, allIndexes(function (c) { return c.film === channels[start].film; }));
            if (failed.length) {
                showStatus(t('Не загрузились: ') + failed.join('; ') + '.');
                restartTimer('status', 6000, hideStatus);
            }
            openHome();
        });
    }

    function loadGuide() {
        fetch(GUIDE_URL, { cache: 'no-store' })
            .then(function (response) { return response.ok ? response.json() : {}; })
            .then(function (data) {
                guide = data || {};
                if (screen === 'home') {
                    renderGrid();
                }
            }, function () { /* the guide is optional */ });
    }

    // [now, next] programmes of a channel, each [start, stop, title] in Unix seconds.
    function nowNext(channel) {
        var shows = channel.tvgId && guide[channel.tvgId];
        if (!shows) {
            return [null, null];
        }
        var now = Date.now() / 1000;
        for (var i = 0; i < shows.length; i++) {
            if (shows[i][0] <= now && now < shows[i][1]) {
                return [shows[i], shows[i + 1] || null];
            }
        }
        return [null, null];
    }

    function hhmm(seconds) {
        var date = new Date(seconds * 1000);
        return ('0' + date.getHours()).slice(-2) + ':' + ('0' + date.getMinutes()).slice(-2);
    }

    function showProgress(show) {
        var now = Date.now() / 1000;
        return Math.max(0, Math.min(100, (now - show[0]) / (show[1] - show[0]) * 100));
    }

    function allIndexes(filter) {
        var list = [];
        channels.forEach(function (channel, index) {
            if (!filter || filter(channel)) {
                list.push(index);
            }
        });
        return list;
    }

    // ---------- Sections (left rail) ----------

    function indexesForUrls(urls) {
        var byUrl = {};
        channels.forEach(function (channel, index) {
            if (!(channel.url in byUrl)) {
                byUrl[channel.url] = index;
            }
        });
        return urls.filter(function (url) { return url in byUrl; }).map(function (url) { return byUrl[url]; });
    }

    function buildSections() {
        var live = allIndexes(function (c) { return !c.film; });
        var films = allIndexes(function (c) { return c.film; });
        sections = [
            { kind: 'list', id: 'favourites', name: t('Избранное'), icon: 'star', items: indexesForUrls(read(STORE.favourites, [])) }
        ];
        sections.splice(0, 0, { kind: 'action', id: 'search-action', name: t('Поиск'), icon: 'search', action: function () { openPrompt(-1, null, 'search'); } });
        if (searchResult) {
            sections.splice(1, 0, searchResult);
        }
        sections.push({ kind: 'heading', name: t('Мои папки') });
        read(STORE.folders, []).forEach(function (folder) {
            sections.push({ kind: 'list', id: 'folder:' + folder.id, folderId: folder.id, name: folder.name, icon: 'heartfolder', items: indexesForUrls(folder.urls) });
        });
        sections.push({ kind: 'action', name: t('Новая папка'), icon: 'plus', action: function () { openPrompt(-1); } });
        if (live.length) {
            sections.push({ kind: 'list', id: 'live', name: t('Все каналы'), icon: 'tv', items: live });
        }
        if (films.length) {
            sections.push({ kind: 'list', id: 'films', name: t('Все фильмы'), icon: 'film', items: films });
        }
        if (setting('adult') && pinSet() && !adultUnlocked) {
            sections.push({ kind: 'action', name: t('Открыть 18+'), icon: 'lock', action: function () {
                openPin('check', t('Открыть 18+'), t('Введите PIN-код'), function () {
                    adultUnlocked = true;
                    loadPlaylists();
                });
            } });
        }
        var bySource = {};
        var playlists = [];
        channels.forEach(function (channel, index) {
            if (!bySource[channel.source]) {
                bySource[channel.source] = { kind: 'list', id: 'source:' + channel.source, name: channel.source, icon: 'list', items: [] };
                playlists.push(bySource[channel.source]);
            }
            bySource[channel.source].items.push(index);
        });
        if (playlists.length > 1) {
            sections.push({ kind: 'heading', name: t('Мои плейлисты') });
            sections = sections.concat(playlists);
        }
        sections.push({ kind: 'heading', name: t('Группы') });
        var groupPrefs = read(STORE.groups, { hidden: [], order: [] });
        orderedGroups().forEach(function (group) {
            if (groupPrefs.hidden.indexOf(group.name) < 0) {
                sections.push(group);
            }
        });
        // Playlists and Settings live on the green and blue keys; only Help stays here.
        sections.push({ kind: 'heading', name: t('Приложение') });
        sections.push({ kind: 'action', name: t('Справка по пульту'), icon: 'help', action: openHelp });
    }

    // All groups in the user's order (new groups go last, in playlist order).
    function orderedGroups() {
        var byGroup = {};
        var groups = [];
        channels.forEach(function (channel, index) {
            if (!byGroup[channel.group]) {
                byGroup[channel.group] = { kind: 'list', id: 'group:' + channel.group, name: channel.group, icon: 'folder', items: [] };
                groups.push(byGroup[channel.group]);
            }
            byGroup[channel.group].items.push(index);
        });
        // Groups with one or two channels make the menu long: fold them into "Другое".
        var other = null;
        groups = groups.filter(function (group) {
            if (group.items.length >= 3 || group.name === t('Другое')) {
                return true;
            }
            if (!other) {
                other = byGroup[t('Другое')] || { kind: 'list', id: 'group:Другое', name: t('Другое'), icon: 'folder', items: [] };
            }
            other.items = other.items.concat(group.items);
            return false;
        });
        if (other && groups.indexOf(other) < 0) {
            groups.push(other);
        }
        if (other) {
            other.items.sort(function (a, b) { return a - b; });
        }
        var order = read(STORE.groups, { hidden: [], order: [] }).order;
        return groups.sort(function (a, b) {
            var ia = order.indexOf(a.name);
            var ib = order.indexOf(b.name);
            return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
        });
    }

    function refreshPersonalSections() {
        sections.forEach(function (section) {
            if (section.id === 'favourites') {
                section.items = indexesForUrls(read(STORE.favourites, []));
            } else if (section.id === 'recent') {
                section.items = indexesForUrls(read(STORE.recent, []));
            } else if (section.folderId) {
                var folder = findFolder(section.folderId);
                section.items = folder ? indexesForUrls(folder.urls) : [];
            }
        });
    }

    // ---------- Playback ----------

    var statusBox = $('status');

    function showStatus(text) {
        statusBox.textContent = text;
        statusBox.hidden = false;
        delete statusBox.dataset.retry;
    }

    function hideStatus() {
        statusBox.hidden = true;
    }

    function stopPlayback() {
        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.removeAttribute('src');
        video.load();
        current = -1;
    }

    function startVideo() {
        var attempt = video.play();
        if (attempt && attempt.catch) {
            attempt.catch(function (err) {
                // webOS may block autoplay with sound: play muted and unmute on the next key press.
                if (err && err.name === 'NotAllowedError' && !video.muted) {
                    video.muted = true;
                    autoMuted = true;
                    video.play();
                }
            });
        }
    }

    function play(index, list) {
        savePosition(true);
        if (index !== current) {
            previous = current;
        }
        current = index;
        if (list) {
            playList = list;
        }
        var channel = channels[index];
        write(STORE.last, channel.url);
        var recent = read(STORE.recent, []).filter(function (url) { return url !== channel.url; });
        recent.unshift(channel.url);
        write(STORE.recent, recent.slice(0, RECENT_LIMIT));
        refreshPersonalSections();

        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.removeAttribute('src');
        showStatus(channel.film ? t('Загружаю фильм…') : t('Подключаюсь к каналу…'));

        // Films are plain video files the TV plays itself; live channels are HLS.
        if (channel.film || !(window.Hls && Hls.isSupported())) {
            video.src = channel.url;
        } else {
            hls = new Hls({ maxBufferLength: 20, manifestLoadingMaxRetry: 2, levelLoadingMaxRetry: 2 });
            hls.on(Hls.Events.ERROR, function (event, data) {
                if (!data.fatal) {
                    return;
                }
                if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    noSignal();
                }
            });
            hls.loadSource(channel.url);
            hls.attachMedia(video);
        }
        startVideo();
        if (screen === 'player') {
            showOsd();
        }
    }

    function noSignal() {
        showStatus(t('Канал сейчас не отвечает. Переключите кнопками CH+ CH−.'));
        if (current >= 0) {
            var dead = read(STORE.dead, {});
            dead[channels[current].url] = Date.now();
            write(STORE.dead, dead);
        }
    }

    function isDead(url) {
        var at = read(STORE.dead, {})[url];
        return !!at && Date.now() - at < DEAD_FOR;
    }

    function markAlive(url) {
        var dead = read(STORE.dead, {});
        if (dead[url]) {
            delete dead[url];
            write(STORE.dead, dead);
        }
    }

    // Film positions, so a film continues where it stopped.
    var lastSaved = 0;

    function savePosition(force) {
        if (current < 0 || !channels[current].film || !isFinite(video.duration)) {
            return;
        }
        if (!force && Date.now() - lastSaved < 10000) {
            return;
        }
        lastSaved = Date.now();
        var positions = read(STORE.positions, {});
        var url = channels[current].url;
        // Near the end counts as watched: start from the beginning next time.
        if (video.currentTime < 30 || video.duration - video.currentTime < 120) {
            delete positions[url];
        } else {
            positions[url] = Math.floor(video.currentTime);
        }
        write(STORE.positions, positions);
    }

    video.addEventListener('pause', function () { savePosition(true); });
    video.addEventListener('loadedmetadata', function () {
        if (current < 0 || !channels[current].film) {
            return;
        }
        var at = read(STORE.positions, {})[channels[current].url];
        if (at && at < video.duration - 60) {
            video.currentTime = at;
            toast(t('Продолжаю с ') + clockText(at) + t('. С начала — держите ←'));
        }
    });

    video.addEventListener('playing', hideStatus);
    video.addEventListener('timeupdate', function () {
        if (video.currentTime > 0 && !statusBox.dataset.retry) {
            hideStatus();
            if (current >= 0) {
                markAlive(channels[current].url);
            }
        }
        savePosition(false);
        if (!osd.hidden) {
            updateProgress();
        }
    });
    video.addEventListener('error', noSignal);

    function step(delta) {
        if (!playList.length) {
            return;
        }
        var position = playList.indexOf(current);
        play(playList[(position + delta + playList.length) % playList.length]);
    }

    function seek(direction) {
        if (!isFinite(video.duration)) {
            return;
        }
        var stepSeconds = SEEK_STEPS[Math.min(seekRun, SEEK_STEPS.length - 1)];
        seekRun++;
        restartTimer('seekRun', SEEK_RESET, function () { seekRun = 0; });
        video.currentTime = Math.max(0, Math.min(video.duration - 1, video.currentTime + direction * stepSeconds));
        $('osd-step').textContent = (direction > 0 ? '+' : '−') + (stepSeconds >= 60 ? stepSeconds / 60 + t(' мин') : stepSeconds + t(' с'));
        $('osd-step').hidden = false;
        restartTimer('seekLabel', 1200, function () { $('osd-step').hidden = true; });
        showOsd();
    }

    function togglePause(forcePlay) {
        if (forcePlay === undefined ? video.paused : forcePlay) {
            startVideo();
        } else {
            video.pause();
        }
        showOsd();
    }

    function isFavourite(index) {
        return read(STORE.favourites, []).indexOf(channels[index].url) >= 0;
    }

    function toggleFavourite(index) {
        if (index < 0) {
            return;
        }
        var url = channels[index].url;
        var list = read(STORE.favourites, []);
        var at = list.indexOf(url);
        if (at >= 0) {
            list.splice(at, 1);
        } else {
            list.unshift(url);
        }
        write(STORE.favourites, list);
        refreshPersonalSections();
    }

    // ---------- On-screen display ----------

    var osd = $('osd');

    function showOsd() {
        if (current < 0) {
            return;
        }
        var channel = channels[current];
        $('osd-number').textContent = channel.number;
        var logo = $('osd-logo');
        logo.hidden = !channel.logo;
        if (channel.logo) {
            logo.src = channel.logo;
        }
        $('osd-name').textContent = channel.name;
        $('osd-group').textContent = channel.group;
        $('osd-fav').hidden = !isFavourite(current);
        $('osd-progress').hidden = !channel.film;
        var programmes = channel.film ? [null, null] : nowNext(channel);
        $('osd-epg').hidden = !programmes[0];
        if (programmes[0]) {
            $('osd-epg-title').textContent = programmes[0][2];
            $('osd-epg-time').textContent = hhmm(programmes[0][0]) + '–' + hhmm(programmes[0][1]);
            $('osd-epg-bar').style.width = showProgress(programmes[0]) + '%';
            $('osd-epg-next').textContent = programmes[1] ? t('Далее ') + hhmm(programmes[1][0]) + ' · ' + programmes[1][2] : '';
        }
        updateProgress();
        $('osd-state').innerHTML = channel.film ? svg(video.paused ? 'play' : 'pause') : '';
        $('osd-state').hidden = !channel.film;
        setHints($('osd-hints'), channel.film ? [
            [['OK'], video.paused ? t('Продолжить') : t('Пауза')],
            [['leftright'], t('Перемотка (чаще — быстрее)')],
            [['CH+', 'CH−'], t('Другой фильм')],
            [['red'], isFavourite(current) ? t('Убрать из избранного') : t('В избранное')],
            [['back'], t('Меню')]
        ] : [
            [['OK'], t('Меню')],
            [['CH+', 'CH−'], t('Канал')],
            [['0–9'], t('Номер')],
            [['red'], isFavourite(current) ? t('Убрать из избранного') : t('В избранное')],
            [['yellow'], t('Предыдущий')],
            [['back'], t('Назад')]
        ]);
        osd.hidden = false;
        restartTimer('osd', OSD_TIMEOUT, function () {
            if (!(channel.film && video.paused)) {
                osd.hidden = true;
            }
        });
    }

    function updateProgress() {
        if (current < 0 || !channels[current].film || !isFinite(video.duration) || !video.duration) {
            $('osd-time').textContent = '';
            return;
        }
        var played = video.currentTime / video.duration * 100;
        var buffered = 0;
        for (var i = 0; i < video.buffered.length; i++) {
            if (video.buffered.start(i) <= video.currentTime) {
                buffered = video.buffered.end(i) / video.duration * 100;
            }
        }
        $('osd-bar').style.width = played + '%';
        $('osd-buffer').style.width = buffered + '%';
        $('osd-thumb').style.left = played + '%';
        $('osd-time').textContent = clockText(video.currentTime) + ' / ' + clockText(video.duration) +
            t(' · осталось ') + clockText(video.duration - video.currentTime);
    }

    // ---------- Screens ----------

    function showScreen(name) {
        screen = name;
        $('home').hidden = name !== 'home';
        $('sources').hidden = name !== 'sources';
        $('help').hidden = name !== 'help';
        $('settings').hidden = name !== 'settings';
        updateBackdrop();
        $('dialog').hidden = name !== 'dialog';
        if (name !== 'player') {
            osd.hidden = true;
        }
    }

    // The backdrop shows wherever there is no picture to look at.
    function updateBackdrop() {
        var playing = current >= 0 && !video.paused && video.readyState > 1;
        $('backdrop').style.display = (screen === 'player' || (screen === 'home' && playing)) ? 'none' : '';
    }

    video.addEventListener('playing', updateBackdrop);
    video.addEventListener('emptied', updateBackdrop);

    // ---------- Home ----------

    var rail = $('rail');
    var grid = $('grid');
    var home = { area: 'grid', rail: -1, tile: 0, topRow: 0 };

    function focusableRail(index) {
        return sections[index] && sections[index].kind !== 'heading';
    }

    function openHome() {
        if (!channels.length) {
            openSources();
            return;
        }
        refreshPersonalSections();
        // Player messages belong to full-screen viewing, not to the menu.
        if (!statusBox.dataset.retry) {
            hideStatus();
        }
        showScreen('home');
        // Open on the section and tile of what is playing.
        var target = -1;
        for (var i = 0; i < sections.length && target < 0; i++) {
            if (sections[i].kind === 'list' && sections[i].id !== 'favourites' && sections[i].id !== 'recent' &&
                sections[i].items.indexOf(current) >= 0) {
                target = i;
            }
        }
        if (target < 0) {
            sections.forEach(function (section, i) {
                if (target < 0 && (section.id === 'live' || section.id === 'films')) {
                    target = i;
                }
            });
        }
        home.rail = target;
        home.tile = Math.max(0, sections[target].items.indexOf(current));
        home.topRow = Math.max(0, Math.floor(home.tile / GRID.cols) - 1);
        home.area = 'grid';
        renderRail();
        renderGrid();
        tickClock();
        updateHomeHints();
    }

    function renderRail() {
        rail.innerHTML = '';
        sections.forEach(function (section, index) {
            var item;
            if (section.kind === 'heading') {
                item = el('li', 'rail-heading', section.name);
            } else {
                item = el('li', 'rail-item' + (section.folderId ? ' folder' : ''));
                item.dataset.rail = index;
                item.innerHTML = svg(section.icon);
                item.appendChild(el('span', 'rail-name', section.name));
                if (section.kind === 'list') {
                    item.appendChild(el('span', 'rail-count', String(section.items.length)));
                }
            }
            rail.appendChild(item);
        });
        markRail();
    }

    function markRail() {
        Array.prototype.forEach.call(rail.children, function (item) {
            var index = Number(item.dataset.rail);
            item.classList.toggle('selected', index === home.rail && home.area === 'grid');
            item.classList.toggle('focused', index === home.rail && home.area === 'rail');
        });
        // Keep the active row in view: the rail scrolls as a whole list.
        var active = rail.querySelector('[data-rail="' + home.rail + '"]');
        if (active) {
            var offset = Math.max(0, active.offsetTop - 300);
            rail.style.transform = 'translateY(' + (-offset) + 'px)';
        }
        var section = sections[home.rail];
        $('section-title').textContent = section && section.kind === 'list'
            ? section.name + ' · ' + section.items.length : '';
    }

    // Letters for tiles without a logo, e.g. "First Channel News" -> "FC".
    function tileLabel(name) {
        var words = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/[^0-9A-Za-zА-Яа-яЁёԱ-Ֆա-ֆ]+/).filter(Boolean);
        return words.slice(0, 2).map(function (word) { return word.charAt(0); }).join('').toUpperCase() || '•';
    }

    // A stable colour per channel, so placeholder tiles are told apart at a glance.
    function tint(name) {
        var hash = 0;
        for (var i = 0; i < name.length; i++) {
            hash = (hash * 31 + name.charCodeAt(i)) % 360;
        }
        return hash;
    }

    function initials(channel) {
        var hue = tint(channel.name);
        var node = el('div', 'tile-initials', tileLabel(channel.name));
        node.style.background = 'hsl(' + hue + ', 32%, 22%)';
        node.style.color = 'hsl(' + hue + ', 70%, 78%)';
        return node;
    }

    function renderGrid() {
        var section = sections[home.rail];
        grid.innerHTML = '';
        var empty = $('grid-empty');
        if (!section || section.kind !== 'list' || !section.items.length) {
            empty.hidden = false;
            empty.textContent = section && section.id === 'favourites'
                ? t('Здесь будут избранные каналы. На любом канале нажмите красную кнопку.')
                : section && section.id === 'recent' ? t('Здесь появятся каналы, которые вы смотрели.')
                    : section && section.kind === 'action' ? t('Нажмите OK, чтобы открыть.') : '';
            return;
        }
        empty.hidden = true;
        var favourites = read(STORE.favourites, []);
        var first = home.topRow * GRID.cols;
        var last = Math.min(section.items.length, first + (GRID.rows + 1) * GRID.cols);
        for (var position = first; position < last; position++) {
            var index = section.items[position];
            var channel = channels[index];
            var row = Math.floor(position / GRID.cols) - home.topRow;
            var col = position % GRID.cols;
            var tile = el('div', 'tile' + (channel.film ? ' film' : '') + (isDead(channel.url) ? ' dead' : '') +
                (position === home.tile && home.area === 'grid' ? ' focused' : ''));
            tile.dataset.tile = position;
            tile.style.left = (GRID.inset + col * (GRID.tileW + GRID.gapX)) + 'px';
            tile.style.top = (GRID.inset + row * (GRID.tileH + GRID.gapY)) + 'px';

            var frame = el('div', 'tile-logo');
            if (channel.logo) {
                var img = el('img');
                img.alt = '';
                img.src = channel.logo;
                img.onerror = (function (owner) {
                    return function () {
                        this.parentNode.appendChild(initials(owner));
                        this.remove();
                    };
                }(channel));
                frame.appendChild(img);
            } else {
                frame.appendChild(initials(channel));
            }
            tile.appendChild(frame);
            tile.appendChild(el('span', 'tile-number', String(channel.number)));
            if (favourites.indexOf(channel.url) >= 0) {
                tile.appendChild(el('span', 'tile-fav', '♥'));
            }
            if (index === current) {
                tile.appendChild(el('span', 'tile-playing', t('Сейчас')));
            }
            if (isDead(channel.url)) {
                tile.appendChild(el('span', 'tile-dead', t('не отвечает')));
            }
            var onAir = channel.film ? null : nowNext(channel)[0];
            if (onAir) {
                tile.classList.add('guide');
                tile.appendChild(el('span', 'tile-now', onAir[2]));
                var bar = el('span', 'tile-now-bar');
                bar.style.width = showProgress(onAir) + '%';
                tile.appendChild(bar);
            }
            tile.appendChild(el('span', 'tile-name', channel.name));
            grid.appendChild(tile);
        }
    }

    function moveTile(delta) {
        var section = sections[home.rail];
        var size = section.items.length;
        var next = home.tile + delta;
        if (delta === -1 && home.tile % GRID.cols === 0) {
            focusRail();
            return;
        }
        if (next < 0 || next >= size) {
            if (Math.abs(delta) === GRID.cols && next >= size && Math.floor(home.tile / GRID.cols) < Math.floor((size - 1) / GRID.cols)) {
                next = size - 1;   // last, partially filled row
            } else {
                return;
            }
        }
        if (delta === 1 && next % GRID.cols === 0) {
            return;   // stay on the row; ▼ moves down
        }
        home.tile = next;
        var row = Math.floor(next / GRID.cols);
        if (row < home.topRow) {
            home.topRow = row;
        } else if (row > home.topRow + GRID.rows - 1) {
            home.topRow = row - GRID.rows + 1;
        }
        renderGrid();
    }

    function focusRail() {
        home.area = 'rail';
        markRail();
        renderGrid();
        updateHomeHints();
    }

    function focusGrid() {
        var section = sections[home.rail];
        if (section.kind === 'action') {
            return;
        }
        if (!section.items.length) {
            return;
        }
        home.area = 'grid';
        home.tile = Math.min(home.tile, section.items.length - 1);
        markRail();
        renderGrid();
        updateHomeHints();
    }

    function moveRail(delta) {
        // Big jumps (CH+/CH-) stop at the first or last row instead of doing nothing.
        var next = Math.max(0, Math.min(sections.length - 1, home.rail + delta));
        var stepBack = delta > 0 ? -1 : 1;
        while (next >= 0 && next < sections.length && !focusableRail(next)) {
            next += Math.abs(delta) === 1 ? (delta > 0 ? 1 : -1) : stepBack;
        }
        if (next < 0 || next >= sections.length || (next === home.rail && delta !== 0)) {
            return;
        }
        home.rail = next;
        home.tile = 0;
        home.topRow = 0;
        markRail();
        // Preview the section after a short pause so fast scrolling stays smooth.
        restartTimer('preview', 140, renderGrid);
    }

    function chooseInHome() {
        var section = sections[home.rail];
        if (home.area === 'rail') {
            if (section.kind === 'action') {
                section.action();
            } else {
                focusGrid();
            }
            return;
        }
        var index = section.items[home.tile];
        if (index === undefined) {
            return;
        }
        var list = section.items.slice();
        if (index !== current) {
            play(index, list);
        } else {
            playList = list;
        }
        showScreen('player');
        showOsd();
    }

    function updateHomeHints() {
        setHints($('home-hints'), home.area === 'grid' ? [
            [['OK'], t('Смотреть')],
            [['red'], t('Избранное')],
            [['green'], t('Плейлисты')],
            [['yellow'], t('В папку')],
            [['blue'], t('Настройки')],
            [['CH+', 'CH−'], t('Страница')],
            [['INFO'], t('Справка')],
            [['back'], t('Выход')]
        ] : [
            [['updown'], t('Раздел')],
            [['right'], t('К каналам')],
            [['OK'], t('Открыть')],
            [['yellow'], sections[home.rail] && sections[home.rail].folderId ? t('Переименовать / удалить') : t('Папки')],
            [['green'], t('Плейлисты')],
            [['INFO'], t('Справка')],
            [['back'], t('Выход')]
        ]);
    }

    function tickClock() {
        var now = new Date();
        $('clock').textContent = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    }

    setInterval(function () {
        if (screen === 'home') {
            tickClock();
            renderGrid();
        }
    }, 60000);

    function handleHomeKey(code) {
        if (home.area === 'rail') {
            if (code === KEY.UP) { moveRail(-1); }
            else if (code === KEY.DOWN) { moveRail(1); }
            else if (code === KEY.CH_UP) { moveRail(-6); }
            else if (code === KEY.CH_DOWN) { moveRail(6); }
            else if (code === KEY.RIGHT) { focusGrid(); }
            else if (code === KEY.OK) { chooseInHome(); }
            else { return false; }
            return true;
        }
        if (code === KEY.UP) { moveTile(-GRID.cols); }
        else if (code === KEY.DOWN) { moveTile(GRID.cols); }
        else if (code === KEY.LEFT) { moveTile(-1); }
        else if (code === KEY.RIGHT) { moveTile(1); }
        else if (code === KEY.CH_UP) { pageTiles(-1); }
        else if (code === KEY.CH_DOWN) { pageTiles(1); }
        else if (code === KEY.OK) { chooseInHome(); }
        else if (code === KEY.RED) {
            var index = sections[home.rail].items[home.tile];
            toggleFavourite(index);
            renderRail();
            renderGrid();
        } else { return false; }
        return true;
    }

    function pageTiles(direction) {
        var size = sections[home.rail].items.length;
        var target = Math.max(0, Math.min(size - 1, home.tile + direction * GRID.cols * GRID.rows));
        home.tile = target;
        home.topRow = Math.max(0, Math.min(Math.floor(target / GRID.cols), Math.floor((size - 1) / GRID.cols) - GRID.rows + 1));
        renderGrid();
    }

    // ---------- Playlists screen ----------

    var sourcesScreen = $('sources');
    var leftCol = $('source-left');
    var rightCol = $('source-right');
    var sourcesField = $('source-field');
    var sourcesUrl = $('source-url');
    var notice = $('source-notice');
    var sourcesFocus = { col: 'left', row: 0 };
    var pendingRemoval = -1;

    function nameFromUrl(url) {
        // raw.githubusercontent.com/<user>/<repo>/<branch>/<file> reads better as "<repo> / <file>".
        var github = /^https?:\/\/raw\.githubusercontent\.com\/[^\/]+\/([^\/]+)\/(?:refs\/heads\/)?[^\/]+\/(?:.*\/)?([^\/?#]+)/.exec(url);
        if (github) {
            return github[1] + ' / ' + decodeURIComponent(github[2]).replace(/\.m3u8?$/i, '');
        }
        var match = /^https?:\/\/([^\/?#]+)(?:[^?#]*\/)?([^\/?#]*)/.exec(url);
        if (!match) {
            return url;
        }
        var file = decodeURIComponent(match[2] || '').replace(/\.m3u8?$/i, '');
        return file ? match[1] + ' / ' + file : match[1];
    }

    function openSources() {
        showScreen('sources');
        sourcesScreen.classList.remove('catalog-mode');
        notice.textContent = '';
        sourcesFocus = { col: 'left', row: 0 };
        pendingRemoval = -1;
        renderSources();
    }

    function closeSources() {
        sourcesUrl.blur();
        loadPlaylists();
    }

    // Focusable rows per column; headings are drawn but skipped by ▲ ▼.
    function sourceRows() {
        var saved = read(STORE.sources, []);
        var right = [{ kind: 'heading', text: t('Готовые плейлисты') }];
        PRESETS.filter(function (preset) { return !preset.adult || adultVisible(); }).forEach(function (preset) {
            right.push({ kind: 'preset', preset: preset, added: saved.some(function (s) { return s.url === preset.url; }) });
        });
        right.push({ kind: 'catalog' });
        right.push({ kind: 'heading', text: saved.length ? t('Ваши плейлисты · ') + saved.length : t('Ваши плейлисты: пока нет') });
        saved.forEach(function (source, index) {
            right.push({ kind: 'source', index: index, source: source });
        });
        if (saved.length) {
            right.push({ kind: 'done' });
        }
        return { left: [{ kind: 'input' }, { kind: 'add' }], right: right };
    }

    function focusable(rows) {
        return rows.filter(function (row) { return row.kind !== 'heading'; });
    }

    function renderSources() {
        var rows = sourceRows();
        var focusList = focusable(rows[sourcesFocus.col]);
        sourcesFocus.row = Math.max(0, Math.min(sourcesFocus.row, focusList.length - 1));
        var focusedRow = focusList[sourcesFocus.row];

        leftCol.innerHTML = '';
        rightCol.innerHTML = '';
        ['left', 'right'].forEach(function (col) {
            var target = col === 'left' ? leftCol : rightCol;
            var position = 0;
            rows[col].forEach(function (row) {
                var item;
                if (row.kind === 'heading') {
                    target.appendChild(el('li', 'heading', row.text));
                    return;
                }
                if (row.kind === 'input') {
                    item = sourcesField;
                } else if (row.kind === 'add') {
                    item = el('li', 'button', t('Добавить ссылку'));
                } else if (row.kind === 'catalog') {
                    item = el('li', 'button', t('Каталог iptv-org: выбрать страну'));
                } else if (row.kind === 'done') {
                    item = el('li', 'button primary', t('Смотреть'));
                } else if (row.kind === 'preset') {
                    item = el('li', 'preset');
                    item.appendChild(el('span', 'source-name', row.preset.name));
                    item.appendChild(el('span', 'source-action', row.added ? t('Добавлен ✓') : t('Добавить')));
                } else {
                    item = el('li', 'source');
                    item.appendChild(el('span', 'source-name', row.source.name));
                    item.appendChild(el('span', 'source-action', pendingRemoval === row.index ? t('OK ещё раз — удалить') : t('Удалить')));
                }
                item.dataset.col = col;
                item.dataset.row = position;
                item.classList.toggle('focused', row === focusedRow);
                target.appendChild(item);
                position++;
            });
        });

        // Scroll the right column so the focused row stays inside its 900 px box.
        var offset = 0;
        if (sourcesFocus.col === 'right') {
            var focusedNode = rightCol.querySelector('.focused');
            if (focusedNode) {
                offset = Math.max(0, focusedNode.offsetTop + focusedNode.offsetHeight - 760);
            }
        }
        rightCol.style.transform = 'translateY(' + (-offset) + 'px)';

        setHints($('sources-hints'), [
            [['updown', 'leftright'], t('Выбор')],
            [['OK'], t('Открыть')],
            [['back'], read(STORE.sources, []).length ? t('Готово') : t('Выход')]
        ]);
    }

    function addSource(source) {
        var saved = read(STORE.sources, []);
        if (saved.some(function (s) { return s.url === source.url; })) {
            notice.textContent = t('Этот плейлист уже добавлен.');
            return;
        }
        saved.push(source);
        write(STORE.sources, saved);
        notice.textContent = t('Добавлен: ') + source.name + '.';
        sourcesUrl.value = '';
        renderSources();
    }

    function addTypedUrl() {
        var url = sourcesUrl.value.trim();
        if (!/^https?:\/\/\S+$/i.test(url)) {
            notice.textContent = t('Ссылка должна начинаться с http:// или https://');
            return;
        }
        addSource({ name: nameFromUrl(url), url: url });
    }

    function activateSourceRow() {
        var row = focusable(sourceRows()[sourcesFocus.col])[sourcesFocus.row];
        if (!row) {
            return;
        }
        if (row.kind === 'input') {
            sourcesUrl.focus();
        } else if (row.kind === 'add') {
            addTypedUrl();
        } else if (row.kind === 'preset') {
            if (row.added) {
                notice.textContent = '«' + row.preset.name + t('» уже добавлен. Удалить можно ниже.');
            } else {
                addSource({ name: row.preset.name, url: row.preset.url });
            }
        } else if (row.kind === 'catalog') {
            openCatalog();
        } else if (row.kind === 'done') {
            closeSources();
        } else if (pendingRemoval === row.index) {
            var saved = read(STORE.sources, []);
            saved.splice(row.index, 1);
            write(STORE.sources, saved);
            pendingRemoval = -1;
            notice.textContent = t('Плейлист удалён.');
            renderSources();
        } else {
            pendingRemoval = row.index;
            renderSources();
        }
    }

    function moveSources(delta) {
        var count = focusable(sourceRows()[sourcesFocus.col]).length;
        sourcesFocus.row = Math.max(0, Math.min(count - 1, sourcesFocus.row + delta));
        pendingRemoval = -1;
        renderSources();
    }

    function switchSourceColumn(col) {
        if (sourcesFocus.col === col) {
            return;
        }
        sourcesFocus = { col: col, row: 0 };
        pendingRemoval = -1;
        renderSources();
    }

    function handleSourcesKey(code) {
        if (sourcesScreen.classList.contains('catalog-mode')) {
            return handleCatalogKey(code);
        }
        if (document.activeElement === sourcesUrl) {
            // While typing, OK confirms the link and Back leaves the field.
            if (code === KEY.OK) {
                sourcesUrl.blur();
                addTypedUrl();
                return true;
            }
            if (code === KEY.BACK || code === KEY.UP || code === KEY.DOWN) {
                sourcesUrl.blur();
                if (code === KEY.DOWN) {
                    sourcesFocus.row = 1;
                    renderSources();
                }
                return true;
            }
            return false;
        }
        if (code === KEY.UP) { moveSources(-1); }
        else if (code === KEY.DOWN) { moveSources(1); }
        else if (code === KEY.CH_UP) { moveSources(-5); }
        else if (code === KEY.CH_DOWN) { moveSources(5); }
        else if (code === KEY.RIGHT) { switchSourceColumn('right'); }
        else if (code === KEY.LEFT) { switchSourceColumn('left'); }
        else if (code === KEY.OK) { activateSourceRow(); }
        else if (code === KEY.BACK) {
            if (read(STORE.sources, []).length) {
                closeSources();
            } else {
                openDialog('sources');
            }
        } else { return false; }
        return true;
    }

    // ---------- iptv-org country catalog ----------

    var catalogList = $('catalog-list');
    var countries = null;
    var catalogFocus = 0;

    function openCatalog() {
        notice.textContent = t('Загружаю список стран…');
        var ready = countries ? Promise.resolve(countries) : fetch(CATALOG_URL)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(t('сервер ответил ') + response.status);
                }
                return response.json();
            })
            .then(function (list) {
                var pinned = list.filter(function (c) { return CATALOG_PINNED.indexOf(c.code) >= 0; });
                var rest = list.filter(function (c) { return CATALOG_PINNED.indexOf(c.code) < 0; });
                countries = pinned.concat(rest.sort(function (a, b) { return a.name.localeCompare(b.name); }));
                return countries;
            });
        ready.then(function () {
            notice.textContent = '';
            catalogFocus = 0;
            sourcesScreen.classList.add('catalog-mode');
            catalogList.innerHTML = '';
            countries.forEach(function (country, index) {
                var item = el('li', index === 0 ? 'focused' : '', country.name);
                item.dataset.cat = index;
                catalogList.appendChild(item);
            });
            catalogList.scrollTop = 0;
            setHints($('sources-hints'), [
                [['updown'], t('Страна')],
                [['CH+', 'CH−'], t('Быстрее')],
                [['OK'], t('Добавить')],
                [['back'], t('Назад')]
            ]);
        }, function (err) {
            notice.textContent = t('Каталог недоступен: ') + err.message + '.';
        });
    }

    function closeCatalog() {
        sourcesScreen.classList.remove('catalog-mode');
        renderSources();
    }

    function moveCatalog(delta) {
        catalogList.children[catalogFocus].classList.remove('focused');
        catalogFocus = (catalogFocus + delta + countries.length) % countries.length;
        var item = catalogList.children[catalogFocus];
        item.classList.add('focused');
        item.scrollIntoView({ block: 'nearest' });
    }

    function handleCatalogKey(code) {
        if (code === KEY.UP || code === KEY.DOWN) {
            moveCatalog(code === KEY.UP ? -1 : 1);
        } else if (code === KEY.CH_UP || code === KEY.CH_DOWN) {
            moveCatalog(code === KEY.CH_UP ? -10 : 10);
        } else if (code === KEY.OK) {
            var country = countries[catalogFocus];
            closeCatalog();
            addSource({
                name: country.name + ' (iptv-org)',
                url: 'https://iptv-org.github.io/iptv/countries/' + country.code.toLowerCase() + '.m3u'
            });
        } else if (code === KEY.BACK) {
            closeCatalog();
        } else {
            return false;
        }
        return true;
    }

    // ---------- Folders ----------

    function findFolder(id) {
        var match = null;
        read(STORE.folders, []).forEach(function (folder) {
            if (folder.id === id) {
                match = folder;
            }
        });
        return match;
    }

    function saveFolders(folders) {
        write(STORE.folders, folders);
        var railId = sections[home.rail] && sections[home.rail].id;
        buildSections();
        // Keep the rail on the same section after the list changes.
        sections.forEach(function (section, index) {
            if (section.id === railId) {
                home.rail = index;
            }
        });
        if (screen === 'home' || screen === 'picker' || screen === 'prompt') {
            renderRail();
            renderGrid();
        }
    }

    function toggleInFolder(folderId, index) {
        var url = channels[index].url;
        var folders = read(STORE.folders, []);
        var added = false;
        folders.forEach(function (folder) {
            if (folder.id === folderId) {
                var at = folder.urls.indexOf(url);
                if (at >= 0) {
                    folder.urls.splice(at, 1);
                } else {
                    folder.urls.push(url);
                    added = true;
                }
            }
        });
        saveFolders(folders);
        return added;
    }

    function toast(text) {
        $('toast').textContent = text;
        $('toast').hidden = false;
        restartTimer('toast', 2500, function () { $('toast').hidden = true; });
    }

    function homeYellow() {
        var section = sections[home.rail];
        if (home.area === 'rail') {
            if (section && section.folderId) {
                openFolderMenu(section.folderId);
            }
            return;
        }
        var index = section.items[home.tile];
        if (index !== undefined) {
            openPicker(index);
        }
    }

    // Picker: folders with a check mark when the channel is inside, plus "new folder".
    var picker = { mode: 'channel', channel: -1, folder: null, focus: 0, confirm: false };

    function openPicker(index) {
        picker = { mode: 'channel', channel: index, folder: null, focus: 0, confirm: false };
        screen = 'picker';
        $('picker').hidden = false;
        $('picker-title').textContent = t('В папку');
        $('picker-channel').textContent = channels[index].name;
        renderPicker();
        setHints($('picker-hints'), [[['updown'], t('Папка')], [['OK'], t('Положить / убрать')], [['back'], t('Готово')]]);
    }

    function groupRows() {
        var hidden = read(STORE.groups, { hidden: [], order: [] }).hidden;
        return orderedGroups().map(function (group) {
            return { name: group.name, text: group.name + ' · ' + group.items.length, on: hidden.indexOf(group.name) < 0 };
        });
    }

    function openGroups() {
        picker = { mode: 'groups', channel: -1, folder: null, focus: 0, confirm: false };
        screen = 'picker';
        $('picker').hidden = false;
        $('picker-title').textContent = t('Группы');
        $('picker-channel').textContent = t('✓ — группа видна в меню');
        renderPicker();
        setHints($('picker-hints'), [[['OK'], t('Показать / скрыть')], [['CH+', 'CH−'], t('Выше / ниже')], [['back'], t('Готово')]]);
    }

    function toggleGroup(index) {
        var prefs = read(STORE.groups, { hidden: [], order: [] });
        var name = groupRows()[index].name;
        var at = prefs.hidden.indexOf(name);
        if (at >= 0) {
            prefs.hidden.splice(at, 1);
        } else {
            prefs.hidden.push(name);
        }
        write(STORE.groups, prefs);
        renderPicker();
    }

    function moveGroup(index, delta) {
        var names = groupRows().map(function (row) { return row.name; });
        var target = index + delta;
        if (target < 0 || target >= names.length) {
            return;
        }
        var moved = names.splice(index, 1)[0];
        names.splice(target, 0, moved);
        var prefs = read(STORE.groups, { hidden: [], order: [] });
        prefs.order = names;
        write(STORE.groups, prefs);
        picker.focus = target;
        renderPicker();
    }

    function hasTracks() {
        return !!hls && (hls.audioTracks.length > 1 || hls.subtitleTracks.length > 0);
    }

    function trackRows() {
        var rows = [];
        hls.audioTracks.forEach(function (track, i) {
            rows.push({ kind: 'audio', id: i, text: t('Звук: ') + (track.name || track.lang || t('дорожка ') + (i + 1)), on: hls.audioTrack === i });
        });
        if (hls.subtitleTracks.length) {
            rows.push({ kind: 'sub', id: -1, text: t('Субтитры: выключены'), on: hls.subtitleTrack === -1 });
            hls.subtitleTracks.forEach(function (track, i) {
                rows.push({ kind: 'sub', id: i, text: t('Субтитры: ') + (track.name || track.lang || t('дорожка ') + (i + 1)), on: hls.subtitleTrack === i });
            });
        }
        return rows;
    }

    function openTracks() {
        picker = { mode: 'tracks', channel: current, folder: null, focus: 0, confirm: false };
        screen = 'picker';
        $('picker').hidden = false;
        $('picker-title').textContent = t('Звук и субтитры');
        $('picker-channel').textContent = channels[current].name;
        renderPicker();
        setHints($('picker-hints'), [[['updown'], t('Дорожка')], [['OK'], t('Выбрать')], [['back'], t('Закрыть')]]);
    }

    function openFolderMenu(folderId) {
        var folder = findFolder(folderId);
        picker = { mode: 'folder', channel: -1, folder: folder, focus: 0, confirm: false };
        screen = 'picker';
        $('picker').hidden = false;
        $('picker-title').textContent = t('Папка «') + folder.name + '»';
        $('picker-channel').textContent = folder.urls.length + t(' в папке. Сами каналы не удаляются.');
        renderPicker();
        setHints($('picker-hints'), [[['updown'], t('Действие')], [['OK'], t('Выбрать')], [['back'], t('Закрыть')]]);
    }

    function folderActions() {
        return [
            { id: 'rename', text: t('Переименовать') },
            { id: 'delete', text: picker.confirm ? t('Точно удалить? OK — да') : t('Удалить папку') },
            { id: 'cancel', text: t('Отмена') }
        ];
    }

    function renderPicker() {
        if (picker.mode === 'tracks' || picker.mode === 'groups') {
            var rows = picker.mode === 'tracks' ? trackRows() : groupRows();
            var list = $('picker-list');
            list.innerHTML = '';
            rows.forEach(function (row, i) {
                var item = el('li', i === picker.focus ? 'focused' : '');
                item.dataset.pick = i;
                item.appendChild(el('span', '', row.text));
                item.appendChild(el('span', 'check', row.on ? '✓' : ''));
                list.appendChild(item);
            });
            var focusedRow = list.children[picker.focus];
            if (focusedRow) {
                focusedRow.scrollIntoView({ block: 'nearest' });
            }
            return;
        }
        if (picker.mode === 'folder') {
            var actions = $('picker-list');
            actions.innerHTML = '';
            folderActions().forEach(function (action, i) {
                var row = el('li', (i === picker.focus ? 'focused' : '') + (action.id === 'delete' && picker.confirm ? ' danger' : ''));
                row.dataset.pick = i;
                row.appendChild(el('span', '', action.text));
                actions.appendChild(row);
            });
            return;
        }
        var folders = read(STORE.folders, []);
        var url = channels[picker.channel].url;
        var list = $('picker-list');
        list.innerHTML = '';
        folders.forEach(function (folder, i) {
            var row = el('li', i === picker.focus ? 'focused' : '');
            row.dataset.pick = i;
            row.appendChild(el('span', '', folder.name + ' · ' + folder.urls.length));
            row.appendChild(el('span', 'check', folder.urls.indexOf(url) >= 0 ? '✓' : ''));
            list.appendChild(row);
        });
        var create = el('li', folders.length === picker.focus ? 'focused' : '');
        create.dataset.pick = folders.length;
        create.appendChild(el('span', '', t('＋ Новая папка')));
        list.appendChild(create);
        var focused = list.children[picker.focus];
        if (focused) {
            focused.scrollIntoView({ block: 'nearest' });
        }
    }

    function closePicker() {
        $('picker').hidden = true;
        if (picker.mode === 'tracks') {
            screen = 'player';
            return;
        }
        if (picker.mode === 'groups') {
            buildSections();
            openHome();
            return;
        }
        screen = 'home';
        renderRail();
        renderGrid();
    }

    function chooseFolderAction() {
        var action = folderActions()[picker.focus].id;
        var folder = picker.folder;
        if (action === 'rename') {
            $('picker').hidden = true;
            openPrompt(-1, folder);
        } else if (action === 'delete') {
            if (!picker.confirm) {
                picker.confirm = true;
                renderPicker();
                return;
            }
            saveFolders(read(STORE.folders, []).filter(function (f) { return f.id !== folder.id; }));
            toast(t('Папка «') + folder.name + t('» удалена'));
            closePicker();
            if (!focusableRail(home.rail) || !sections[home.rail]) {
                home.rail = Math.max(0, home.rail - 1);
            }
            moveRail(0);
            markRail();
            renderGrid();
        } else {
            closePicker();
        }
    }

    function choosePicker() {
        if (picker.mode === 'tracks') {
            var row = trackRows()[picker.focus];
            if (row.kind === 'audio') {
                hls.audioTrack = row.id;
            } else {
                hls.subtitleTrack = row.id;
                hls.subtitleDisplay = row.id >= 0;
            }
            setTimeout(renderPicker, 200);
            return;
        }
        if (picker.mode === 'groups') {
            toggleGroup(picker.focus);
            return;
        }
        if (picker.mode === 'folder') {
            chooseFolderAction();
            return;
        }
        var folders = read(STORE.folders, []);
        if (picker.focus === folders.length) {
            $('picker').hidden = true;
            openPrompt(picker.channel);
            return;
        }
        var folder = folders[picker.focus];
        var added = toggleInFolder(folder.id, picker.channel);
        toast((added ? t('Добавлено в «') : t('Убрано из «')) + folder.name + '»');
        renderPicker();
    }

    function handlePickerKey(code) {
        var count = picker.mode === 'folder' ? folderActions().length
            : picker.mode === 'tracks' ? trackRows().length
                : picker.mode === 'groups' ? groupRows().length
                    : read(STORE.folders, []).length + 1;
        if (picker.mode === 'groups' && (code === KEY.CH_UP || code === KEY.CH_DOWN)) {
            moveGroup(picker.focus, code === KEY.CH_UP ? -1 : 1);
            return true;
        }
        if (code === KEY.UP || code === KEY.DOWN) {
            picker.focus = (picker.focus + (code === KEY.UP ? -1 : 1) + count) % count;
            picker.confirm = false;
            renderPicker();
        } else if (code === KEY.OK) {
            choosePicker();
        } else if (code === KEY.BACK || code === KEY.YELLOW) {
            closePicker();
        } else {
            return false;
        }
        return true;
    }

    // Prompt for a new folder name; `channelIndex` (or -1) goes straight into it.
    var promptState = { channel: -1, folder: null, focus: 0, mode: 'folder' };
    var searchResult = null;
    var promptInput = $('prompt-input');

    // `folder` set = rename that folder; otherwise create a new one.
    function openPrompt(channelIndex, folder, mode) {
        promptState = { channel: channelIndex, folder: folder || null, focus: 0, mode: mode || 'folder' };
        screen = 'prompt';
        $('home').hidden = channels.length === 0;
        $('prompt').hidden = false;
        var search = promptState.mode === 'search';
        $('prompt-title').textContent = search ? t('Поиск канала или фильма') : folder ? t('Переименовать папку') : t('Новая папка');
        $('prompt-create').textContent = search ? t('Найти') : folder ? t('Сохранить') : t('Создать');
        promptInput.placeholder = search ? t('Часть названия, например «Shant»') : t('Например: Любимые фильмы');
        promptInput.value = folder ? folder.name : '';
        markPrompt();
    }

    function runSearch() {
        var query = promptInput.value.trim().toLowerCase();
        if (!query) {
            toast(t('Введите часть названия'));
            return;
        }
        var items = allIndexes(function (c) { return c.name.toLowerCase().indexOf(query) >= 0; });
        closePrompt();
        if (!items.length) {
            toast(t('Ничего не найдено по «') + promptInput.value.trim() + '»');
            return;
        }
        searchResult = { kind: 'list', id: 'search', name: t('Найдено: ') + promptInput.value.trim(), icon: 'search', items: items };
        buildSections();
        home.rail = 1;
        home.tile = 0;
        home.topRow = 0;
        home.area = 'grid';
        renderRail();
        renderGrid();
        updateHomeHints();
    }

    function markPrompt() {
        promptInput.classList.toggle('focused', promptState.focus === 0);
        $('prompt-create').classList.toggle('focused', promptState.focus === 1);
        $('prompt-cancel').classList.toggle('focused', promptState.focus === 2);
    }

    function closePrompt() {
        promptInput.blur();
        $('prompt').hidden = true;
        screen = 'home';
        renderRail();
        renderGrid();
        updateHomeHints();
    }

    function createFolder() {
        if (promptState.mode === 'search') {
            runSearch();
            return;
        }
        var name = promptInput.value.trim();
        if (!name) {
            promptState.focus = 0;
            markPrompt();
            toast(t('Введите название папки'));
            return;
        }
        var folders = read(STORE.folders, []);
        if (promptState.folder) {
            folders.forEach(function (f) {
                if (f.id === promptState.folder.id) {
                    f.name = name;
                }
            });
            saveFolders(folders);
            toast(t('Папка переименована: «') + name + '»');
            closePrompt();
            return;
        }
        var folder = { id: String(Date.now()), name: name, urls: [] };
        if (promptState.channel >= 0) {
            folder.urls.push(channels[promptState.channel].url);
        }
        folders.push(folder);
        saveFolders(folders);
        toast(promptState.channel >= 0 ? t('Папка «') + name + t('» создана, канал добавлен') : t('Папка «') + name + t('» создана'));
        closePrompt();
    }

    function handlePromptKey(code) {
        if (document.activeElement === promptInput) {
            if (code === KEY.OK) {
                promptInput.blur();
                createFolder();
                return true;
            }
            if (code === KEY.BACK || code === KEY.DOWN) {
                promptInput.blur();
                promptState.focus = 1;
                markPrompt();
                return true;
            }
            return false;
        }
        if (code === KEY.UP) {
            promptState.focus = 0;
        } else if (code === KEY.DOWN && promptState.focus === 0) {
            promptState.focus = 1;
        } else if (code === KEY.LEFT && promptState.focus === 2) {
            promptState.focus = 1;
        } else if (code === KEY.RIGHT && promptState.focus === 1) {
            promptState.focus = 2;
        } else if (code === KEY.OK) {
            if (promptState.focus === 0) {
                promptInput.focus();
            } else if (promptState.focus === 1) {
                createFolder();
            } else {
                closePrompt();
            }
            return true;
        } else if (code === KEY.BACK) {
            closePrompt();
            return true;
        } else {
            return false;
        }
        markPrompt();
        return true;
    }

    // Magic Remote drag and drop: hold a tile, drag it onto a folder in the rail.
    var drag = null;
    var suppressClick = false;

    document.addEventListener('mousedown', function (event) {
        var tile = event.target.closest('[data-tile]');
        if (!tile || screen !== 'home') {
            return;
        }
        var from = sections[home.rail];
        var index = from.items[Number(tile.dataset.tile)];
        drag = { index: index, from: from, active: false, x: event.clientX, y: event.clientY };
        restartTimer('drag', DRAG_DELAY, function () {
            if (!drag) {
                return;
            }
            drag.active = true;
            document.body.classList.add('dragging');
            var ghost = $('ghost');
            ghost.textContent = channels[index].name;
            ghost.style.left = drag.x + 'px';
            ghost.style.top = drag.y + 'px';
            ghost.hidden = false;
            // From a folder or favourites the tile can also be thrown away.
            var removable = !!drag.from.folderId || drag.from.id === 'favourites';
            $('trash').hidden = !removable;
            $('trash-label').textContent = drag.from.folderId ? t('Убрать из папки') : t('Убрать из избранного');
            toast(removable ? t('Перетащите на папку слева или в корзину') : t('Перетащите на папку в меню слева'));
        });
    });

    document.addEventListener('mousemove', function (event) {
        if (!drag) {
            return;
        }
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (!drag.active) {
            return;
        }
        var ghost = $('ghost');
        ghost.style.left = drag.x + 'px';
        ghost.style.top = drag.y + 'px';
        var over = document.elementFromPoint(drag.x, drag.y);
        var target = over && over.closest('.rail-item.folder');
        Array.prototype.forEach.call(rail.querySelectorAll('.drop-target'), function (item) {
            if (item !== target) {
                item.classList.remove('drop-target');
            }
        });
        if (target) {
            target.classList.add('drop-target');
        }
        $('trash').classList.toggle('hot', !!(over && over.closest('#trash')));
    });

    document.addEventListener('mouseup', function (event) {
        clearTimeout(timers.drag);
        if (!drag) {
            return;
        }
        if (drag.active) {
            suppressClick = true;
            var over = document.elementFromPoint(event.clientX, event.clientY);
            var target = over && over.closest('.rail-item.folder');
            if (over && over.closest('#trash') && !$('trash').hidden) {
                var name = channels[drag.index].name;
                if (drag.from.folderId) {
                    toggleInFolder(drag.from.folderId, drag.index);
                    toast('«' + name + t('» убран из «') + drag.from.name + '»');
                } else {
                    toggleFavourite(drag.index);
                    renderRail();
                    renderGrid();
                    toast('«' + name + t('» убран из избранного'));
                }
            } else if (target) {
                var section = sections[Number(target.dataset.rail)];
                var folder = findFolder(section.folderId);
                if (folder && folder.urls.indexOf(channels[drag.index].url) < 0) {
                    toggleInFolder(folder.id, drag.index);
                    toast(t('Добавлено в «') + folder.name + '»');
                } else if (folder) {
                    toast(t('Уже в «') + folder.name + '»');
                }
            }
            $('ghost').hidden = true;
            $('trash').hidden = true;
            $('trash').classList.remove('hot');
            document.body.classList.remove('dragging');
        }
        drag = null;
    });

    // ---------- PIN ----------

    var pin = { mode: 'check', value: '', first: '', done: null, back: 'settings' };
    var pinInput = $('pin-input');

    function openPin(mode, title, text, done) {
        pin = { mode: mode, value: '', first: '', done: done, back: screen };
        screen = 'pin';
        $('pin').hidden = false;
        $('pin-title').textContent = title;
        $('pin-text').textContent = text;
        pinInput.value = '';
        renderPin();
        setHints($('pin-hints'), [[['0–9'], t('Цифры')], [['OK'], t('Клавиатура')], [['back'], t('Стереть / отмена')]]);
    }

    var pinThen = null;   // runs once a new PIN is saved

    function setNewPin() {
        openPin('new', t('Новый PIN'), t('Придумайте 4 цифры'), null);
    }

    function renderPin(error) {
        var dots = $('pin-dots');
        dots.classList.toggle('error', !!error);
        Array.prototype.forEach.call(dots.children, function (dot, i) {
            dot.classList.toggle('filled', i < pin.value.length);
        });
    }

    function closePin() {
        pinInput.blur();
        $('pin').hidden = true;
        if (pin.back === 'home') {
            screen = 'home';
        } else {
            showScreen(pin.back);
        }
    }

    function pinDigit(digit) {
        if (pin.value.length >= 4) {
            return;
        }
        pin.value += digit;
        renderPin();
        if (pin.value.length === 4) {
            setTimeout(finishPin, 150);
        }
    }

    function finishPin() {
        var entered = pin.value;
        if (pin.mode === 'check') {
            if (entered === read(STORE.settings, {}).pin) {
                var done = pin.done;
                closePin();
                if (done) {
                    done();
                }
            } else {
                pin.value = '';
                renderPin(true);
                $('pin-text').textContent = t('Неверный PIN, попробуйте ещё раз');
            }
        } else if (pin.mode === 'new') {
            pin = { mode: 'repeat', value: '', first: entered, done: null, back: pin.back };
            $('pin-title').textContent = t('Повторите PIN');
            $('pin-text').textContent = t('Ещё раз те же 4 цифры');
            renderPin();
        } else if (entered === pin.first) {
            var values = read(STORE.settings, {});
            values.pin = entered;
            write(STORE.settings, values);
            adultUnlocked = true;
            closePin();
            if (pinThen) {
                pinThen();
                pinThen = null;
            }
            toast(t('PIN сохранён. 18+ будет закрыто при каждом запуске'));
            settingsChanged = true;
            openSettings(true);
        } else {
            pin = { mode: 'new', value: '', first: '', done: null, back: pin.back };
            $('pin-title').textContent = t('Новый PIN');
            $('pin-text').textContent = t('Не совпало. Придумайте 4 цифры заново');
            renderPin(true);
        }
    }

    pinInput.addEventListener('input', function () {
        var digits = pinInput.value.replace(/\D/g, '');
        pinInput.value = '';
        digits.split('').forEach(pinDigit);
    });

    function handlePinKey(code) {
        if (code >= 48 && code <= 57) {
            pinDigit(String(code - 48));
        } else if (code === KEY.OK) {
            pinInput.focus();
        } else if (code === KEY.BACK) {
            if (document.activeElement === pinInput) {
                pinInput.blur();
            } else if (pin.value) {
                pin.value = pin.value.slice(0, -1);
                renderPin();
            } else {
                closePin();
            }
        } else {
            return false;
        }
        return true;
    }

    // ---------- Settings ----------

    var settingsFocus = 0;
    var settingsChanged = false;

    function openSettings(keepState) {
        if (!keepState) {
            settingsFocus = 0;
            settingsChanged = false;
        }
        showScreen('settings');
        renderSettings();
        setHints($('settings-hints'), [
            [['updown'], t('Выбор')],
            [['OK'], t('Включить / выключить')],
            [['leftright'], t('Тема')],
            [['back'], t('Готово')]
        ]);
    }

    function renderSettings() {
        settingsFocus = Math.min(settingsFocus, visibleSettings().length - 1);
        var values = read(STORE.settings, {});
        var list = $('settings-list');
        list.innerHTML = '';
        visibleSettings().forEach(function (item, index) {
            var row = el('li', index === settingsFocus ? 'focused' : '');
            row.dataset.setting = index;
            var text = el('div', 'setting-text');
            text.appendChild(el('strong', '', item.title));
            text.appendChild(el('span', '', item.id === 'backup' && lastBackup
                ? item.text + t(' Последняя копия: ') + new Date(lastBackup).toLocaleString() + '.' : item.text));
            row.appendChild(text);
            if (item.kind === 'link') {
                row.appendChild(el('span', 'choice-arrow', '›'));
            } else if (item.kind === 'choice') {
                var chosen = choiceIndex(item, values);
                var choice = el('div', 'choice');
                choice.appendChild(el('span', 'choice-arrow', '‹'));
                choice.appendChild(el('span', 'choice-value', item.options[chosen].name));
                choice.appendChild(el('span', 'choice-arrow', '›'));
                if (item.session && sleepAt) {
                    choice.appendChild(el('span', 'choice-arrow', '· ' + Math.ceil((sleepAt - Date.now()) / 60000) + t(' мин')));
                }
                var swatches = el('span', 'swatches');
                item.options[chosen].colours.forEach(function (colour) {
                    var dot = el('span', 'swatch');
                    dot.style.background = colour;
                    swatches.appendChild(dot);
                });
                choice.appendChild(swatches);
                row.appendChild(choice);
            } else {
                row.appendChild(el('span', 'switch' + (values[item.id] === true ? ' on' : '')));
            }
            list.appendChild(row);
        });
        var focusedRow = list.children[settingsFocus];
        if (focusedRow) {
            focusedRow.scrollIntoView({ block: 'nearest' });
        }
    }

    function choiceIndex(item, values) {
        var value = item.session ? sleepChoice : values[item.id];
        var at = 0;
        item.options.forEach(function (option, i) {
            if (option.id === value) {
                at = i;
            }
        });
        return at;
    }

    function setSleep(choice) {
        sleepChoice = choice;
        clearTimeout(timers.sleep);
        if (choice === 'off') {
            sleepAt = 0;
            return;
        }
        var minutes = Number(choice);
        sleepAt = Date.now() + minutes * 60000;
        restartTimer('sleep', minutes * 60000, function () {
            video.pause();
            sleepChoice = 'off';
            sleepAt = 0;
            showScreen('player');
            showStatus(t('Таймер сна: просмотр остановлен. OK — открыть меню.'));
        });
        toast(t('Таймер сна: ') + SLEEP_OPTIONS.filter(function (o) { return o.id === choice; })[0].name);
    }

    function toggleSetting(index, direction) {
        var values = read(STORE.settings, {});
        var item = visibleSettings()[index];
        var id = item.id;
        if (item.kind === 'link') {
            if (direction) {
                return;
            }
            if (id === 'playlists') {
                openSources();
            } else if (id === 'groups') {
                openGroups();
            } else if (id === 'backup') {
                restoreBackup();
            } else if (id === 'pinSet') {
                setNewPin();
            } else if (id === 'pinChange') {
                openPin('check', t('Сменить PIN'), t('Введите текущий PIN'), setNewPin);
            } else if (id === 'pinRemove') {
                openPin('check', t('Убрать PIN'), t('Введите текущий PIN'), function () {
                    var current = read(STORE.settings, {});
                    delete current.pin;
                    write(STORE.settings, current);
                    toast(t('PIN убран'));
                    settingsChanged = true;
                    openSettings(true);
                });
            }
            return;
        }
        // With a PIN, turning 18+ on needs it.
        if (id === 'adult' && values.adult !== true && !pinSet()) {
            toast(t('Сначала задайте PIN: без него 18+ не включается'));
            pinThen = function () {
                var v = read(STORE.settings, {});
                v.adult = true;
                write(STORE.settings, v);
                settingsChanged = true;
                PRESETS.forEach(function (preset) {
                    var saved = read(STORE.sources, []);
                    if (preset.adult && !saved.some(function (x) { return x.url === preset.url; })) {
                        saved.push({ name: preset.name, url: preset.url });
                        write(STORE.sources, saved);
                    }
                });
            };
            setNewPin();
            return;
        }
        if (id === 'adult' && values.adult !== true && pinSet() && !adultUnlocked) {
            openPin('check', t('Показывать 18+'), t('Введите PIN-код'), function () {
                adultUnlocked = true;
                showScreen('settings');
                toggleSetting(index);
            });
            return;
        }
        if (item.kind === 'choice') {
            var size = item.options.length;
            var next = item.options[(choiceIndex(item, values) + (direction || 1) + size) % size].id;
            if (item.session) {
                setSleep(next);
            } else {
                values[id] = next;
                write(STORE.settings, values);
                applyTheme();
                if (id === 'lang') {
                    // Constants are already translated, so a restart applies the new language everywhere.
                    saveBackup();
                    setTimeout(function () { window.location.reload(); }, 400);
                    return;
                }
            }
            renderSettings();
            return;
        }
        if (direction) {
            return;   // ← → only change choices
        }
        values[id] = values[id] !== true;
        // Turning 18+ on also adds its ready playlist, so the films appear right away.
        if (id === 'adult' && values[id]) {
            var saved = read(STORE.sources, []);
            PRESETS.forEach(function (preset) {
                if (preset.adult && !saved.some(function (s) { return s.url === preset.url; })) {
                    saved.push({ name: preset.name, url: preset.url });
                }
            });
            write(STORE.sources, saved);
        }
        write(STORE.settings, values);
        settingsChanged = settingsChanged || id === 'adult' || id === 'hideDead';
        renderSettings();
    }

    function handleSettingsKey(code) {
        if (code === KEY.UP || code === KEY.DOWN) {
            settingsFocus = (settingsFocus + (code === KEY.UP ? -1 : 1) + visibleSettings().length) % visibleSettings().length;
            renderSettings();
        } else if (code === KEY.OK) {
            toggleSetting(settingsFocus);
        } else if (code === KEY.LEFT || code === KEY.RIGHT) {
            toggleSetting(settingsFocus, code === KEY.LEFT ? -1 : 1);
        } else if (code === KEY.BACK) {
            // Showing or hiding 18+ changes the channel list, so reload it.
            if (settingsChanged) {
                loadPlaylists();
            } else {
                openHome();
            }
        } else {
            return false;
        }
        return true;
    }

    // ---------- Help ----------

    var HELP = [
        [['OK'], t('Меню или пауза'), t('На канале открывает главный экран, в фильме — пауза; в меню включает')],
        [['up', 'down'], t('Информация о канале'), t('В меню — движение по плиткам и разделам')],
        [['left', 'right'], t('Перемотка фильма'), t('10 с, при частых нажатиях 1 и 5 минут; в меню — плитки')],
        [['CH+', 'CH−'], t('Переключить канал'), t('В меню листает на целую страницу')],
        [['0–9'], t('Номер канала'), t('Наберите номер, переключение через 1,5 секунды')],
        [['play', 'pause'], t('Пауза и продолжение'), t('Для фильмов')],
        [['red'], t('Избранное'), t('Добавить или убрать канал')],
        [['green'], t('Плейлисты'), t('Добавить ссылку, готовый плейлист или страну')],
        [['yellow'], t('Папки / предыдущий'), t('На плитке — в папку; на папке — переименовать или удалить; при просмотре — прошлый канал')],
        [['blue'], t('Настройки / дорожки'), t('В меню — настройки; при просмотре — звук и субтитры, если их несколько')],
        [['INFO'], t('Справка и информация'), t('Эта страница; во время просмотра — данные канала')],
        [['back'], t('Назад'), t('На главном экране предлагает выйти')],
        [['OK'], t('Долгое нажатие OK'), t('В папке — убрать канал (жёлтая кнопка вернёт); в других разделах — «В папку»')],
        [['Magic Remote'], t('Перетаскивание'), t('Зажмите плитку: на папку слева — положить, в корзину — убрать из папки')],
        [['Magic Remote'], t('Указка'), t('Наведите и нажмите колесо; колесо листает меню. Каналы — в Настройках')]
    ];

    function openHelp() {
        dialogReturn = screen === 'help' ? dialogReturn : screen;
        showScreen('help');
        $('help-grid').innerHTML = HELP.map(function (row) {
            return '<div class="help-row"><div class="help-keys">' + row[0].map(key).join('') +
                '</div><div class="help-text"><strong>' + row[1] + '</strong><span>' + row[2] + '</span></div></div>';
        }).join('');
        setHints($('help-hints'), [[['back'], t('Закрыть')]]);
    }

    function closeHelp() {
        if (dialogReturn === 'player') {
            showScreen('player');
        } else {
            openHome();
        }
    }

    // ---------- Exit dialog ----------

    var dialogFocus = 1;

    function openDialog(from) {
        dialogReturn = from;
        dialogFocus = 1;
        showScreen('dialog');
        if (from === 'home') {
            $('home').hidden = false;
        }
        markDialog();
    }

    function markDialog() {
        $('dialog-exit').classList.toggle('focused', dialogFocus === 0);
        $('dialog-stay').classList.toggle('focused', dialogFocus === 1);
    }

    function closeDialog() {
        if (dialogReturn === 'sources') {
            showScreen('sources');
        } else {
            showScreen('home');
        }
    }

    function handleDialogKey(code) {
        if (code === KEY.LEFT || code === KEY.RIGHT) {
            dialogFocus = code === KEY.LEFT ? 0 : 1;
            markDialog();
        } else if (code === KEY.OK) {
            if (dialogFocus === 0) {
                window.close();
            } else {
                closeDialog();
            }
        } else if (code === KEY.BACK) {
            closeDialog();
        } else {
            return false;
        }
        return true;
    }

    // ---------- Number entry ----------

    function typeDigit(digit) {
        digits = (digits + digit).slice(0, 4);
        $('digits').textContent = digits;
        $('digits').hidden = false;
        restartTimer('digits', DIGIT_TIMEOUT, function () {
            var number = parseInt(digits, 10);
            digits = '';
            $('digits').hidden = true;
            if (number >= 1 && number <= channels.length) {
                play(number - 1, allIndexes(function (c) { return c.film === channels[number - 1].film; }));
                showScreen('player');
                showOsd();
            }
        });
    }

    // ---------- Player keys ----------

    function handlePlayerKey(code) {
        var film = current >= 0 && channels[current].film;
        if (statusBox.dataset.retry && code === KEY.OK) {
            loadPlaylists();
        } else if (film && code === KEY.OK) {
            togglePause();
        } else if (film && (code === KEY.UP || code === KEY.DOWN)) {
            showOsd();
        } else if (film && (code === KEY.LEFT || code === KEY.REWIND)) {
            seek(-1);
        } else if (film && (code === KEY.RIGHT || code === KEY.FAST_FORWARD)) {
            seek(1);
        } else if (code === KEY.OK) {
            openHome();
        } else if (code === KEY.CH_UP) {
            step(1);
        } else if (code === KEY.CH_DOWN) {
            step(-1);
        } else if (code === KEY.UP || code === KEY.DOWN) {
            showOsd();
        } else if (code === KEY.PLAY || code === KEY.PAUSE || code === KEY.PLAY_PAUSE) {
            togglePause(code === KEY.PLAY ? true : code === KEY.PAUSE ? false : undefined);
        } else if (code === KEY.STOP) {
            video.pause();
            showOsd();
        } else if (code === KEY.RED) {
            toggleFavourite(current);
            showOsd();
        } else if (code === KEY.LEFT || code === KEY.RIGHT || code === KEY.INFO) {
            showOsd();
        } else if (code === KEY.BACK) {
            if (!osd.hidden && !film) {
                osd.hidden = true;
            } else {
                openHome();
            }
        } else {
            return false;
        }
        return true;
    }

    // ---------- Remote ----------

    // Long OK on a tile: out of the open folder/favourites (Yellow undoes), elsewhere the folder picker.
    var LONG_PRESS = 800;
    var okHeld = false;
    var undo = null;

    function longPressTile() {
        var section = sections[home.rail];
        var index = section.items[home.tile];
        if (index === undefined) {
            return;
        }
        var name = channels[index].name;
        if (section.folderId) {
            toggleInFolder(section.folderId, index);
            undo = { folderId: section.folderId, index: index };
            toast('«' + name + t('» убран из папки. Жёлтая кнопка — вернуть'));
        } else if (section.id === 'favourites') {
            toggleFavourite(index);
            undo = { favourite: true, index: index };
            renderRail();
            renderGrid();
            toast('«' + name + t('» убран из избранного. Жёлтая кнопка — вернуть'));
        } else {
            openPicker(index);
            return;
        }
        restartTimer('undo', 5000, function () { undo = null; });
    }

    document.addEventListener('keyup', function (event) {
        if (event.keyCode !== KEY.OK || !okHeld) {
            return;
        }
        okHeld = false;
        if (timers.longPress) {
            clearTimeout(timers.longPress);
            timers.longPress = null;
            chooseInHome();
        }
    });

    document.addEventListener('keydown', function (event) {
        var code = event.keyCode;
        // In the tile grid OK acts on release, so a long press can mean something else.
        if (code === KEY.OK && screen === 'home' && home.area === 'grid') {
            event.preventDefault();
            if (!event.repeat && !okHeld) {
                okHeld = true;
                timers.longPress = setTimeout(function () {
                    timers.longPress = null;
                    longPressTile();
                }, LONG_PRESS);
            }
            return;
        }
        if (code === KEY.YELLOW && undo && screen === 'home') {
            if (undo.folderId) {
                toggleInFolder(undo.folderId, undo.index);
            } else {
                toggleFavourite(undo.index);
                renderRail();
                renderGrid();
            }
            toast(t('Вернул'));
            undo = null;
            event.preventDefault();
            return;
        }
        if (autoMuted) {
            video.muted = false;
            autoMuted = false;
        }

        var handled = false;
        if (screen === 'sources') {
            handled = handleSourcesKey(code);
        } else if (screen === 'dialog') {
            handled = handleDialogKey(code);
        } else if (screen === 'settings') {
            handled = handleSettingsKey(code);
        } else if (screen === 'pin') {
            handled = handlePinKey(code);
        } else if (screen === 'picker') {
            handled = handlePickerKey(code);
        } else if (screen === 'prompt') {
            handled = handlePromptKey(code);
        } else if (screen === 'help') {
            if (code === KEY.BACK || code === KEY.OK || code === KEY.INFO) {
                closeHelp();
                handled = true;
            }
        } else if (code >= 48 && code <= 57) {
            typeDigit(String(code - 48));
            handled = true;
        } else if (code === KEY.GREEN) {
            openSources();
            handled = true;
        } else if (code === KEY.BLUE && screen === 'player' && hasTracks()) {
            openTracks();
            handled = true;
        } else if (code === KEY.BLUE) {
            openSettings();
            handled = true;
        } else if (code === KEY.YELLOW && screen === 'home') {
            homeYellow();
            handled = true;
        } else if (code === KEY.YELLOW && previous >= 0) {
            play(previous);
            showScreen('player');
            showOsd();
            handled = true;
        } else if (screen === 'home') {
            if (code === KEY.INFO) {
                openHelp();
                handled = true;
            } else if (code === KEY.BACK) {
                openDialog('home');
                handled = true;
            } else {
                handled = handleHomeKey(code);
            }
        } else {
            handled = handlePlayerKey(code);
        }
        if (handled) {
            event.preventDefault();
        }
    });

    // ---------- Magic Remote (pointer and wheel) ----------

    document.addEventListener('mouseover', function (event) {
        var target = event.target.closest('[data-tile],[data-rail],[data-col],[data-cat],[data-action]');
        if (!target) {
            return;
        }
        if (target.dataset.tile !== undefined && screen === 'home') {
            home.area = 'grid';
            home.tile = Number(target.dataset.tile);
            markRail();
            Array.prototype.forEach.call(grid.children, function (tile) {
                tile.classList.toggle('focused', tile === target);
            });
            updateHomeHints();
        } else if (target.dataset.action !== undefined && screen === 'dialog') {
            dialogFocus = target.dataset.action === 'exit' ? 0 : 1;
            markDialog();
        }
    });

    document.addEventListener('click', function (event) {
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        if (screen === 'picker') {
            var pick = event.target.closest('[data-pick]');
            if (pick) {
                picker.focus = Number(pick.dataset.pick);
                choosePicker();
            }
            return;
        }
        if (screen === 'prompt') {
            var action = event.target.closest('[data-prompt]');
            if (event.target === promptInput) {
                promptState.focus = 0;
                markPrompt();
            } else if (action) {
                if (action.dataset.prompt === 'create') {
                    createFolder();
                } else {
                    closePrompt();
                }
            }
            return;
        }
        if (autoMuted) {
            video.muted = false;
            autoMuted = false;
        }
        var target = event.target.closest('[data-tile],[data-rail],[data-col],[data-cat],[data-action]');
        if (screen === 'player') {
            openHome();
        } else if (screen === 'help') {
            closeHelp();
        } else if (screen === 'settings') {
            var row = event.target.closest('[data-setting]');
            if (row) {
                settingsFocus = Number(row.dataset.setting);
                toggleSetting(settingsFocus);
            }
        } else if (!target) {
            return;
        } else if (screen === 'home') {
            if (target.dataset.rail !== undefined) {
                home.area = 'rail';
                home.rail = Number(target.dataset.rail);
                home.tile = 0;
                home.topRow = 0;
                markRail();
                renderGrid();
                updateHomeHints();
                if (sections[home.rail].kind === 'action') {
                    sections[home.rail].action();
                }
            } else if (target.dataset.tile !== undefined) {
                home.area = 'grid';
                home.tile = Number(target.dataset.tile);
                chooseInHome();
            }
        } else if (screen === 'sources' && target.dataset.cat !== undefined) {
            catalogFocus = Number(target.dataset.cat);
            handleCatalogKey(KEY.OK);
        } else if (screen === 'sources' && target.dataset.col !== undefined) {
            sourcesFocus = { col: target.dataset.col, row: Number(target.dataset.row) };
            activateSourceRow();
        } else if (screen === 'dialog') {
            handleDialogKey(KEY.OK);
        }
    });

    document.addEventListener('wheel', function (event) {
        var down = event.deltaY > 0;
        if (screen === 'home') {
            if (home.area === 'rail') {
                moveRail(down ? 1 : -1);
            } else {
                moveTile(down ? GRID.cols : -GRID.cols);
            }
        } else if (screen === 'sources') {
            if (sourcesScreen.classList.contains('catalog-mode')) {
                moveCatalog(down ? 1 : -1);
            } else {
                moveSources(down ? 1 : -1);
            }
        } else if (screen === 'player' && setting('wheelZap')) {
            step(down ? -1 : 1);
        }
        event.preventDefault();
    }, { passive: false });

    // ---------- webOS lifecycle ----------

    // Stop streaming while the app is in the background and resume on return.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            video.pause();
            if (hls) {
                hls.stopLoad();
            }
        } else if (current >= 0) {
            if (hls) {
                hls.startLoad();
            }
            startVideo();
        }
    });

    document.addEventListener('webOSRelaunch', function () {
        if (screen === 'player' && current >= 0) {
            showOsd();
        }
    });

    // Static texts of index.html carry data-t; their Russian text is the key.
    Array.prototype.forEach.call(document.querySelectorAll('[data-t]'), function (node) {
        node.textContent = t(node.textContent);
    });
    document.documentElement.lang = LANG;

    restoreIfEmpty(function () {
        applyTheme();
        loadPlaylists();
    });
}());
