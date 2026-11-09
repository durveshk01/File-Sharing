// Loopback-only SMTP sink for real email-verification/reset browser workflows.
// This helper is started only by Playwright and is not part of the application.
const net = require('node:net');
const http = require('node:http');
const messages = [];

const smtp = net.createServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 SecureShare E2E mailbox\r\n');
  let buffer = '';
  let inData = false;
  let content = [];
  let recipients = [];
  socket.on('error', () => {});
  socket.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\r\n')) {
      const end = buffer.indexOf('\r\n');
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (inData) {
        if (line !== '.') { content.push(line.replace(/^\.\./, '.')); continue; }
        const body = content.join('\r\n').replace(/=\r\n/g, '').replace(/=([A-F0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        messages.push({ to: recipients, body });
        if (messages.length > 100) messages.shift();
        inData = false; content = []; recipients = [];
        socket.write('250 Message received\r\n');
      } else if (/^(EHLO|HELO)\b/i.test(line)) socket.write('250-secureshare-e2e\r\n250 8BITMIME\r\n');
      else if (/^RCPT TO:/i.test(line)) {
        recipients.push(line.match(/<([^>]+)>/)?.[1] || '');
        socket.write('250 Recipient accepted\r\n');
      } else if (/^DATA$/i.test(line)) {
        inData = true; socket.write('354 End with a dot\r\n');
      } else if (/^QUIT$/i.test(line)) socket.end('221 Goodbye\r\n');
      else socket.write('250 OK\r\n');
    }
  });
});
smtp.listen(Number(process.env.SMTP_PORT || 8124), '127.0.0.1');
http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(url.pathname === '/messages' ? messages.filter((mail) => mail.to.includes(url.searchParams.get('to'))) : { status: 'ok' }));
}).listen(Number(process.env.MAILBOX_PORT || 8123), '127.0.0.1');
