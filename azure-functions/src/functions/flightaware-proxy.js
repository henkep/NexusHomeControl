const { app } = require('@azure/functions');
const https = require('https');

app.http('flightaware-proxy', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        const callsign = request.query.get('callsign');
        
        if (!callsign) {
            return { status: 400, jsonBody: { error: 'Missing callsign' } };
        }

        const apiKey = 'PiHFh0V2KBBgmFY7Y0ARKvmAO0PiGASa';

        return new Promise((resolve) => {
            const options = {
                hostname: 'aeroapi.flightaware.com',
                path: '/aeroapi/flights/' + encodeURIComponent(callsign),
                method: 'GET',
                headers: { 'x-apikey': apiKey }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk; });
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        resolve({ jsonBody: { callsign: callsign, found: false } });
                        return;
                    }

                    try {
                        const data = JSON.parse(body);
                        const flight = data.flights && data.flights[0];
                        
                        const result = { callsign: callsign, found: false };

                        if (flight && flight.origin && flight.destination) {
                            result.found = true;
                            result.origin = { code: flight.origin.code_iata || flight.origin.code_icao };
                            result.destination = { code: flight.destination.code_iata || flight.destination.code_icao };
                            result.aircraftType = flight.aircraft_type || null;
                        }

                        resolve({ jsonBody: result });
                    } catch (e) {
                        resolve({ jsonBody: { callsign: callsign, found: false, error: 'Parse error' } });
                    }
                });
            });

            req.on('error', (e) => {
                resolve({ jsonBody: { callsign: callsign, found: false, error: e.message } });
            });

            req.end();
        });
    }
});
