const { google } = require('googleapis');
const fs = require('fs/promises');
require('dotenv').config();

async function generateNewTokens(authCode) {
  console.log('🔐 Generating New OAuth Tokens...\n');

  const clientId = process.env.OATH_CLIENT_ID;
  const clientSecret = process.env.OATH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.log('❌ OAuth credentials not found in environment variables');
    return;
  }

  if (!authCode) {
    // Generate and display the authorization URL
    const oAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'urn:ietf:wg:oauth:2.0:oob'
    );

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive.file'],
      prompt: 'consent'
    });

    console.log('❌ No authorization code provided');
    console.log('Usage: node generate-new-tokens.js "YOUR_AUTH_CODE"');
    console.log('\n📋 Visit this URL to get your authorization code:');
    console.log(authUrl);
    return;
  }
  
  try {
    console.log('🔧 Creating OAuth client...');
    const oAuth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    
    console.log('🔄 Exchanging authorization code for tokens...');
    const { tokens } = await oAuth2Client.getToken(authCode);
    
    console.log('✅ Successfully obtained tokens!');
    console.log(`Access Token: ${tokens.access_token?.substring(0, 20)}...`);
    console.log(`Refresh Token: ${tokens.refresh_token?.substring(0, 20)}...`);
    console.log(`Expires: ${new Date(tokens.expiry_date || 0).toISOString()}`);
    
    // Save tokens to file
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      created_at: new Date().toISOString(),
      expires_at: new Date(tokens.expiry_date || Date.now() + 3600000).toISOString()
    };
    
    await fs.writeFile('./oauth-tokens.json', JSON.stringify(tokenData, null, 2));
    console.log('\n✅ Tokens saved to oauth-tokens.json');
    
    // Test the tokens immediately
    console.log('\n🧪 Testing new tokens...');
    oAuth2Client.setCredentials(tokens);
    
    const drive = google.drive({ version: 'v3', auth: oAuth2Client });
    const testResponse = await drive.about.get({ fields: 'user' });
    
    console.log(`✅ Token test successful! Authenticated as: ${testResponse.data.user?.emailAddress}`);
    console.log('\n🎉 OAuth setup complete! Your backup workflow should now work.');
    
  } catch (error) {
    console.error('❌ Token generation failed:', error.message);
    
    if (error.message.includes('invalid_grant')) {
      console.log('\n🔧 This usually means:');
      console.log('  • The authorization code expired (get a new one)');
      console.log('  • The authorization code was already used');
      console.log('  • There was a clock skew issue');
    }
  }
}

// Get auth code from command line arguments
const authCode = process.argv[2];
generateNewTokens(authCode).catch(console.error);