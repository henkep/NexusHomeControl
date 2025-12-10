module.exports = async function (context, req) {
    context.log('Broadcast function triggered');
    
    if (req.method === 'OPTIONS') {
        context.res = {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        };
        return;
    }
    
    var body = req.body || {};
    var message = body.message || body.text || 'Test broadcast';
    var device = body.device || 'Test Device';
    
    var event = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        device: device,
        utterance: message,
        response: 'Broadcast received',
        type: 'general'
    };
    
    context.log('Broadcasting event:', event);
    
    context.bindings.signalRMessages = [{
        target: 'alexaEvent',
        arguments: [event]
    }];
    
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        body: { success: true, message: 'Broadcast sent', event: event }
    };
};
