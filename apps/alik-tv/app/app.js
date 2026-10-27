// Alik: a small IPTV player for the LG TV remote.
// The TV browser is Chromium 79, so no optional chaining or `??`.
(function () {
    'use strict';

    // Checked daily in the webos-apps repository: only streams that answer stay in.
    var PRESETS = [
        { name: 'Армения', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/armenia.m3u' },
        { name: 'Россия', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/russia.m3u' },
        { name: 'Фильмы со всего мира', url: 'https://mailtoharutyunyan.github.io/webos-apps/playlists/movies.m3u' }
    ];
    var CATALOG_URL = 'https://iptv-org.github.io/api/countries.json';
    var CATALOG_PINNED = ['AM', 'RU'];
    var STORAGE_KEY = 'alik.lastChannel';
    var SOURCES_KEY = 'alik.sources';
    var MENU_TIMEOUT = 20000;
    var OSD_TIMEOUT = 4000;
    var DIGIT_TIMEOUT = 1500;

    var KEY = {
        OK: 13, BACK: 461, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40,
        CH_UP: 33, CH_DOWN: 34, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, INFO: 457
    };

    var video = document.getElementById('video');
    var statusBox = document.getElementById('status');
    var osd = document.getElementById('osd');
    var osdNumber = document.getElementById('osd-number');
    var osdName = document.getElementById('osd-name');
    var osdGroup = document.getElementById('osd-group');
    var digitsBox = document.getElementById('digits');
    var menu = document.getElementById('menu');
    var clock = document.getElementById('clock');
    var groupList = document.getElementById('groups');
    var channelList = document.getElementById('channels');
    var sourcesScreen = document.getElementById('sources');
    var sourcesList = document.getElementById('source-list');
    var sourcesField = document.getElementById('source-field');
    var sourcesUrl = document.getElementById('source-url');
    var sourcesNotice = document.getElementById('source-notice');
    var catalogList = document.getElementById('catalog-list');

    var channels = [];      // flat, numbered from 1
    var groups = [];        // [{ name, channels: [] }]
    var current = -1;       // index into channels
    var hls = null;

    var menuState = { column: 'channels', group: 0, channel: 0 };
    var timers = {};
    var digits = '';

    // ---- Playlist ----

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
                list.push(info);
                info = null;
            }
        });
        return list;
    }

    function attr(line, name) {
        var match = new RegExp(name + '="([^"]*)"').exec(line);
        return match ? match[1] : '';
    }

    function buildGroups() {
        var byName = {};
        groups = [];
        channels.forEach(function (channel, index) {
            channel.number = index + 1;
            if (!byName[channel.group]) {
                byName[channel.group] = { name: channel.group, channels: [] };
                groups.push(byName[channel.group]);
            }
            byName[channel.group].channels.push(index);
        });
        groups.unshift({ name: 'Все каналы', channels: channels.map(function (c, i) { return i; }) });
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

    // Loads every saved playlist and merges their channels, in the order the playlists were added.
    function loadPlaylists() {
        var sources = readSources();
        if (!sources.length) {
            stopPlayback();
            hideStatus();
            openSources();
            return;
        }
        showStatus('Загружаю список каналов…');
        Promise.all(sources.map(fetchSource)).then(function (results) {
            var failed = [];
            channels = [];
            results.forEach(function (result) {
                if (result.error) {
                    failed.push('«' + result.source.name + '»: ' + result.error);
                } else {
                    channels = channels.concat(result.channels);
                }
            });
            if (!channels.length) {
                showStatus('Не удалось загрузить плейлисты. ' + failed.join('; ') +
                    '. Нажмите OK, чтобы повторить, или Green, чтобы изменить плейлисты.');
                statusBox.dataset.retry = '1';
                return;
            }
            buildGroups();
            var saved = parseInt(readStorage(STORAGE_KEY), 10);
            play(saved >= 0 && saved < channels.length ? saved : 0);
            if (failed.length) {
                showStatus('Не загрузились: ' + failed.join('; ') + '.');
                restartTimer('status', 6000, hideStatus);
            }
        });
    }

    // ---- Playlists screen ----

    function readSources() {
        try {
            var list = JSON.parse(readStorage(SOURCES_KEY) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function saveSources(list) {
        writeStorage(SOURCES_KEY, JSON.stringify(list));
    }

    function nameFromUrl(url) {
        var match = /^https?:\/\/([^\/?#]+)(?:[^?#]*\/)?([^\/?#]*)/.exec(url);
        if (!match) {
            return url;
        }
        var file = decodeURIComponent(match[2] || '').replace(/\.m3u8?$/i, '');
        return file ? match[1] + ' / ' + file : match[1];
    }

    var sourcesFocus = 0;
    var pendingRemoval = -1;

    function openSources() {
        closeMenu();
        osd.hidden = true;
        sourcesNotice.textContent = '';
        sourcesFocus = 0;
        pendingRemoval = -1;
        sourcesScreen.classList.remove('catalog-mode');
        sourcesScreen.hidden = false;
        renderSources();
    }

    function closeSources() {
        sourcesUrl.blur();
        sourcesScreen.hidden = true;
        loadPlaylists();
    }

    // Every row of the screen is one stop for ↑ ↓: the URL field, the buttons and the saved playlists.
    function sourceRows() {
        var sources = readSources();
        var rows = [{ kind: 'input' }, { kind: 'add' }];
        PRESETS.forEach(function (preset) {
            if (!sources.some(function (s) { return s.url === preset.url; })) {
                rows.push({ kind: 'preset', preset: preset });
            }
        });
        rows.push({ kind: 'catalog' });
        sources.forEach(function (source, index) {
            rows.push({ kind: 'source', index: index, source: source });
        });
        if (sources.length) {
            rows.push({ kind: 'done' });
        }
        return rows;
    }

    function renderSources() {
        var rows = sourceRows();
        sourcesFocus = Math.min(sourcesFocus, rows.length - 1);
        sourcesList.innerHTML = '';
        rows.forEach(function (row, position) {
            var item;
            if (row.kind === 'input') {
                item = sourcesField;
            } else {
                item = document.createElement('li');
                if (row.kind === 'add') {
                    item.className = 'button';
                    item.textContent = 'Добавить ссылку';
                } else if (row.kind === 'preset') {
                    item.className = 'button';
                    item.textContent = 'Добавить готовый: ' + row.preset.name;
                } else if (row.kind === 'catalog') {
                    item.className = 'button';
                    item.textContent = 'Каталог iptv-org: выбрать страну';
                } else if (row.kind === 'done') {
                    item.className = 'button primary';
                    item.textContent = 'Смотреть';
                } else {
                    item.className = 'source';
                    var title = document.createElement('span');
                    title.className = 'source-name';
                    title.textContent = row.source.name;
                    var hint = document.createElement('span');
                    hint.className = 'source-action';
                    hint.textContent = pendingRemoval === row.index ? 'OK ещё раз — удалить' : 'Удалить';
                    item.appendChild(title);
                    item.appendChild(hint);
                }
            }
            item.classList.toggle('focused', position === sourcesFocus);
            sourcesList.appendChild(item);
        });
        var focused = sourcesList.children[sourcesFocus];
        if (focused) {
            focused.scrollIntoView({ block: 'nearest' });
        }
    }

    function addSource(source) {
        var sources = readSources();
        if (sources.some(function (s) { return s.url === source.url; })) {
            sourcesNotice.textContent = 'Этот плейлист уже добавлен.';
            return;
        }
        sources.push(source);
        saveSources(sources);
        sourcesNotice.textContent = 'Добавлен: ' + source.name + '.';
        sourcesUrl.value = '';
        renderSources();
    }

    function addTypedUrl() {
        var url = sourcesUrl.value.trim();
        if (!/^https?:\/\/\S+$/i.test(url)) {
            sourcesNotice.textContent = 'Ссылка должна начинаться с http:// или https://';
            return;
        }
        addSource({ name: nameFromUrl(url), url: url });
    }

    function activateSourceRow() {
        var row = sourceRows()[sourcesFocus];
        if (row.kind === 'input') {
            sourcesUrl.focus();
        } else if (row.kind === 'add') {
            addTypedUrl();
        } else if (row.kind === 'preset') {
            addSource({ name: row.preset.name, url: row.preset.url });
        } else if (row.kind === 'catalog') {
            openCatalog();
        } else if (row.kind === 'done') {
            closeSources();
        } else if (pendingRemoval === row.index) {
            var sources = readSources();
            sources.splice(row.index, 1);
            saveSources(sources);
            pendingRemoval = -1;
            sourcesNotice.textContent = 'Плейлист удалён.';
            renderSources();
        } else {
            pendingRemoval = row.index;
            renderSources();
        }
    }

    // ---- iptv-org country catalog ----

    var countries = null;
    var catalogFocus = 0;

    function openCatalog() {
        sourcesNotice.textContent = 'Загружаю список стран…';
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
            sourcesNotice.textContent = '';
            catalogFocus = 0;
            sourcesScreen.classList.add('catalog-mode');
            renderCatalog();
        }, function (err) {
            sourcesNotice.textContent = 'Каталог недоступен: ' + err.message + '.';
        });
    }

    function closeCatalog() {
        sourcesScreen.classList.remove('catalog-mode');
        renderSources();
    }

    function renderCatalog() {
        catalogList.innerHTML = '';
        countries.forEach(function (country, index) {
            var item = document.createElement('li');
            item.textContent = country.name;
            if (index === catalogFocus) {
                item.className = 'focused';
            }
            catalogList.appendChild(item);
        });
        reveal(catalogList, catalogFocus);
    }

    function moveCatalog(delta) {
        // Toggle two rows instead of rebuilding 250 of them.
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
                    sourcesFocus = 1;
                    renderSources();
                }
                return true;
            }
            return false;
        }
        var count = sourceRows().length;
        if (code === KEY.UP || code === KEY.DOWN) {
            sourcesFocus = (sourcesFocus + (code === KEY.UP ? -1 : 1) + count) % count;
            pendingRemoval = -1;
            renderSources();
        } else if (code === KEY.OK) {
            activateSourceRow();
        } else if (code === KEY.BACK) {
            if (readSources().length) {
                closeSources();
            } else {
                window.close();
            }
        } else {
            return false;
        }
        return true;
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

    // ---- Playback ----

    function play(index) {
        current = index;
        var channel = channels[index];
        writeStorage(STORAGE_KEY, String(index));
        showOsd();
        showStatus('Подключаюсь к каналу…');

        if (hls) {
            hls.destroy();
            hls = null;
        }
        video.removeAttribute('src');

        if (window.Hls && Hls.isSupported()) {
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
        } else {
            video.src = channel.url;
        }
        var attempt = video.play();
        if (attempt && attempt.catch) {
            attempt.catch(function () { /* autoplay resolves once data arrives */ });
        }
    }

    function noSignal() {
        showStatus('Канал сейчас не отвечает. Переключите на другой: ↑ ↓ или CH+ CH−.');
    }

    video.addEventListener('playing', hideStatus);
    video.addEventListener('error', noSignal);

    function step(delta) {
        if (!channels.length) {
            return;
        }
        play((current + delta + channels.length) % channels.length);
    }

    // ---- On-screen messages ----

    function showStatus(text) {
        statusBox.textContent = text;
        statusBox.hidden = false;
        delete statusBox.dataset.retry;
    }

    function hideStatus() {
        statusBox.hidden = true;
    }

    function showOsd() {
        var channel = channels[current];
        osdNumber.textContent = channel.number;
        osdName.textContent = channel.name;
        osdGroup.textContent = channel.group;
        osd.hidden = false;
        restartTimer('osd', OSD_TIMEOUT, function () { osd.hidden = true; });
    }

    function restartTimer(name, delay, callback) {
        clearTimeout(timers[name]);
        timers[name] = setTimeout(callback, delay);
    }

    // ---- Menu ----

    function openMenu() {
        if (!channels.length) {
            return;
        }
        osd.hidden = true;
        var group = 0;
        menuState = { column: 'channels', group: group, channel: Math.max(0, groups[group].channels.indexOf(current)) };
        menu.hidden = false;
        renderGroups();
        renderChannels();
        tickClock();
        touchMenu();
    }

    function closeMenu() {
        menu.hidden = true;
        clearTimeout(timers.menu);
    }

    function touchMenu() {
        restartTimer('menu', MENU_TIMEOUT, closeMenu);
    }

    function renderGroups() {
        groupList.innerHTML = '';
        groups.forEach(function (group, index) {
            var item = document.createElement('li');
            item.textContent = group.name;
            var count = document.createElement('span');
            count.className = 'count';
            count.textContent = group.channels.length;
            item.appendChild(count);
            if (index === menuState.group) {
                item.className = menuState.column === 'groups' ? 'focused' : 'selected';
            }
            groupList.appendChild(item);
        });
        var action = document.createElement('li');
        action.className = 'action' + (menuState.group === groups.length && menuState.column === 'groups' ? ' focused' : '');
        action.textContent = 'Плейлисты…';
        groupList.appendChild(action);
        reveal(groupList, menuState.group);
    }

    function renderChannels() {
        channelList.innerHTML = '';
        if (menuState.group >= groups.length) {
            return;
        }
        groups[menuState.group].channels.forEach(function (channelIndex, position) {
            var channel = channels[channelIndex];
            var item = document.createElement('li');
            var classes = [];
            if (channelIndex === current) {
                classes.push('playing');
            }
            if (menuState.column === 'channels' && position === menuState.channel) {
                classes.push('focused');
            }
            item.className = classes.join(' ');

            var number = document.createElement('span');
            number.className = 'number';
            number.textContent = channel.number;
            item.appendChild(number);

            var logo = document.createElement('img');
            logo.className = 'logo';
            logo.loading = 'lazy';
            logo.alt = '';
            if (channel.logo) {
                logo.src = channel.logo;
            }
            logo.onerror = function () { logo.style.visibility = 'hidden'; };
            item.appendChild(logo);

            var name = document.createElement('span');
            name.className = 'name';
            name.textContent = channel.name;
            item.appendChild(name);

            channelList.appendChild(item);
        });
        reveal(channelList, menuState.column === 'channels' ? menuState.channel : 0);
    }

    function reveal(list, index) {
        var item = list.children[index];
        if (item) {
            item.scrollIntoView({ block: 'nearest' });
        }
    }

    function moveInMenu(delta) {
        if (menuState.column === 'groups') {
            // groups.length is the "Playlists…" row.
            var rows = groups.length + 1;
            menuState.group = (menuState.group + delta + rows) % rows;
            menuState.channel = 0;
            renderGroups();
            renderChannels();
        } else {
            // Only move the highlight: rebuilding hundreds of rows per key press lags on the TV.
            var size = groups[menuState.group].channels.length;
            setChannelFocus(false);
            menuState.channel = (menuState.channel + delta + size) % size;
            setChannelFocus(true);
        }
    }

    function setChannelFocus(on) {
        var item = channelList.children[menuState.channel];
        if (!item) {
            return;
        }
        item.classList.toggle('focused', on);
        if (on) {
            item.scrollIntoView({ block: 'nearest' });
        }
    }

    function switchColumn(column) {
        if (menuState.column === column || (column === 'channels' && menuState.group >= groups.length)) {
            return;
        }
        menuState.column = column;
        renderGroups();
        setChannelFocus(column === 'channels');
    }

    function chooseInMenu() {
        if (menuState.column === 'groups') {
            if (menuState.group >= groups.length) {
                openSources();
            } else {
                switchColumn('channels');
            }
            return;
        }
        play(groups[menuState.group].channels[menuState.channel]);
        closeMenu();
    }

    function tickClock() {
        var now = new Date();
        clock.textContent = ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    }

    // ---- Number entry ----

    function typeDigit(digit) {
        digits = (digits + digit).slice(0, 4);
        digitsBox.textContent = digits;
        digitsBox.hidden = false;
        restartTimer('digits', DIGIT_TIMEOUT, function () {
            var number = parseInt(digits, 10);
            digits = '';
            digitsBox.hidden = true;
            if (number >= 1 && number <= channels.length) {
                play(number - 1);
            }
        });
    }

    // ---- Remote ----

    document.addEventListener('keydown', function (event) {
        var code = event.keyCode;

        if (!sourcesScreen.hidden) {
            if (handleSourcesKey(code)) {
                event.preventDefault();
            }
            return;
        }

        if (code >= 48 && code <= 57) {
            typeDigit(String(code - 48));
            return;
        }

        if (code === KEY.GREEN) {
            openSources();
            event.preventDefault();
            return;
        }

        if (!menu.hidden) {
            touchMenu();
            if (code === KEY.UP) { moveInMenu(-1); }
            else if (code === KEY.DOWN) { moveInMenu(1); }
            else if (code === KEY.CH_UP) { moveInMenu(-8); }
            else if (code === KEY.CH_DOWN) { moveInMenu(8); }
            else if (code === KEY.LEFT) { switchColumn('groups'); }
            else if (code === KEY.RIGHT) { switchColumn('channels'); }
            else if (code === KEY.OK) { chooseInMenu(); }
            else if (code === KEY.BACK) { closeMenu(); }
            else { return; }
            event.preventDefault();
            return;
        }

        if (code === KEY.OK) {
            if (statusBox.dataset.retry) {
                loadPlaylists();
            } else {
                openMenu();
            }
        } else if (code === KEY.UP || code === KEY.CH_UP) {
            step(1);
        } else if (code === KEY.DOWN || code === KEY.CH_DOWN) {
            step(-1);
        } else if (code === KEY.INFO || code === KEY.LEFT || code === KEY.RIGHT) {
            if (current >= 0) {
                showOsd();
            }
        } else if (code === KEY.BACK) {
            window.close();
        } else {
            return;
        }
        event.preventDefault();
    });

    // ---- Storage (may be unavailable) ----

    function readStorage(key) {
        try {
            return window.localStorage.getItem(key);
        } catch (e) {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (e) {
            /* remembering the channel is only a convenience */
        }
    }

    loadPlaylists();
}());
