const https = require('https');

const DEVICES = [
    { id: 10019242, name: 'Downstairs' },
    { id: 9948038, name: 'Upper Level' }
];

var cookieJar = {};

module.exports = async function (context, req) {
    const username = 'heped1973@gmail.com';
    const password = process.env.TCC_PASSWORD;
    const debug = req.query.debug === 'true';

    cookieJar = {};

    try {
        // Step 1: Get initial page
        await makeRequest('GET', '/portal/', '', context);

        // Step 2: Login
        var postData = 'timeOffset=300&UserName=' + encodeURIComponent(username) + '&Password=' + encodeURIComponent(password) + '&RememberMe=false';
        var login = await makeRequest('POST', '/portal/', postData, context);

        // Step 3: Follow redirects
        if (login.location) {
            var redir = await makeRequest('GET', login.location, '', context);
            if (redir.location) {
                await makeRequest('GET', redir.location, '', context);
            }
        }

        // Step 4: Get each thermostat
        var thermostats = [];
        var debugInfo = [];
        
        for (var i = 0; i < DEVICES.length; i++) {
            var device = await makeRequest('GET', '/portal/Device/Control/' + DEVICES[i].id, '', context);
            
            if (debug) {
                debugInfo.push({
                    device: DEVICES[i].name,
                    status: device.status,
                    bodyLength: device.body ? device.body.length : 0,
                    bodySnippet: device.body ? device.body.substring(0, 500) : '',
                    hasDispTemp: device.body ? device.body.includes('dispTemperature') : false
                });
            }
            
            var data = parseDevicePage(device.body);
            thermostats.push({
                id: DEVICES[i].id,
                name: DEVICES[i].name,
                currentTemp: data.dispTemperature,
                targetTemp: data.heatSetpoint || data.coolSetpoint,
                humidity: data.indoorHumidity,
                outdoorTemp: data.outdoorTemp,
                outdoorHumidity: data.outdoorHumidity,
                mode: data.mode,
                status: data.status
            });
        }

        var response = { success: true, thermostats: thermostats };
        if (debug) {
            response.debug = {
                cookies: Object.keys(cookieJar),
                loginStatus: login.status,
                loginLocation: login.location,
                devices: debugInfo
            };
        }

        context.res = {
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: response
        };
    } catch (err) {
        context.res = {
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: { success: false, error: err.message, stack: err.stack }
        };
    }
};

function parseDevicePage(html) {
    var result = {};

    var patterns = {
        dispTemperature: /Property\.dispTemperature,\s*([\d.]+)/,
        indoorHumidity: /Property\.indoorHumidity,\s*([\d.]+)/,
        heatSetpoint: /Property\.heatSetpoint,\s*([\d.]+)/,
        coolSetpoint: /Property\.coolSetpoint,\s*([\d.]+)/,
        outdoorTemp: /Property\.outdoorTemp,\s*([\d.]+)/,
        outdoorHumidity: /Property\.outdoorHumidity,\s*([\d.]+)/,
        systemSwitchPosition: /Property\.systemSwitchPosition,\s*(\d+)/,
        statusHeat: /Property\.statusHeat,\s*(\d+)/,
        statusCool: /Property\.statusCool,\s*(\d+)/
    };

    for (var key in patterns) {
        var match = html.match(patterns[key]);
        if (match) {
            result[key] = parseFloat(match[1]);
        }
    }

    var modes = ['EmHeat', 'Heat', 'Off', 'Cool', 'Auto'];
    result.mode = modes[result.systemSwitchPosition] || 'Unknown';

    if (result.statusHeat === 1 || result.statusHeat === 2) {
        result.status = 'Heating';
    } else if (result.statusCool === 1 || result.statusCool === 2) {
        result.status = 'Cooling';
    } else {
        result.status = 'Idle';
    }

    return result;
}

function makeRequest(method, path, postData, context) {
    return new Promise(function(resolve) {
        var cookieStr = Object.keys(cookieJar).map(function(k) { return k + '=' + cookieJar[k]; }).join('; ');

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
                    } else {
                        delete cookieJar[name];
                    }
                });
                resolve({ status: res.statusCode, body: body, location: res.headers.location });
            });
        });
        req.on('error', function(e) { resolve({ status: 0, body: '', error: e.message }); });
        if (postData) req.write(postData);
        req.end();
    });
}
