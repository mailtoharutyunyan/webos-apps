(function () {
    'use strict';

    var SERVICE = 'luna://com.arayik.devrenew.service/';
    var MAX_HOURS = 1000;
    var LOW_HOURS = 168;
    var KEY = { LEFT: 37, RIGHT: 39, BACK: 461 };

    var headline = document.getElementById('headline');
    var detail = document.getElementById('detail');
    var gauge = document.getElementById('gauge');
    var gaugeFill = document.getElementById('gauge-fill');
    var gaugeMarker = document.getElementById('gauge-marker');
    var gaugeLabel = document.getElementById('gauge-label');
    var primary = document.getElementById('primary');
    var secondary = document.getElementById('secondary');
    var logList = document.getElementById('log');

    var scheduled = false;
    var busy = false;

    // PalmServiceBridge is the TV's native bridge to luna services.
    function call(method, params, callback) {
        var bridge = new PalmServiceBridge();
        bridge.onservicecallback = function (raw) {
            var payload;
            try {
                payload = JSON.parse(raw);
            } catch (e) {
                payload = { returnValue: false, errorText: 'Unreadable answer from the service.' };
            }
            callback(payload);
        };
        bridge.call(SERVICE + method, JSON.stringify(params || {}));
    }

    // LG reports remaining time as "HHH:MM:SS".
    function hoursFrom(remaining) {
        var match = /^(\d+):(\d{2})/.exec(remaining || '');
        if (!match) {
            return null;
        }
        return parseInt(match[1], 10) + parseInt(match[2], 10) / 60;
    }

    function formatWhen(iso) {
        var date = new Date(iso);
        var today = new Date();
        var time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (date.toDateString() === today.toDateString()) {
            return 'Today, ' + time;
        }
        return date.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ', ' + time;
    }

    function setTone(tone) {
        document.body.className = tone ? 'is-' + tone : '';
    }

    function showGauge(hours) {
        if (hours === null) {
            gauge.className = 'gauge is-unknown';
            gaugeFill.style.width = '0';
            return;
        }
        var percent = Math.max(0, Math.min(100, hours / MAX_HOURS * 100));
        gauge.className = 'gauge';
        gaugeFill.style.width = percent + '%';
        gaugeMarker.style.left = Math.max(4, Math.min(96, percent)) + '%';
        gaugeLabel.textContent = Math.floor(hours) + ' h left';
    }

    function showLog(entries) {
        logList.innerHTML = '';
        (entries || []).slice(0, 4).forEach(function (entry) {
            var item = document.createElement('li');
            var when = document.createElement('time');
            var what = document.createElement('span');
            when.textContent = formatWhen(entry.at);
            if (entry.ok) {
                var hours = hoursFrom(entry.remaining);
                what.textContent = 'Renewed' + (entry.source === 'schedule' ? ' on schedule' : '') +
                    (hours === null ? '' : ', ' + Math.floor(hours) + ' h left');
            } else {
                what.textContent = 'Failed: ' + entry.error;
                what.className = 'failed';
            }
            item.appendChild(when);
            item.appendChild(what);
            logList.appendChild(item);
        });
    }

    function showButtons() {
        primary.disabled = busy;
        secondary.disabled = busy;
        if (scheduled) {
            primary.textContent = 'Renew now';
            secondary.textContent = 'Turn off weekly renewal';
            secondary.hidden = false;
        } else {
            primary.textContent = 'Turn on weekly renewal';
            secondary.hidden = true;
        }
        if (!document.activeElement || document.activeElement === document.body || document.activeElement.hidden) {
            primary.focus();
        }
    }

    function render(status) {
        var hours = hoursFrom(status.remaining);
        scheduled = !!status.scheduled;
        showGauge(hours);
        showLog(status.log);

        if (status.error) {
            setTone('fault');
            headline.textContent = 'The session could not be checked.';
            detail.textContent = status.error;
        } else if (!scheduled) {
            setTone(hours !== null && hours < LOW_HOURS ? 'low' : '');
            headline.textContent = 'Weekly renewal is off.';
            detail.textContent = 'Turn it on and the TV will renew Developer Mode by itself once a week.';
        } else {
            setTone(hours !== null && hours < LOW_HOURS ? 'low' : '');
            headline.textContent = hours === null
                ? 'Weekly renewal is on.'
                : 'Developer Mode is safe for ' + Math.floor(hours / 24) + ' days.';
            detail.textContent = 'The TV renews the session by itself once a week while it is on.';
        }
        showButtons();
    }

    function refresh() {
        call('status', {}, function (status) {
            if (!status.returnValue) {
                status = { error: status.errorText || 'The renewal service did not start.' };
            }
            render(status);
        });
    }

    function run(method, pending) {
        if (busy) {
            return;
        }
        busy = true;
        detail.textContent = pending;
        showButtons();
        call(method, {}, function (result) {
            busy = false;
            if (!result.returnValue) {
                setTone('fault');
                headline.textContent = 'That did not work.';
                detail.textContent = result.errorText || 'The renewal service gave no reason.';
                showButtons();
                return;
            }
            refresh();
        });
    }

    primary.addEventListener('click', function () {
        if (scheduled) {
            run('renew', 'Renewing the session…');
        } else {
            run('enable', 'Turning on weekly renewal…');
        }
    });

    secondary.addEventListener('click', function () {
        run('disable', 'Turning off weekly renewal…');
    });

    document.addEventListener('keydown', function (event) {
        var buttons = [primary, secondary].filter(function (b) { return !b.hidden; });
        var index = buttons.indexOf(document.activeElement);
        if (event.keyCode === KEY.LEFT || event.keyCode === KEY.RIGHT) {
            event.preventDefault();
            var step = event.keyCode === KEY.LEFT ? -1 : 1;
            buttons[(index + step + buttons.length) % buttons.length].focus();
        } else if (event.keyCode === KEY.BACK) {
            event.preventDefault();
            window.close();
        }
    });

    document.addEventListener('webOSRelaunch', refresh);
    refresh();
}());
