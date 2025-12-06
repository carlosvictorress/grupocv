const http = require('http');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const port = 8080;
const root = __dirname;

function send(res, status, body, type = 'text/plain') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}

function serveIndex(res) {
  // CORREÇÃO CRÍTICA: Altera 'landinpage.html' para 'index.html'
  const filePath = path.join(root, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
        console.error("Erro ao ler index.html:", err);
        return send(res, 500, 'Erro interno: Arquivo index.html não encontrado ou ilegível');
    }
    send(res, 200, data, 'text/html; charset=utf-8');
  });
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
  
  if (!host || !user || !pass) {
      console.warn("Aviso: Variáveis de ambiente SMTP não configuradas. E-mails não serão enviados.");
      return null;
  }
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

// Função adaptada para incluir os novos campos de qualificação
function buildMail(data) {
  const to = process.env.EMAIL_TO || 'carlosvictor.pessoal@gmail.com';
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost';
  const subject = `Nova solicitação de demonstração - ${data.municipio || 'Município'}`;
  
  const text = `
    Município: ${data.municipio}
    Nome: ${data.nome}
    Cargo: ${data.cargo || 'Não informado'}
    População: ${data.populacao || 'Não informada'}
    Telefone: ${data.telefone}
    E-mail: ${data.email}
    Área Prioritária: ${data.prioridade || 'Não informada'}
    Mensagem: ${data.mensagem || ''}
  `.trim();
  
  const html = `
    <strong>Município:</strong> ${data.municipio}<br/>
    <strong>Nome:</strong> ${data.nome}<br/>
    <strong>Cargo:</strong> ${data.cargo || 'Não informado'}<br/>
    <strong>População:</strong> ${data.populacao || 'Não informada'}<br/>
    <strong>Telefone:</strong> ${data.telefone}<br/>
    <strong>E-mail:</strong> ${data.email}<br/>
    <strong>Área Prioritária:</strong> ${data.prioridade || 'Não informada'}<br/>
    <strong>Mensagem:</strong> ${data.mensagem || ''}
  `;
  return { from, to, subject, text, html };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  
  // Servir o novo index.html
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return serveIndex(res);
  }
  
  // API para formulário de Contato
  if (req.method === 'POST' && url.pathname === '/api/contact') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        // Campos obrigatórios (essenciais para o lead)
        const required = ['municipio', 'nome', 'telefone', 'email'];
        
        // Validação básica
        for (const k of required) {
          if (!data[k] || String(data[k]).trim() === '') {
             return send(res, 400, JSON.stringify({ ok: false, error: `Campo obrigatório ausente: ${k}` }), 'application/json');
          }
        }
        
        // Adaptação dos campos de qualificação
        const entry = { 
            ...data, 
            cargo: data.cargo || '',
            populacao: data.populacao || '',
            prioridade: data.prioridade || '',
            timestamp: new Date().toISOString(), 
            ip: req.socket.remoteAddress 
        };
        
        // Registro no arquivo submissions.jsonl
        fs.appendFile(path.join(root, 'submissions.jsonl'), JSON.stringify(entry) + '\n', err => {
          if (err) return send(res, 500, JSON.stringify({ ok: false, log: 'falha no arquivo' }), 'application/json');
          
          // Envio de E-mail
          const transporter = getTransporter();
          if (!transporter) return send(res, 200, JSON.stringify({ ok: true, delivered: false, warn: 'smtp nao configurado' }), 'application/json');
          
          transporter.sendMail(buildMail(entry), (mailErr, info) => {
            if (mailErr) return send(res, 200, JSON.stringify({ ok: true, delivered: false, warn: 'erro ao enviar email' }), 'application/json');
            send(res, 200, JSON.stringify({ ok: true, delivered: true }), 'application/json');
          });
        });
      } catch (e) {
        send(res, 400, JSON.stringify({ ok: false, error: 'JSON inválido' }), 'application/json');
      }
    });
    return;
  }
  
  // API para o Chat Widget
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        if (!data.text || String(data.text).trim() === '') return send(res, 400, JSON.stringify({ ok: false }), 'application/json');
        
        const entry = { session: data.session || '', name: data.name || '', email: data.email || '', text: data.text, ts: data.ts || new Date().toISOString(), ip: req.socket.remoteAddress };
        
        // Registro no arquivo chat.jsonl
        fs.appendFile(path.join(root, 'chat.jsonl'), JSON.stringify(entry) + '\n', err => {
          if (err) return send(res, 500, JSON.stringify({ ok: false, log: 'falha no arquivo' }), 'application/json');
          
          // Envio de E-mail de Notificação de Chat
          const transporter = getTransporter();
          if (!transporter) return send(res, 200, JSON.stringify({ ok: true, delivered: false, warn: 'smtp nao configurado' }), 'application/json');
          
          const mail = {
            from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@localhost',
            to: process.env.EMAIL_TO || 'carlosvictor.pessoal@gmail.com',
            subject: `Novo chat - ${entry.name || 'Visitante'}`,
            text: `Sessão: ${entry.session}\nNome: ${entry.name}\nEmail: ${entry.email}\nMensagem: ${entry.text}`,
            html: `<strong>Sessão:</strong> ${entry.session}<br/><strong>Nome:</strong> ${entry.name}<br/><strong>Email:</strong> ${entry.email}<br/><strong>Mensagem:</strong> ${entry.text}`
          };
          
          transporter.sendMail(mail, (mailErr) => {
            if (mailErr) return send(res, 200, JSON.stringify({ ok: true, delivered: false, warn: 'erro ao enviar email' }), 'application/json');
            send(res, 200, JSON.stringify({ ok: true, delivered: true }), 'application/json');
          });
        });
      } catch (_e) {
        send(res, 400, JSON.stringify({ ok: false }), 'application/json');
      }
    });
    return;
  }
  
  // 404 para outras rotas
  send(res, 404, 'Não encontrado');
});

server.listen(port, () => {
  console.log(`Servidor em http://localhost:${port}/`);
});