// Keeps a backup of Alik's settings. /media/developer/temp is preferred (it
// outlives the app), but the service jail may not expose it; then the copy goes
// next to this service, which survives app updates and reinstalls over it.
var Service = require('webos-service');
var fs = require('fs');
var path = require('path');
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
