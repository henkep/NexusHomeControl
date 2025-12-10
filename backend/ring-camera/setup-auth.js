// Ring Authentication Setup Script
// Run this once to get a refresh token for the Azure Function

const { RingApi } = require('ring-client-api');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question) {
    return new Promise(resolve => {
        rl.question(question, answer => {
            resolve(answer);
        });
    });
}

async function main() {
    console.log('\n🔔 Ring Authentication Setup\n');
    console.log('This will generate a refresh token for your Ring account.');
    console.log('The token will be used by the Azure Function to access your camera.\n');
    
    const email = await ask('Ring Email: ');
    const password = await ask('Ring Password: ');
    
    try {
        console.log('\n📱 Attempting login...');
        
        const ringApi = new RingApi({
            email,
            password,
            // This will trigger 2FA if enabled
        });
        
        // Try to get cameras - this will fail if 2FA is needed
        try {
            const cameras = await ringApi.getCameras();
            console.log(`\n✅ Success! Found ${cameras.length} camera(s).`);
            
            // Get refresh token
            const refreshToken = ringApi.restClient.refreshToken;
            console.log('\n📋 Your refresh token (keep this secret!):\n');
            console.log(refreshToken);
            console.log('\n🔧 Add this to Azure:\n');
            console.log(`az functionapp config appsettings set --name nexus-alexa-bridge-45799 --resource-group nexus-home-rg --settings "RING_REFRESH_TOKEN=${refreshToken}"`);
            
        } catch (e) {
            if (e.message.includes('2fa')) {
                console.log('\n📱 2FA Required! Check your phone/email for the code.');
                const code = await ask('Enter 2FA Code: ');
                
                // Create new API with 2FA code
                const ringApi2fa = new RingApi({
                    email,
                    password,
                    twoFactorAuthCode: code
                });
                
                const cameras = await ringApi2fa.getCameras();
                console.log(`\n✅ Success! Found ${cameras.length} camera(s).`);
                
                const refreshToken = ringApi2fa.restClient.refreshToken;
                console.log('\n📋 Your refresh token (keep this secret!):\n');
                console.log(refreshToken);
                console.log('\n🔧 Add this to Azure:\n');
                console.log(`az functionapp config appsettings set --name nexus-alexa-bridge-45799 --resource-group nexus-home-rg --settings "RING_REFRESH_TOKEN=${refreshToken}"`);
            } else {
                throw e;
            }
        }
        
    } catch (err) {
        console.error('\n❌ Error:', err.message);
    }
    
    rl.close();
}

main();
