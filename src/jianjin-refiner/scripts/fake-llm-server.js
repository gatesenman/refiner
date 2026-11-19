// 本地“坏模型”模拟服务（用于错误场景回归）：
//   /junk/v1/chat/completions  → 200，返回非 JSON 的拒答垃圾
//   /auth/v1/chat/completions  → 401 Invalid API key
//   /slow/v1/chat/completions  → 永不响应（测试超时）
//   /ok/v1/chat/completions    → 200，按请求返回合法 JSON（连接测试用）
const http = require('http');
const port = Number(process.argv[2] || 3931);
const JUNK = '抱歉我不太明白你的意思，哈哈 <<<not json>>>';
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const reply = (text) => send(200, { choices: [{ message: { role: 'assistant', content: text } }] });
    if (req.url.startsWith('/auth/')) return send(401, { error: { message: 'Invalid API key', type: 'invalid_request_error' } });
    if (req.url.startsWith('/slow/')) return; // hang
    if (req.url.startsWith('/junk/')) return reply(JUNK);
    if (req.url.startsWith('/ok/')) return reply('{"ok": true, "items": ["a", "b"]}');
    send(404, { error: { message: 'not found' } });
  });
}).listen(port, '127.0.0.1', () => console.log('fake llm on', port));
