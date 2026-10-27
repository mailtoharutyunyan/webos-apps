// Keeps the LG Developer Mode session alive without any third-party server.
// The TV renews its own token through LG's endpoint on a weekly schedule
// registered with the webOS activity manager.

var Service = require('webos-service');
var https = require('https');
var url = require('url');
var fs = require('fs');
var path = require('path');
var pkgInfo = require('./package.json');

var service = new Service(pkgInfo.name);

var TOKEN_FILE = '/var/luna/preferences/devmode_enabled';
var STATE_FILE = path.join(__dirname, 'state.json');
var LG_BASE = 'https://developer.lge.com/secure/';
var ACTIVITY_NAME = pkgInfo.name + '.weekly';
var INTERVAL = '7d00h00m00s';
var LOG_LIMIT = 20;

function readToken(callback) {
    fs.readFile(TOKEN_FILE, 'utf8', function (err, data) {
        if (err) {
            return callback(new Error('Cannot read the Developer Mode token: ' + err.message));
        }
        var token = data.trim();
        if (!/^[0-9a-zA-Z]+$/.test(token)) {
            return callback(new Error('The Developer Mode token file has an unexpected format.'));
        }
        callback(null, token);
    });
}

// Calls CheckDevModeSession.dev or ResetDevModeSession.dev.
// LG answers {"result":"success","errorMsg":"<remaining HH:MM:SS>"}.
function callLg(endpoint, token, callback) {
    // The TV runs Node 8, so the request options must be a single object.
    var options = url.parse(LG_BASE + endpoint + '?sessionToken=' + encodeURIComponent(token));
    options.timeout = 15000;
    var req = https.get(options, function (res) {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function (chunk) { body += chunk; });
        res.on('end', function () {
            if (res.statusCode !== 200) {
                return callback(new Error('LG server answered HTTP ' + res.statusCode));
            }
            var json;
            try {
                json = JSON.parse(body);
            } catch (e) {
                return callback(new Error('LG server sent an unreadable answer.'));
            }
            if (json.result !== 'success') {
                return callback(new Error('LG server refused: ' + (json.errorMsg || json.errorCode || 'no reason given')));
            }
            callback(null, json.errorMsg || '');
        });
    });
    req.on('timeout', function () { req.abort(); });
    req.on('error', function (err) {
        callback(new Error('No connection to LG server: ' + err.message));
    });
}

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
        return { log: [] };
    }
}

function saveState(state) {
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    } catch (e) {
        console.error('Cannot save state: ' + e.message);
    }
}

function record(entry) {
    var state = loadState();
    entry.at = new Date().toISOString();
    state.log.unshift(entry);
    state.log = state.log.slice(0, LOG_LIMIT);
    saveState(state);
}

// Developer Mode apps may not call activitymanager/getDetails,
// so the schedule flag is tracked locally.
function setScheduled(value) {
    var state = loadState();
    state.scheduled = value;
    saveState(state);
}

function renew(source, callback) {
    readToken(function (err, token) {
        if (err) {
            record({ ok: false, source: source, error: err.message });
            return callback(err);
        }
        callLg('ResetDevModeSession.dev', token, function (err) {
            if (err) {
                record({ ok: false, source: source, error: err.message });
                return callback(err);
            }
            callLg('CheckDevModeSession.dev', token, function (err, remaining) {
                record({ ok: true, source: source, remaining: err ? null : remaining });
                callback(null, err ? null : remaining);
            });
        });
    });
}

function scheduleWeekly(callback) {
    service.call('luna://com.palm.activitymanager/create', {
        activity: {
            name: ACTIVITY_NAME,
            description: 'Renew the Developer Mode session',
            type: { background: true, persist: true, explicit: true },
            schedule: { interval: INTERVAL },
            requirements: { internet: true },
            callback: { method: 'luna://' + pkgInfo.name + '/scheduled' }
        },
        start: true,
        replace: true
    }, function (msg) {
        callback(msg.payload.returnValue ? null : new Error(msg.payload.errorText || 'Activity manager refused the schedule.'));
    });
}

function respondError(message, err) {
    message.respond({ returnValue: false, errorText: err.message });
}

// Status for the app screen. Never returns the token itself.
service.register('status', function (message) {
    var state = loadState();
    var scheduled = state.scheduled === true;
    readToken(function (err, token) {
        if (err) {
            return message.respond({ returnValue: true, scheduled: scheduled, log: state.log, error: err.message });
        }
        callLg('CheckDevModeSession.dev', token, function (err, remaining) {
            message.respond({
                returnValue: true,
                scheduled: scheduled,
                remaining: err ? null : remaining,
                log: state.log,
                error: err ? err.message : null
            });
        });
    });
});

service.register('renew', function (message) {
    renew('manual', function (err, remaining) {
        if (err) {
            return respondError(message, err);
        }
        message.respond({ returnValue: true, remaining: remaining });
    });
});

service.register('enable', function (message) {
    scheduleWeekly(function (err) {
        if (err) {
            return respondError(message, err);
        }
        setScheduled(true);
        renew('enable', function (err, remaining) {
            if (err) {
                return respondError(message, err);
            }
            message.respond({ returnValue: true, scheduled: true, remaining: remaining });
        });
    });
});

service.register('disable', function (message) {
    service.call('luna://com.palm.activitymanager/cancel', { activityName: ACTIVITY_NAME }, function (msg) {
        if (!msg.payload.returnValue) {
            return respondError(message, new Error(msg.payload.errorText || 'Activity manager refused to cancel.'));
        }
        setScheduled(false);
        message.respond({ returnValue: true, scheduled: false });
    });
});

// Called by the activity manager once a week. Completing with restart
// re-arms the interval for the next run.
service.register('scheduled', function (message) {
    var activity = message.payload.$activity || {};
    renew('schedule', function () {
        message.respond({ returnValue: true });
        service.call('luna://com.palm.activitymanager/complete', {
            activityId: activity.activityId,
            restart: true
        }, function (msg) {
            if (!msg.payload.returnValue) {
                // Fall back to registering the activity from scratch.
                scheduleWeekly(function (err) {
                    if (err) {
                        record({ ok: false, source: 'schedule', error: 'Cannot re-arm the schedule: ' + err.message });
                    }
                });
            }
        });
    });
});
