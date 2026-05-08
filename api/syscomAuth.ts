const SYSCOM_CLIENT_ID = process.env.SYSCOM_CLIENT_ID;
const SYSCOM_CLIENT_SECRET = process.env.SYSCOM_CLIENT_SECRET;

let syscomToken: string | null = null;
let syscomTokenExpiresAt = 0;

export async function getSyscomToken() {
  if (!SYSCOM_CLIENT_ID || !SYSCOM_CLIENT_SECRET) {
    throw new Error('Missing Syscom credentials. Set SYSCOM_CLIENT_ID and SYSCOM_CLIENT_SECRET.');
  }

  if (syscomToken && Date.now() < syscomTokenExpiresAt) {
    return syscomToken;
  }
  const params = new URLSearchParams({
    client_id: SYSCOM_CLIENT_ID,
    client_secret: SYSCOM_CLIENT_SECRET,
    grant_type: 'client_credentials'
  });
  
  const response = await fetch('https://developers.syscom.mx/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });
  
  let data: any;
  const text = await response.text();
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('Syscom response was not valid JSON: ' + text.substring(0, 100));
  }

  if (data.access_token) {
    syscomToken = data.access_token;
    // expires_in is in seconds, minus 60 seconds buffer
    syscomTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return syscomToken;
  }
  throw new Error('Failed to get Syscom Token: ' + JSON.stringify(data));
}
