const https = require('https');

const SHELLY_AUTH_KEY = process.env.SHELLY_AUTH_KEY;
const SHELLY_SERVER = 'shelly-130-eu.shelly.cloud';

const DEVICES = {
    'stovetop': { id: '28372f2525a4', name: 'Stovetop' },
    'counter': { id: '28372f278820', name: 'Counter' },
    'sink': { id: '28372f278828', name: 'Sink' }
};

module.exports = async function (context, req) {
    const action = req.query.action || 'status';
    const device = req.query.device; // stovetop, counter, sink, or 'all'
    const state = req.query.state; // on or off

    try {
        let result;

        if (action === 'status') {
            result = await getAllStatus();
        } else if (action === 'control') {
            if (device === 'all') {
                result = await controlAllV2(state === 'on');
            } else if (DEVICES[device]) {
                result = await controlDevice(DEVICES[device].id, state === 'on');
            } else {
                result = { error: 'Unknown device' };
            }
        }

        context.res = {
            status: 200,
            headers: { 
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: result
        };
    } catch (err) {
        context.res = {
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: { error: err.message }
        };
    }
};

function getAllStatus() {
    return new Promise((resolve, reject) => {
        const postData = `auth_key=${SHELLY_AUTH_KEY}`;
        
        const options = {
            hostname: SHELLY_SERVER,
            path: '/device/all_status',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    if (data.isok && data.data && data.data.devices_status) {
                        const statuses = {};
                        for (const [key, value] of Object.entries(DEVICES)) {
                            const deviceData = data.data.devices_status[value.id];
                            if (deviceData && deviceData['switch:0']) {
                                statuses[key] = {
                                    name: value.name,
                                    id: value.id,
                                    on: deviceData['switch:0'].output,
                                    power: deviceData['switch:0'].apower || 0
                                };
                            }
                        }
                        resolve({ success: true, devices: statuses });
                    } else {
                        resolve({ success: false, error: 'Invalid response' });
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function controlDevice(deviceId, turnOn) {
    return new Promise((resolve, reject) => {
        const postData = `auth_key=${SHELLY_AUTH_KEY}&id=${deviceId}&channel=0&turn=${turnOn ? 'on' : 'off'}`;
        
        const options = {
            hostname: SHELLY_SERVER,
            path: '/device/relay/control',
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve({ success: data.isok, device: deviceId, state: turnOn ? 'on' : 'off' });
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

function controlAllV2(turnOn) {
    return new Promise((resolve, reject) => {
        const allIds = Object.values(DEVICES).map(d => d.id);
        const postData = JSON.stringify({
            switch: {
                ids: allIds,
                command: {
                    on: turnOn
                }
            }
        });
        
        const options = {
            hostname: SHELLY_SERVER,
            path: `/v2/devices/api/set/groups?auth_key=${SHELLY_AUTH_KEY}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    // v2 API returns 200 OK on success, may have failedCommands
                    const success = res.statusCode === 200;
                    let failedCommands = null;
                    if (body) {
                        try {
                            const data = JSON.parse(body);
                            failedCommands = data.failedCommands;
                        } catch (e) {}
                    }
                    resolve({ 
                        success: success && !failedCommands, 
                        state: turnOn ? 'on' : 'off',
                        failedCommands: failedCommands
                    });
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}
