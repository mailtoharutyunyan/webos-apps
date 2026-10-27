// Alik: an IPTV and film player built for the LG TV remote.
// The TV browser is Chromium 79, so no optional chaining or `??`.
(function () {
    'use strict';

    // Checked daily in the webos-apps repository: only streams that answer stay in.
    var PRESETS = [
        { name: 'Армения', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/armenia.m3u' },
        { name: 'Россия', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/russia.m3u' },
        { name: 'Фильмы со всего мира', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/movies.m3u' },
        { name: 'Классика кино (Internet Archive)', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/archive-films.m3u' },
        { name: '18+ · винтажное кино (Internet Archive)', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/archive-films-18.m3u', adult: true }
    ];
    var CATALOG_URL = 'https://iptv-org.github.io/api/countries.json';
    var CATALOG_PINNED = ['AM', 'RU'];

    var STORE = { last: 'alik.lastChannel', sources: 'alik.sources', favourites: 'alik.favourites', recent: 'alik.recent', settings: 'alik.settings' };
    var ADULT_GROUP = /18\+|adult|xxx/i;

    var THEMES = [
        { id: 'apricot', name: 'Абрикос', colours: ['#0f1420', '#f39c4a'] },
        { id: 'pomegranate', name: 'Гранат', colours: ['#170f15', '#e0475b'] },
        { id: 'sevan', name: 'Севан', colours: ['#0b1719', '#3cc6b4'] },
        { id: 'ararat', name: 'Арарат', colours: ['#eef1f5', '#d9742b'] }
    ];

    var SETTINGS = [
        { id: 'playlists', kind: 'link', title: 'Плейлисты и каталоги', text: 'Добавить ссылку M3U, готовый плейлист или страну из iptv-org. OK — открыть.' },
        { id: 'theme', kind: 'choice', title: 'Тема', text: 'Цвета Alik. ← → или OK — сменить.', options: THEMES },
        { id: 'adult', title: 'Показывать 18+', text: 'Включено — добавляется плейлист 18+ и группа «Films 18+». Выключено — скрыто.' },
        { id: 'wheelZap', title: 'Колесо Magic Remote переключает каналы', text: 'Во время просмотра. Выключено — только CH+ и CH−.' }
    ];

    function setting(id) {
        return read(STORE.settings, {})[id] === true;
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
                    group: attr(line, 'group-title') || 'Другое',
                    logo: attr(line, 'tvg-logo')
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
                    throw new Error('сервер ответил ' + response.status);
                }
                return response.text();
            })
            .then(function (text) {
                var list = parseM3u(text);
                if (!list.length) {
                    throw new Error('в нём нет каналов');
                }
                return { source: source, channels: list };
            }, function (err) {
                return { source: source, error: err.message || 'нет связи' };
            });
    }

    function loadPlaylists() {
        var sources = read(STORE.sources, []);
        if (!sources.length) {
            stopPlayback();
            openSources();
            return;
        }
        showScreen('player');
        showStatus('Загружаю список каналов…');
        Promise.all(sources.map(fetchSource)).then(function (results) {
            var failed = [];
            channels = [];
            results.forEach(function (result) {
                if (result.error) {
                    failed.push('«' + result.source.name + '»: ' + result.error);
                } else {
                    result.channels.forEach(function (channel) { channel.source = result.source.name; });
                    channels = channels.concat(result.channels);
                }
            });
            if (!setting('adult')) {
                channels = channels.filter(function (channel) { return !ADULT_GROUP.test(channel.group); });
            }
            channels.forEach(function (channel, index) { channel.number = index + 1; });
            if (!channels.length) {
                showStatus('Не удалось загрузить плейлисты. ' + failed.join('; ') +
                    '. OK — повторить, зелёная кнопка — изменить плейлисты.');
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
                showStatus('Не загрузились: ' + failed.join('; ') + '.');
                restartTimer('status', 6000, hideStatus);
            }
            openHome();
        });
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
            { kind: 'list', id: 'favourites', name: 'Избранное', icon: 'star', items: indexesForUrls(read(STORE.favourites, [])) },
            { kind: 'list', id: 'recent', name: 'Недавние', icon: 'clock', items: indexesForUrls(read(STORE.recent, [])) }
        ];
        if (live.length) {
            sections.push({ kind: 'list', id: 'live', name: 'Все каналы', icon: 'tv', items: live });
        }
        if (films.length) {
            sections.push({ kind: 'list', id: 'films', name: 'Все фильмы', icon: 'film', items: films });
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
            sections.push({ kind: 'heading', name: 'Мои плейлисты' });
            sections = sections.concat(playlists);
        }
        sections.push({ kind: 'heading', name: 'Группы' });
        var byGroup = {};
        var groups = [];
        channels.forEach(function (channel, index) {
            if (!byGroup[channel.group]) {
                byGroup[channel.group] = { kind: 'list', id: 'group:' + channel.group, name: channel.group, icon: 'folder', items: [] };
                groups.push(byGroup[channel.group]);
            }
            byGroup[channel.group].items.push(index);
        });
        sections = sections.concat(groups);
        sections.push({ kind: 'heading', name: 'Приложение' });
        sections.push({ kind: 'action', name: 'Плейлисты', icon: 'list', action: openSources });
        sections.push({ kind: 'action', name: 'Настройки', icon: 'gear', action: openSettings });
        sections.push({ kind: 'action', name: 'Справка по пульту', icon: 'help', action: openHelp });
    }

    function refreshPersonalSections() {
        sections.forEach(function (section) {
            if (section.id === 'favourites') {
                section.items = indexesForUrls(read(STORE.favourites, []));
            } else if (section.id === 'recent') {
                section.items = indexesForUrls(read(STORE.recent, []));
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
        showStatus(channel.film ? 'Загружаю фильм…' : 'Подключаюсь к каналу…');

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
        showStatus('Канал сейчас не отвечает. Переключите кнопками CH+ CH−.');
    }

    video.addEventListener('playing', hideStatus);
    video.addEventListener('timeupdate', function () {
        if (video.currentTime > 0 && !statusBox.dataset.retry) {
            hideStatus();
        }
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
        $('osd-step').textContent = (direction > 0 ? '+' : '−') + (stepSeconds >= 60 ? stepSeconds / 60 + ' мин' : stepSeconds + ' с');
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
        updateProgress();
        $('osd-state').innerHTML = channel.film ? svg(video.paused ? 'play' : 'pause') : '';
        $('osd-state').hidden = !channel.film;
        setHints($('osd-hints'), channel.film ? [
            [['OK'], video.paused ? 'Продолжить' : 'Пауза'],
            [['leftright'], 'Перемотка (чаще — быстрее)'],
            [['CH+', 'CH−'], 'Другой фильм'],
            [['red'], isFavourite(current) ? 'Убрать из избранного' : 'В избранное'],
            [['back'], 'Меню']
        ] : [
            [['OK'], 'Меню'],
            [['CH+', 'CH−'], 'Канал'],
            [['0–9'], 'Номер'],
            [['red'], isFavourite(current) ? 'Убрать из избранного' : 'В избранное'],
            [['yellow'], 'Предыдущий'],
            [['back'], 'Назад']
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
            ' · осталось ' + clockText(video.duration - video.currentTime);
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
            target = 2;
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
                item = el('li', 'rail-item');
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
                ? 'Здесь будут избранные каналы. На любом канале нажмите красную кнопку.'
                : section && section.id === 'recent' ? 'Здесь появятся каналы, которые вы смотрели.'
                    : section && section.kind === 'action' ? 'Нажмите OK, чтобы открыть.' : '';
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
            var tile = el('div', 'tile' + (channel.film ? ' film' : '') + (position === home.tile && home.area === 'grid' ? ' focused' : ''));
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
                tile.appendChild(el('span', 'tile-playing', 'Сейчас'));
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
        if (next < 0 || next >= sections.length || next === home.rail) {
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
            [['OK'], 'Смотреть'],
            [['red'], 'Избранное'],
            [['green'], 'Плейлисты'],
            [['yellow'], 'Предыдущий'],
            [['blue'], 'Настройки'],
            [['CH+', 'CH−'], 'Страница'],
            [['INFO'], 'Справка'],
            [['back'], 'Выход']
        ] : [
            [['updown'], 'Раздел'],
            [['right'], 'К каналам'],
            [['OK'], 'Открыть'],
            [['green'], 'Плейлисты'],
            [['INFO'], 'Справка'],
            [['back'], 'Выход']
        ]);
    }

    function tickClock() {
        var now = new Date();
        $('clock').textContent = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    }

    setInterval(function () {
        if (screen === 'home') {
            tickClock();
        }
    }, 30000);

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
        var right = [{ kind: 'heading', text: 'Готовые плейлисты' }];
        PRESETS.filter(function (preset) { return !preset.adult || setting('adult'); }).forEach(function (preset) {
            right.push({ kind: 'preset', preset: preset, added: saved.some(function (s) { return s.url === preset.url; }) });
        });
        right.push({ kind: 'catalog' });
        right.push({ kind: 'heading', text: saved.length ? 'Ваши плейлисты · ' + saved.length : 'Ваши плейлисты: пока нет' });
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
                    item = el('li', 'button', 'Добавить ссылку');
                } else if (row.kind === 'catalog') {
                    item = el('li', 'button', 'Каталог iptv-org: выбрать страну');
                } else if (row.kind === 'done') {
                    item = el('li', 'button primary', 'Смотреть');
                } else if (row.kind === 'preset') {
                    item = el('li', 'preset');
                    item.appendChild(el('span', 'source-name', row.preset.name));
                    item.appendChild(el('span', 'source-action', row.added ? 'Добавлен ✓' : 'Добавить'));
                } else {
                    item = el('li', 'source');
                    item.appendChild(el('span', 'source-name', row.source.name));
                    item.appendChild(el('span', 'source-action', pendingRemoval === row.index ? 'OK ещё раз — удалить' : 'Удалить'));
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
            [['updown', 'leftright'], 'Выбор'],
            [['OK'], 'Открыть'],
            [['back'], read(STORE.sources, []).length ? 'Готово' : 'Выход']
        ]);
    }

    function addSource(source) {
        var saved = read(STORE.sources, []);
        if (saved.some(function (s) { return s.url === source.url; })) {
            notice.textContent = 'Этот плейлист уже добавлен.';
            return;
        }
        saved.push(source);
        write(STORE.sources, saved);
        notice.textContent = 'Добавлен: ' + source.name + '.';
        sourcesUrl.value = '';
        renderSources();
    }

    function addTypedUrl() {
        var url = sourcesUrl.value.trim();
        if (!/^https?:\/\/\S+$/i.test(url)) {
            notice.textContent = 'Ссылка должна начинаться с http:// или https://';
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
                notice.textContent = '«' + row.preset.name + '» уже добавлен. Удалить можно ниже.';
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
            notice.textContent = 'Плейлист удалён.';
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
        notice.textContent = 'Загружаю список стран…';
        var ready = countries ? Promise.resolve(countries) : fetch(CATALOG_URL)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('сервер ответил ' + response.status);
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
                [['updown'], 'Страна'],
                [['CH+', 'CH−'], 'Быстрее'],
                [['OK'], 'Добавить'],
                [['back'], 'Назад']
            ]);
        }, function (err) {
            notice.textContent = 'Каталог недоступен: ' + err.message + '.';
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

    // ---------- Settings ----------

    var settingsFocus = 0;
    var settingsChanged = false;

    function openSettings() {
        settingsFocus = 0;
        settingsChanged = false;
        showScreen('settings');
        renderSettings();
        setHints($('settings-hints'), [
            [['updown'], 'Выбор'],
            [['OK'], 'Включить / выключить'],
            [['leftright'], 'Тема'],
            [['back'], 'Готово']
        ]);
    }

    function renderSettings() {
        var values = read(STORE.settings, {});
        var list = $('settings-list');
        list.innerHTML = '';
        SETTINGS.forEach(function (item, index) {
            var row = el('li', index === settingsFocus ? 'focused' : '');
            row.dataset.setting = index;
            var text = el('div', 'setting-text');
            text.appendChild(el('strong', '', item.title));
            text.appendChild(el('span', '', item.text));
            row.appendChild(text);
            if (item.kind === 'link') {
                row.appendChild(el('span', 'choice-arrow', '›'));
            } else if (item.kind === 'choice') {
                var chosen = choiceIndex(item, values);
                var choice = el('div', 'choice');
                choice.appendChild(el('span', 'choice-arrow', '‹'));
                choice.appendChild(el('span', 'choice-value', item.options[chosen].name));
                choice.appendChild(el('span', 'choice-arrow', '›'));
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
    }

    function choiceIndex(item, values) {
        var at = 0;
        item.options.forEach(function (option, i) {
            if (option.id === values[item.id]) {
                at = i;
            }
        });
        return at;
    }

    function toggleSetting(index, direction) {
        var values = read(STORE.settings, {});
        var item = SETTINGS[index];
        var id = item.id;
        if (item.kind === 'link') {
            if (!direction) {
                openSources();
            }
            return;
        }
        if (item.kind === 'choice') {
            var size = item.options.length;
            values[id] = item.options[(choiceIndex(item, values) + (direction || 1) + size) % size].id;
            write(STORE.settings, values);
            applyTheme();
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
        settingsChanged = settingsChanged || id === 'adult';
        renderSettings();
    }

    function handleSettingsKey(code) {
        if (code === KEY.UP || code === KEY.DOWN) {
            settingsFocus = (settingsFocus + (code === KEY.UP ? -1 : 1) + SETTINGS.length) % SETTINGS.length;
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
        [['OK'], 'Меню или пауза', 'На канале открывает главный экран, в фильме — пауза; в меню включает'],
        [['up', 'down'], 'Информация о канале', 'В меню — движение по плиткам и разделам'],
        [['left', 'right'], 'Перемотка фильма', '10 с, при частых нажатиях 1 и 5 минут; в меню — плитки'],
        [['CH+', 'CH−'], 'Переключить канал', 'В меню листает на целую страницу'],
        [['0–9'], 'Номер канала', 'Наберите номер, переключение через 1,5 секунды'],
        [['play', 'pause'], 'Пауза и продолжение', 'Для фильмов'],
        [['red'], 'Избранное', 'Добавить или убрать канал'],
        [['green'], 'Плейлисты', 'Добавить ссылку, готовый плейлист или страну'],
        [['yellow'], 'Предыдущий канал', 'Быстро вернуться к прошлому каналу'],
        [['blue'], 'Настройки', 'Тема, 18+, колесо Magic Remote'],
        [['INFO'], 'Справка и информация', 'Эта страница; во время просмотра — данные канала'],
        [['back'], 'Назад', 'На главном экране предлагает выйти'],
        [['Magic Remote'], 'Указка', 'Наведите и нажмите колесо; колесо листает меню. Каналы — в Настройках']
    ];

    function openHelp() {
        dialogReturn = screen === 'help' ? dialogReturn : screen;
        showScreen('help');
        $('help-grid').innerHTML = HELP.map(function (row) {
            return '<div class="help-row"><div class="help-keys">' + row[0].map(key).join('') +
                '</div><div class="help-text"><strong>' + row[1] + '</strong><span>' + row[2] + '</span></div></div>';
        }).join('');
        setHints($('help-hints'), [[['back'], 'Закрыть']]);
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

    document.addEventListener('keydown', function (event) {
        var code = event.keyCode;
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
        } else if (code === KEY.BLUE) {
            openSettings();
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

    applyTheme();
    loadPlaylists();
}());
