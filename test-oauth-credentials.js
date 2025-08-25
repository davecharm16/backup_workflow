const { google } = require('googleapis');
require('dotenv').config();

async function testOAuthCredentials() {
  console.log('🔍 Testing OAuth Credentials...\n');
  
  const clientId = process.env.OATH_CLIENT_ID;
  const clientSecret = process.env.OATH_CLIENT_SECRET;
  
  console.log(`Client ID: ${clientId}`);
  console.log(`Client Secret: ${clientSecret ? clientSecret.substring(0, 10) + '...' : 'Not set'}\n`);
  
  if (!clientId || !clientSecret) {
    console.log('❌ OAuth credentials not found in environment variables');
    return;
  }
  
  try {
    // Create OAuth2 client
    const oAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    
    // Try to generate auth URL (this will fail if client credentials are invalid)
    const scopes = ['https://www.googleapis.com/auth/drive.file'];
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
    
    console.log('✅ OAuth credentials appear to be valid!');
    console.log('✅ Successfully generated authorization URL');
    console.log('\n🔗 Authorization URL:');
    console.log(authUrl);
    console.log('\nNext steps:');
    console.log('1. Visit the URL above');
    console.log('2. Authorize the application');
    console.log('3. Copy the authorization code');
    console.log('4. Run: node tests/exchange-oauth-tokens.js "YOUR_AUTH_CODE"');
    
  } catch (error) {
    console.log('❌ OAuth credentials test failed:', error.message);
    if (error.message.includes('invalid_client')) {
      console.log('\n🔧 This means your OAuth application was likely deleted or disabled.');
      console.log('You need to create a new OAuth application in Google Cloud Console.');
    }
  }
}

testOAuthCredentials().catch(console.error);