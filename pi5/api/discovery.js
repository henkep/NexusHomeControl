/**
 * NEXUS Device Discovery Module
 * Automatically discovers smart home devices on the network
 */

const https = require('https');
const dns = require('dns');
const { networkInterfaces } = require('os');

// Get local network range
function getLocalNetworkRange() {
    const interfaces = networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const parts = iface.address.split('.');
                return `${parts[0]}.${parts[1]}.${parts[2]}`;
            }
        }
    }
    return '192.168.1';
}

// Fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 2000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

//=============================================================================
// SHELLY DISCOVERY
//=============================================================================
async function discoverShelly() {
    const networkRange = getLocalNetworkRange();
    const devices = [];
    const scanPromises = [];
    
    console.log(`Scanning ${networkRange}.1-254 for Shelly devices...`);
    
    for (let i = 1; i <= 254; i++) {
        const ip = `${networkRange}.${i}`;
        
        scanPromises.push(
            (async () => {
                try {
                    // Try Shelly Gen2 API first
                    const resp = await fetchWithTimeout(`http://${ip}/rpc/Shelly.GetDeviceInfo`, {}, 1000);
                    if (resp.ok) {
                        const data = await resp.json();
                        return {
                            ip,
                            id: data.id,
                            mac: data.mac,
                            model: data.model,
                            name: data.name || data.id,
                            gen: 2,
                            type: detectShellyType(data.model)
                        };
                    }
                } catch (e) {}
                
                try {
                    // Try Shelly Gen1 API
                    const resp = await fetchWithTimeout(`http://${ip}/shelly`, {}, 1000);
                    if (resp.ok) {
                        const data = await resp.json();
                        return {
                            ip,
                            id: data.id,
                            mac: data.mac,
                            model: data.type,
                            name: data.id,
                            gen: 1,
                            type: detectShellyType(data.type)
                        };
                    }
                } catch (e) {}
                
                return null;
            })()
        );
    }
    
    const results = await Promise.all(scanPromises);
    return results.filter(d => d !== null);
}

function detectShellyType(model) {
    const modelLower = (model || '').toLowerCase();
    if (modelLower.includes('switch') || modelLower.includes('1pm') || modelLower.includes('1l')) {
        return 'switch';
    } else if (modelLower.includes('dimmer')) {
        return 'dimmer';
    } else if (modelLower.includes('plug')) {
        return 'plug';
    } else if (modelLower.includes('bulb') || modelLower.includes('duo')) {
        return 'bulb';
    } else if (modelLower.includes('rgbw')) {
        return 'rgbw';
    } else if (modelLower.includes('button')) {
        return 'button';
    } else if (modelLower.includes('motion') || modelLower.includes('sensor')) {
        return 'sensor';
    }
    return 'switch';
}

//=============================================================================
// HONEYWELL TCC DISCOVERY
//=============================================================================
let honeywellCookieJar = {};

