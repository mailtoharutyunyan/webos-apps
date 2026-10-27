// Alik: a small IPTV player for the LG TV remote.
// The TV browser is Chromium 79, so no optional chaining or `??`.
(function () {
    'use strict';

    var PLAYLIST_URL = 'https://mailtoharutyunyan.github.io/webos-apps/playlists/armenia-russia.m3u';
    var STORAGE_KEY = 'alik.lastChannel';
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

    function loadPlaylist() {
        showStatus('Загружаю список каналов…');
        fetch(PLAYLIST_URL, { cache: 'no-store' })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('сервер ответил ' + response.status);
                }
                return response.text();
            })
            .then(function (text) {
                channels = parseM3u(text);
                if (!channels.length) {
                    throw new Error('в списке нет каналов');
                }
                buildGroups();
                var saved = parseInt(readStorage(STORAGE_KEY), 10);
                play(saved >= 0 && saved < channels.length ? saved : 0);
            })
            .catch(function (err) {
                showStatus('Не удалось загрузить список каналов: ' + err.message + '. Проверьте интернет и нажмите OK, чтобы повторить.');
                statusBox.dataset.retry = '1';
            });
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
        reveal(groupList, menuState.group);
    }

    function renderChannels() {
        channelList.innerHTML = '';
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
            menuState.group = (menuState.group + delta + groups.length) % groups.length;
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
        if (menuState.column === column) {
            return;
        }
        menuState.column = column;
        renderGroups();
        setChannelFocus(column === 'channels');
    }

    function chooseInMenu() {
        if (menuState.column === 'groups') {
            switchColumn('channels');
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

        if (code >= 48 && code <= 57) {
            typeDigit(String(code - 48));
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
                loadPlaylist();
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

    loadPlaylist();
}());
