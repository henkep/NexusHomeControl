const https = require('https');

module.exports = async function (context, req) {
    const callsign = req.query.callsign || (req.body && req.body.callsign);
    
    if (!callsign) {
        context.res = {
            status: 400,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { error: 'Missing callsign parameter' }
        };
        return;
    }

    // FlightAware AeroAPI key
    const apiKey = process.env.FLIGHTAWARE_API_KEY || 'PiHFh0V2KBBgmFY7Y0ARKvmAO0PiGASa';
    
    try {
        const flightData = await fetchFlightAware(callsign, apiKey);
        
        context.res = {
            status: 200,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
            },
            body: flightData
        };
    } catch (error) {
        context.log.error('FlightAware API error:', error.message);
        context.res = {
            status: error.status || 500,
            headers: { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: { error: error.message }
        };
    }
};

function fetchFlightAware(callsign, apiKey) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'aeroapi.flightaware.com',
            path: `/aeroapi/flights/${encodeURIComponent(callsign)}`,
            method: 'GET',
            headers: {
                'x-apikey': apiKey,
                'Accept': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', chunk => { data += chunk; });
            
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        
                        // Extract relevant flight info
                        if (json.flights && json.flights.length > 0) {
                            // Find active flight (not arrived)
                            const flight = json.flights.find(f => 
                                f.status && !f.status.includes('Arrived')
                            ) || json.flights[0];
                            
                            const result = {
                                callsign: callsign,
                                found: true
                            };
                            
                            if (flight.origin) {
                                result.origin = {
                                    code: flight.origin.code_iata || flight.origin.code_icao || flight.origin.code,
                                    name: flight.origin.name,
                                    city: flight.origin.city
                                };
                            }
                            
                            if (flight.destination) {
                                result.destination = {
                                    code: flight.destination.code_iata || flight.destination.code_icao || flight.destination.code,
                                    name: flight.destination.name,
                                    city: flight.destination.city
                                };
                            }
                            
                            if (flight.aircraft_type) {
                                result.aircraftType = flight.aircraft_type;
                            }
                            
                            if (flight.operator) {
                                result.operator = flight.operator;
                            }
                            
                            if (flight.registration) {
                                result.registration = flight.registration;
                            }
                            
                            resolve(result);
                        } else {
                            resolve({ callsign: callsign, found: false });
                        }
                    } catch (e) {
                        reject({ status: 500, message: 'Failed to parse response' });
                    }
                } else if (res.statusCode === 429) {
                    reject({ status: 429, message: 'Rate limited' });
                } else if (res.statusCode === 404) {
                    resolve({ callsign: callsign, found: false });
                } else {
                    reject({ status: res.statusCode, message: `API error: ${res.statusCode}` });
                }
            });
        });

        req.on('error', (e) => {
            reject({ status: 500, message: e.message });
        });

        req.end();
    });
}
