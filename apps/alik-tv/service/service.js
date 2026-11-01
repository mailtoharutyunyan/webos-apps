// Keeps a backup of Alik's settings. /media/developer/temp is preferred (it
// outlives the app), but the service jail may not expose it; then the copy goes
// next to this service, which survives app updates and reinstalls over it.
var Service = require('webos-service');
var fs = require('fs');
var path = require('path');
var http = require('http');
var os = require('os');
var crypto = require('crypto');
var querystring = require('querystring');
var pkgInfo = require('./package.json');

var service = new Service(pkgInfo.name);
var PLACES = ['/media/developer/temp/alik', path.join(__dirname, 'backup')];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

function findBackup() {
    for (var i = 0; i < PLACES.length; i++) {
        var file = path.join(PLACES[i], 'backup.json');
        if (fs.existsSync(file)) {
            return file;
        }
    }
    return null;
}

service.register('save', function (message) {
    var data = message.payload.data;
    if (!data || typeof data !== 'object') {
        return message.respond({ returnValue: false, errorText: 'Nothing to save.' });
    }
    var errors = [];
    for (var i = 0; i < PLACES.length; i++) {
        var file = path.join(PLACES[i], 'backup.json');
        try {
            ensureDir(PLACES[i]);
            fs.writeFileSync(file + '.tmp', JSON.stringify({ savedAt: Date.now(), data: data }));
            fs.renameSync(file + '.tmp', file);
            return message.respond({ returnValue: true, savedAt: Date.now(), place: PLACES[i] });
        } catch (e) {
            errors.push(e.message);
        }
    }
    message.respond({ returnValue: false, errorText: errors.join('; ') });
});

service.register('load', function (message) {
    var file = findBackup();
    if (!file) {
        return message.respond({ returnValue: true, found: false });
    }
    fs.readFile(file, 'utf8', function (err, text) {
        if (err) {
            return message.respond({ returnValue: true, found: false });
        }
        try {
            var backup = JSON.parse(text);
            message.respond({ returnValue: true, found: true, savedAt: backup.savedAt, data: backup.data });
        } catch (e) {
            message.respond({ returnValue: false, errorText: 'The backup file is damaged.' });
        }
    });
});

// ---------- Playlist from a phone ----------
// While Alik's Playlists screen is open, it subscribes to "share". The service then
// serves a small page on the home network; a link sent from it is pushed to Alik.
// The page lives under a random path that changes every time, and the server stops
// when the last subscription is cancelled.

var PHONE_PORTS = [8095, 8096, 8097, 8098, 8099];
var MAX_BODY = 8192;
var DEFAULT_TEXTS = {
    title: 'Alik',
    heading: 'Плейлист на телевизор',
    intro: 'Вставьте ссылку на M3U-плейлист. Она сразу появится в Alik на телевизоре.',
    urlLabel: 'Ссылка на плейлист',
    nameLabel: 'Название, если нужно своё',
    send: 'Отправить на телевизор',
    sent: 'Отправлено на телевизор: ',
    badUrl: 'Ссылка должна начинаться с http:// или https://',
    expired: 'Этот код больше не работает. Откройте «Плейлисты» в Alik и отсканируйте новый.'
};
var DEFAULT_COLORS = {
    ink: '#0f1420', panel: '#161c2a', line: '#2b3449', text: '#f3efe8',
    muted: '#97a1b5', accent: '#f39c4a', accentInk: '#1d1309', red: '#e5484d'
};

var phone = { server: null, port: 0, token: '', subscribers: {}, texts: DEFAULT_TEXTS, colors: DEFAULT_COLORS, lang: 'ru' };
var template = fs.readFileSync(path.join(__dirname, 'phone.html'), 'utf8');

