// Stores Alik's settings in /media/developer/temp, which survives reinstalling
// or updating the app (but not a factory reset of the TV).
var Service = require('webos-service');
var fs = require('fs');
var pkgInfo = require('./package.json');

var service = new Service(pkgInfo.name);
var DIR = '/media/developer/temp/alik';
var FILE = DIR + '/backup.json';

service.register('save', function (message) {
    var data = message.payload.data;
    if (!data || typeof data !== 'object') {
        return message.respond({ returnValue: false, errorText: 'Nothing to save.' });
    }
    try {
        if (!fs.existsSync(DIR)) {
            fs.mkdirSync(DIR);
        }
        fs.writeFileSync(FILE + '.tmp', JSON.stringify({ savedAt: Date.now(), data: data }));
        fs.renameSync(FILE + '.tmp', FILE);
        message.respond({ returnValue: true, savedAt: Date.now() });
    } catch (e) {
        message.respond({ returnValue: false, errorText: e.message });
    }
});

service.register('load', function (message) {
    fs.readFile(FILE, 'utf8', function (err, text) {
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
