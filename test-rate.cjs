const http = require('https');

const clientId = process.env.SYSCOM_CLIENT_ID;
const clientSecret = process.env.SYSCOM_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  throw new Error('Missing SYSCOM_CLIENT_ID or SYSCOM_CLIENT_SECRET');
}

const postData = new URLSearchParams({
  client_id: clientId,
  client_secret: clientSecret,
  grant_type: 'client_credentials'
}).toString();

const options = {
  hostname: 'developers.syscom.mx',
  port: 443,
  path: '/oauth/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Content-Length': postData.length
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    const token = JSON.parse(data).access_token;
    
    if (token) {
        const getOptions = {
            hostname: 'developers.syscom.mx',
            port: 443,
            path: '/api/v1/tipocambio',
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        };
        const getReq = http.request(getOptions, (res2) => {
            let data2 = '';
            res2.on('data', (chunk) => { data2 += chunk; });
            res2.on('end', () => { console.log("Response:", data2); });
        });
        getReq.end();
    }
  });
});

req.write(postData);
req.end();