function honeywellRequest(method, path, postData) {
    return new Promise((resolve) => {
        const cookieStr = Object.keys(honeywellCookieJar)
            .map(k => `${k}=${honeywellCookieJar[k]}`)
            .join('; ');

        const options = {
            hostname: 'mytotalconnectcomfort.com',
            path: path,
            method: method,
            headers: {
                'Cookie': cookieStr,
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'text/html,application/xhtml+xml,application/json',
                'Origin': 'https://mytotalconnectcomfort.com',
                'Referer': 'https://mytotalconnectcomfort.com/portal/'
            }
        };

        if (method === 'POST') {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = https.request(options, (response) => {
            let body = '';
            response.on('data', chunk => body += chunk);
            response.on('end', () => {
                (response.headers['set-cookie'] || []).forEach(c => {
                    const parts = c.split(';')[0].split('=');
                    const name = parts[0];
                    const value = parts.slice(1).join('=');
                    if (value && value.length > 0) {
                        honeywellCookieJar[name] = value;
                    } else {
                        delete honeywellCookieJar[name];
                    }
                });
                resolve({ status: response.statusCode, body, location: response.headers.location });
            });
        });

        req.on('error', () => resolve({ status: 0, body: '' }));
        if (postData) req.write(postData);
        req.end();
    });
}

async function discoverHoneywell(username, password) {
    if (!username || !password) {
        return [];
    }
    
    console.log('Discovering Honeywell thermostats...');
    honeywellCookieJar = {};
    
    try {
        // Login
        await honeywellRequest('GET', '/portal/', '');
        const postData = `timeOffset=300&UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&RememberMe=false`;
        const login = await honeywellRequest('POST', '/portal/', postData);
        
        if (login.location) {
            const redir = await honeywellRequest('GET', login.location, '');
            if (redir.location) await honeywellRequest('GET', redir.location, '');
        }
        
        // Get locations and devices
        const locResp = await honeywellRequest('GET', '/portal/Location/GetLocationListData?page=1&filter=', '');
        
        try {
            // Try to parse as JSON
            const locations = JSON.parse(locResp.body);
            const devices = [];
            
            if (Array.isArray(locations)) {
                for (const loc of locations) {
                    if (loc.Devices && Array.isArray(loc.Devices)) {
                        for (const device of loc.Devices) {
                            devices.push({
                                id: device.DeviceID,
                                name: device.Name || `Thermostat ${device.DeviceID}`,
                                type: device.DeviceType || 'thermostat',
                                locationId: loc.LocationID,
                                locationName: loc.LocationName
                            });
                        }
                    }
                }
            }
            
            return devices;
        } catch (e) {
            // Fallback: parse HTML for device IDs
            const deviceMatches = locResp.body.matchAll(/DeviceID['":\s]+(\d+)/g);
            const devices = [];
            for (const match of deviceMatches) {
                devices.push({
                    id: parseInt(match[1]),
                    name: `Thermostat ${match[1]}`,
                    type: 'thermostat'
                });
            }
            return devices;
        }
    } catch (err) {
        console.error('Honeywell discovery error:', err);
        return [];
    }
}

//=============================================================================
// RING DISCOVERY
//=============================================================================
async function discoverRing(refreshToken) {
    if (!refreshToken) {
        return [];
    }
    
    console.log('Discovering Ring devices...');
    
    try {
        const { RingApi } = require('ring-client-api');
        const api = new RingApi({ refreshToken });
        const locations = await api.getLocations();
        
        const devices = [];
        
        for (const location of locations) {
            // Doorbells
            if (location.cameras) {
                for (const camera of location.cameras) {
                    devices.push({
                        id: camera.id,
                        name: camera.name,
                        type: camera.isDoorbot ? 'doorbell' : 'camera',
                        model: camera.model,
                        batteryLevel: camera.batteryLevel,
                        hasLight: camera.hasLight,
                        hasSiren: camera.hasSiren,
                        locationName: location.name
                    });
                }
            }
        }
        
        return devices;
    } catch (err) {
        console.error('Ring discovery error:', err);
        return [];
    }
}

//=============================================================================
// PIAWARE DISCOVERY
//=============================================================================
async function discoverPiAware() {
    const networkRange = getLocalNetworkRange();
    const devices = [];
    
    console.log(`Scanning ${networkRange}.1-254 for PiAware/dump1090...`);
    
    // Check common ports
    const ports = [8080, 80, 8888];
    
    for (let i = 1; i <= 254; i++) {
        const ip = `${networkRange}.${i}`;
        
        for (const port of ports) {
            try {
                const resp = await fetchWithTimeout(`http://${ip}:${port}/data/aircraft.json`, {}, 500);
                if (resp.ok) {
                    const data = await resp.json();
                    if (data.aircraft !== undefined || data.messages !== undefined) {
                        devices.push({
                            ip,
                            port,
                            type: 'piaware',
                            url: `http://${ip}:${port}`
                        });
                        break; // Found on this IP, skip other ports
                    }
                }
            } catch (e) {}
        }
    }
    
    // Also check localhost
    try {
        const fs = require('fs');
        if (fs.existsSync('/run/dump1090-fa/aircraft.json')) {
            devices.push({
                ip: 'localhost',
                port: 'file',
                type: 'piaware-local',
                path: '/run/dump1090-fa/aircraft.json'
            });
        }
    } catch (e) {}
    
    return devices;
}

//=============================================================================
// FULL DISCOVERY
//=============================================================================
async function discoverAll(credentials = {}) {
    console.log('\n🔍 Starting device discovery...\n');
    
    const results = {
        shelly: [],
        honeywell: [],
        ring: [],
        piaware: [],
        discoveredAt: new Date().toISOString()
    };
    
    // Run discoveries in parallel where possible
    const [shelly, piaware] = await Promise.all([
        discoverShelly().catch(e => { console.error('Shelly error:', e); return []; }),
        discoverPiAware().catch(e => { console.error('PiAware error:', e); return []; })
    ]);
    
    results.shelly = shelly;
    results.piaware = piaware;
    
    // These need credentials
    if (credentials.honeywellUsername && credentials.honeywellPassword) {
        results.honeywell = await discoverHoneywell(
            credentials.honeywellUsername,
            credentials.honeywellPassword
        ).catch(e => { console.error('Honeywell error:', e); return []; });
    }
    
    if (credentials.ringRefreshToken) {
        results.ring = await discoverRing(credentials.ringRefreshToken)
            .catch(e => { console.error('Ring error:', e); return []; });
    }
    
    // Summary
    console.log('\n📋 Discovery Results:');
    console.log(`   Shelly devices:    ${results.shelly.length}`);
    console.log(`   Honeywell devices: ${results.honeywell.length}`);
    console.log(`   Ring devices:      ${results.ring.length}`);
    console.log(`   PiAware instances: ${results.piaware.length}`);
    console.log('');
    
    return results;
}

//=============================================================================
// EXPORTS
//=============================================================================
module.exports = {
    discoverShelly,
    discoverHoneywell,
    discoverRing,
    discoverPiAware,
    discoverAll,
    getLocalNetworkRange
};

// CLI usage
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--help')) {
        console.log(`
NEXUS Device Discovery

Usage: node discovery.js [options]

Options:
  --shelly              Scan for Shelly devices only
  --honeywell           Discover Honeywell thermostats
  --ring                Discover Ring devices
  --piaware             Scan for PiAware instances
  --all                 Discover all devices (default)
  --json                Output as JSON
  --help                Show this help

Environment variables:
  HONEYWELL_USERNAME    Honeywell TCC email
  HONEYWELL_PASSWORD    Honeywell TCC password
  RING_REFRESH_TOKEN    Ring API refresh token
`);
        process.exit(0);
    }
    
    const credentials = {
        honeywellUsername: process.env.HONEYWELL_USERNAME,
        honeywellPassword: process.env.HONEYWELL_PASSWORD,
        ringRefreshToken: process.env.RING_REFRESH_TOKEN
    };
    
    (async () => {
        let results;
        
        if (args.includes('--shelly')) {
            results = { shelly: await discoverShelly() };
        } else if (args.includes('--honeywell')) {
            results = { honeywell: await discoverHoneywell(credentials.honeywellUsername, credentials.honeywellPassword) };
        } else if (args.includes('--ring')) {
            results = { ring: await discoverRing(credentials.ringRefreshToken) };
        } else if (args.includes('--piaware')) {
            results = { piaware: await discoverPiAware() };
        } else {
            results = await discoverAll(credentials);
        }
        
        if (args.includes('--json')) {
            console.log(JSON.stringify(results, null, 2));
        } else {
            console.log('\nDiscovered devices:');
            console.log(JSON.stringify(results, null, 2));
        }
    })();
}
