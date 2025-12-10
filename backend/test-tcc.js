const https = require('https');

const username = 'heped1973@gmail.com';
const password = 'Saab900Turbo1983!1';

var cookieJar = {};

function makeRequest(method, path, postData) {
    return new Promise(function(resolve) {
        var cookieStr = Object.keys(cookieJar).map(k => k + '=' + cookieJar[k]).join('; ');
        
        var options = {
            hostname: 'mytotalconnectcomfort.com',
            path: path,
            method: method,
            headers: {
                'Cookie': cookieStr,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Origin': 'https://mytotalconnectcomfort.com',
                'Referer': 'https://mytotalconnectcomfort.com/portal/'
            }
        };
        if (method === 'POST') {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }
        var req = https.request(options, function(res) {
            var body = '';
            res.on('data', function(chunk) { body += chunk; });
            res.on('end', function() {
                (res.headers['set-cookie'] || []).forEach(function(c) {
                    var parts = c.split(';')[0].split('=');
                    var name = parts[0];
                    var value = parts.slice(1).join('=');
                    if (value && value.length > 0) {
                        cookieJar[name] = value;
                        console.log('  Cookie set:', name, '=', value.substring(0, 40) + '...');
                    } else {
                        console.log('  Cookie cleared:', name);
                        delete cookieJar[name];
                    }
                });
                resolve({ status: res.statusCode, body: body, location: res.headers.location });
            });
        });
        req.on('error', function(e) { resolve({ error: e.message }); });
        if (postData) req.write(postData);
        req.end();
    });
}

async function test() {
    console.log('Step 1: Get initial page');
    var init = await makeRequest('GET', '/portal/', '');
    console.log('  Status:', init.status);
    
    console.log('\nStep 2: Login');
    var postData = 'timeOffset=300&UserName=' + encodeURIComponent(username) + '&Password=' + encodeURIComponent(password) + '&RememberMe=false';
    var login = await makeRequest('POST', '/portal/', postData);
    console.log('  Status:', login.status, 'Location:', login.location);
    
    console.log('\nStep 3: Follow redirect');
    if (login.location) {
        var redir = await makeRequest('GET', login.location, '');
        console.log('  Status:', redir.status, 'Location:', redir.location);
    }
    
    console.log('\nCurrent cookies:', Object.keys(cookieJar));
    
    console.log('\nStep 4: Get device page');
    var device = await makeRequest('GET', '/portal/Device/Control/9948038', '');
    console.log('  Status:', device.status);
    console.log('  Has Control.Model:', device.body.indexOf('Control.Model') > -1);
    if (device.body.indexOf('Control.Model') > -1) {
        var tempMatch = device.body.match(/dispTemperature,\s*([\d.]+)/);
        console.log('  Temperature:', tempMatch ? tempMatch[1] : 'not found');
    }
}

test();
