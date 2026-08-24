const WebSocket = require('ws');
const http = require('http');

function login(email, password) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email, password });
    const req = http.request({
      host: 'localhost', port: 8080, path: '/api/auth/login',
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data).data.token));
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

(async () => {
  const admin = await login('admin@kneachat.com', 'kneachat168');
  const maya = await login('maya@kneachat.com', 'kneachat168');

  const ws = new WebSocket(`ws://localhost:8080?token=${encodeURIComponent(admin)}`);
  const ws2 = new WebSocket(`ws://localhost:8080?token=${encodeURIComponent(maya)}`);

  await new Promise((r) => ws.on('open', r));
  await new Promise((r) => ws2.on('open', r));

  const got = [];
  ws2.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'receive_message') got.push(m); });
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.type === 'message_sent_ack') {
      console.log('ADMIN ACK:', JSON.stringify({ ok: true, conv: m.data.conversationId, content: m.data.content }));
    }
    if (m.type === 'error') console.log('ADMIN ERROR:', m.message);
  });

  // Send to channel conversation 5 as admin; maya should receive it (she's a member of conv 5)
  ws.send(JSON.stringify({ type: 'send_message', conversationId: 5, content: 'ws channel test' }));
  setTimeout(() => {
    console.log('MAYA received:', got.map((g) => g.message.content));
    process.exit(0);
  }, 1500);
})();
