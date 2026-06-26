const { google } = require('googleapis');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(factoryId) {
  const oAuth2Client = getOAuthClient();
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ];
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
    state: factoryId,
  });
}

async function getTokensFromCode(code) {
  const oAuth2Client = getOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  return tokens;
}

function getAuthenticatedClient(accessToken, refreshToken, tokenExpiry) {
  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: tokenExpiry ? new Date(tokenExpiry).getTime() : null,
  });
  return oAuth2Client;
}

async function refreshAccessToken(refreshToken) {
  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oAuth2Client.refreshAccessToken();
  return credentials;
}

module.exports = {
  getOAuthClient,
  getAuthUrl,
  getTokensFromCode,
  getAuthenticatedClient,
  refreshAccessToken,
};