function lanAddress() {
    var interfaces = os.networkInterfaces();
    var names = Object.keys(interfaces);
    for (var i = 0; i < names.length; i++) {
        var list = interfaces[names[i]];
        for (var j = 0; j < list.length; j++) {
            if (list[j].family === 'IPv4' && !list[j].internal) {
                return list[j].address;
            }
        }
    }
    return null;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// Strings come from Alik in its language; colours from its current theme.
function pick(source, defaults, valid) {
    var result = {};
    Object.keys(defaults).forEach(function (key) {
        var value = source && source[key];
        result[key] = typeof value === 'string' && valid(value) ? value : defaults[key];
    });
    return result;
}

function isLink(url) {
    return url.length <= 2048 && /^https?:\/\/\S+$/i.test(url);
}

function renderPage(state, url, name) {
    var values = {
        lang: phone.lang, token: phone.token, url: url || '', name: name || '', state: state || ''
    };
    return template.replace(/\{\{(\w+)\}\}/g, function (match, key) {
        if (key === 'state' || key === 'token') {
            return values[key];
        }
        if (values.hasOwnProperty(key)) {
            return escapeHtml(values[key]);
        }
        if (phone.colors.hasOwnProperty(key)) {
            return phone.colors[key];
        }
        return escapeHtml(phone.texts[key] || '');
    });
}

function stateBlock(kind, text) {
    return '<p class="state ' + kind + '" role="status">' + escapeHtml(text) + '</p>';
}

function sendPage(response, status, html) {
    response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
}

function pushToSubscribers(payload) {
    Object.keys(phone.subscribers).forEach(function (key) {
        phone.subscribers[key].respond(payload);
    });
}

function handlePhone(request, response) {
    var parts = request.url.split('?');
    var query = querystring.parse(parts[1] || '');
    if (parts[0] === '/favicon.ico') {
        response.writeHead(204);
        return response.end();
    }
    if (parts[0] !== '/' + phone.token) {
        return sendPage(response, 404, renderPage(stateBlock('error', phone.texts.expired)).replace(/<form[\s\S]*<\/form>/, ''));
    }
    if (request.method === 'GET') {
        var sent = typeof query.sent === 'string' ? stateBlock('sent', phone.texts.sent + query.sent) : '';
        return sendPage(response, 200, renderPage(sent));
    }
    if (request.method !== 'POST') {
        response.writeHead(405, { Allow: 'GET, POST' });
        return response.end();
    }
    var body = '';
    request.setEncoding('utf8');
    request.on('data', function (chunk) {
        body += chunk;
        if (body.length > MAX_BODY) {
            response.writeHead(413);
            response.end();
            request.destroy();
        }
    });
    request.on('end', function () {
        if (body.length > MAX_BODY) {
            return;
        }
        var form = querystring.parse(body);
        // Phones may wrap a long pasted link, so whitespace inside it is dropped.
        var url = String(form.url || '').replace(/\s+/g, '');
        var name = String(form.name || '').trim().slice(0, 80);
        if (!isLink(url)) {
            return sendPage(response, 400, renderPage(stateBlock('error', phone.texts.badUrl), url, name));
        }
        pushToSubscribers({ returnValue: true, link: { url: url, name: name } });
        // Redirect after the post, so reloading the page does not send the link twice.
        response.writeHead(303, { Location: '/' + phone.token + '?sent=' + encodeURIComponent(name || url) });
        response.end();
    });
}

function startServer(done) {
    if (phone.server) {
        return done(null);
    }
    var server = http.createServer(handlePhone);
    var attempt = 0;
    server.on('error', function (err) {
        if (err.code === 'EADDRINUSE' && attempt < PHONE_PORTS.length - 1) {
            attempt++;
            return server.listen(PHONE_PORTS[attempt], '0.0.0.0');
        }
        done(err);
    });
    server.on('listening', function () {
        phone.server = server;
        phone.port = PHONE_PORTS[attempt];
        phone.token = crypto.randomBytes(4).toString('hex');
        done(null);
    });
    server.listen(PHONE_PORTS[attempt], '0.0.0.0');
}

function stopServerIfUnused() {
    if (phone.server && !Object.keys(phone.subscribers).length) {
        phone.server.close();
        phone.server = null;
    }
}

service.register('share', function (message) {
    if (!message.isSubscription) {
        return message.respond({ returnValue: false, errorText: 'Subscribe to get links from a phone.' });
    }
    var address = lanAddress();
    if (!address) {
        return message.respond({ returnValue: false, errorText: 'The TV is not on a network.' });
    }
    var payload = message.payload || {};
    phone.texts = pick(payload.texts, DEFAULT_TEXTS, function (v) { return v.length <= 300; });
    phone.colors = pick(payload.colors, DEFAULT_COLORS, function (v) { return /^#[0-9a-f]{3,8}$/i.test(v); });
    phone.lang = /^[a-z]{2}$/.test(payload.lang) ? payload.lang : 'ru';
    startServer(function (err) {
        if (err) {
            return message.respond({ returnValue: false, errorText: err.message });
        }
        phone.subscribers[message.uniqueToken] = message;
        message.respond({ returnValue: true, subscribed: true, url: 'http://' + address + ':' + phone.port + '/' + phone.token });
    });
}, function (message) {
    delete phone.subscribers[message.uniqueToken];
    stopServerIfUnused();
});
