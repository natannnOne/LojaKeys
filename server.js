import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

const root = fileURLToPath(new URL('.', import.meta.url));
const env = await loadEnv();
const port = Number(env.PORT || 4173);
const publicUrl = env.PUBLIC_URL || `http://localhost:${port}`;
const mercadoPagoToken = env.MERCADOPAGO_ACCESS_TOKEN;
const hasPublicCallback = /^https:\/\//i.test(publicUrl) && !/localhost|127\.0\.0\.1/i.test(publicUrl);
const products = JSON.parse(await readFile(join(root, 'products.json'), 'utf8'));
let inventory = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8'));
const emailTransport = nodemailer.createTransport({
  host: env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || ''
  }
});
const issuedKeys = new Set();
const deliveryLedger = [];
const requestBuckets = new Map();

export function getSafeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || '');
  const sensitivePatterns = [
    /MERCADOPAGO_ACCESS_TOKEN/i,
    /Unauthorized use of live credentials/i,
    /Credencial incompatível/i,
    /SMTP/i,
    /fetch\s*\(/i,
    /ECONN/i,
    /ENOTFOUND/i,
    /EAI_AGAIN/i
  ];
  if (sensitivePatterns.some(pattern => pattern.test(message))) {
    return 'Operação inválida ou indisponível no momento.';
  }
  return message || 'Operação inválida ou indisponível no momento.';
}

function checkRateLimit(key, maxRequests = 10, windowMs = 60000) {
  const now = Date.now();
  const bucket = requestBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  requestBuckets.set(key, bucket);
  if (bucket.count > maxRequests) {
    throw new Error('Muitas requisições. Tente novamente em alguns instantes.');
  }
}

async function refreshInventory() {
  inventory = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8'));
  return inventory;
}
const pendingOrders = new Map();
const completedDeliveries = new Map();

const catalog = Object.fromEntries(products.map(product => [product.id, {
  name: product.name,
  price: product.price,
  category: product.category
}]));

export function resetDeliveryState() {
  issuedKeys.clear();
  deliveryLedger.length = 0;
}

export async function issueSteamKey(productId) {
  const stock = inventory[String(productId)];
  if (!Array.isArray(stock) || stock.length === 0) {
    throw new Error(`Estoque esgotado para ${catalog[productId]?.name || productId}.`);
  }
  const key = String(stock.shift()).trim();
  if (!key || issuedKeys.has(key)) {
    throw new Error(`Código inválido ou já utilizado no estoque de ${productId}.`);
  }
  issuedKeys.add(key);
  await writeFile(join(root, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  return key;
}

export async function sendDeliveredKeysByEmail(email, delivered) {
  if (!email || !Array.isArray(delivered) || delivered.length === 0) return false;
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('SMTP não configurado; envio de e-mail desativado.');
    return false;
  }

  const list = delivered
    .map(item => `• ${item.productName}: ${item.key}`)
    .join('\n');

  await emailTransport.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: email,
    subject: 'Sua Steam key foi liberada - Lobo Vendas',
    text: `Olá!\n\nSeu pedido foi confirmado e sua(s) key(s) está(ão) abaixo:\n\n${list}\n\nAproveite!\n\nLobo Vendas`,
    html: `<p>Olá!</p><p>Seu pedido foi confirmado e sua(s) key(s) está(ão) abaixo:</p><pre>${list}</pre><p>Aproveite!</p><p>Lobo Vendas</p>`
  });

  return true;
}

function createPeripheralReceiptPdf({ payment, items, metadata }) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ margin: 48 });
    const chunks = [];
    document.on('data', chunk => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);

    document.fontSize(20).text('LOBO VENDAS', { align: 'center' });
    document.moveDown(0.5).fontSize(14).text('Comprovante de compra', { align: 'center' });
    document.moveDown();
    document.fontSize(10).text(`Pedido: ${payment?.id || 'N/A'}`);
    document.text(`Data: ${new Date().toLocaleString('pt-BR')}`);
    document.text(`E-mail: ${metadata.email}`);
    document.moveDown();
    document.fontSize(12).text('Produtos', { underline: true });
    document.moveDown(0.3);
    items.forEach(item => {
      document.fontSize(10).text(`${item.title} - ${item.quantity} x R$ ${item.unit_price.toFixed(2).replace('.', ',')}`);
    });
    document.moveDown();
    document.text(`Frete estimado: R$ ${Number(metadata.shippingEstimate || 0).toFixed(2).replace('.', ',')}`);
    document.text(`Total: R$ ${Number(payment?.transaction_amount || 0).toFixed(2).replace('.', ',')}`);
    document.moveDown();
    document.fontSize(12).text('Dados de entrega', { underline: true });
    document.moveDown(0.3).fontSize(10);
    document.text(`Endereço: ${metadata.address}`);
    document.text(`CEP: ${metadata.cep}`);
    document.text(`CPF: ${metadata.cpf}`);
    document.text(`Telefone: ${metadata.phone}`);
    document.moveDown();
    document.fontSize(9).fillColor('#555').text('Este documento é um comprovante de compra e não substitui uma nota fiscal eletrônica.', { align: 'center' });
    document.end();
  });
}

export async function sendPeripheralReceiptByEmail(email, payment, items, metadata) {
  if (!email || !Array.isArray(items) || items.length === 0 || !metadata?.address) return false;
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    console.warn('SMTP não configurado; envio do comprovante desativado.');
    return false;
  }

  const pdf = await createPeripheralReceiptPdf({ payment, items, metadata });
  await emailTransport.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: email,
    subject: 'Comprovante da sua compra - Lobo Vendas',
    text: 'Seu comprovante de compra de periféricos está anexado em PDF.',
    attachments: [{ filename: `comprovante-${payment?.id || 'pedido'}.pdf`, content: pdf, contentType: 'application/pdf' }]
  });
  return true;
}

export async function grantDeliveryForPayment(payment) {
  const paymentId = payment?.id || null;
  if (paymentId && completedDeliveries.has(String(paymentId))) {
    return completedDeliveries.get(String(paymentId));
  }
  const paymentStatus = String(payment?.status || '').toLowerCase();
  const storedOrder = paymentId ? pendingOrders.get(String(paymentId)) : null;
  const metadataRaw = payment?.metadata?.cart || payment?.metadata?.items || storedOrder?.cart || '[]';
  const deliveryEmail = storedOrder?.email || payment?.metadata?.email || payment?.payer?.email;
  let cart = [];
  try {
    cart = JSON.parse(metadataRaw);
  } catch {
    cart = [];
  }

  if (!['approved', 'processed'].includes(paymentStatus) || !Array.isArray(cart) || cart.length === 0) {
    return { status: paymentStatus || 'pending', delivered: [], paymentId };
  }

  const orderItems = calculateOrder(cart);
  const orderMetadata = payment?.metadata || {};
  const hasPeripheral = orderItems.some(item => catalog[item.id]?.category === 'gear');

  const delivered = [];
  for (const item of cart) {
    const normalizedId = resolveProductId(item.id);
    const productId = String(normalizedId || '');
    const quantity = Number(item.quantity || 1);
    const product = catalog[productId];
    if (!product || product.category !== 'steam' || !Number.isFinite(quantity) || quantity < 1) continue;

    for (let index = 0; index < quantity; index += 1) {
      const key = await issueSteamKey(productId);
      const entry = {
        productId,
        productName: product.name,
        key,
        amount: product.price,
        deliveredAt: new Date().toISOString()
      };
      delivered.push(entry);
      deliveryLedger.push({ paymentId: payment?.id || null, ...entry });
    }
  }

  if (delivered.length > 0 && deliveryEmail) {
    await sendDeliveredKeysByEmail(deliveryEmail, delivered);
  }
  if (hasPeripheral && deliveryEmail) {
    await sendPeripheralReceiptByEmail(deliveryEmail, payment, orderItems, orderMetadata);
  }

  const result = { status: paymentStatus, delivered, paymentId };
  if (paymentId) {
    completedDeliveries.set(String(paymentId), result);
    pendingOrders.delete(String(paymentId));
  }
  return result;
}

export function applySecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Download-Options', 'noopen');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (/^https:/i.test(publicUrl)) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
    "base-uri 'self'; " +
    "object-src 'none'; " +
    "img-src 'self' data: https:; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com; " +
    "script-src 'self'; " +
    "connect-src 'self' https://api.mercadopago.com; " +
    "frame-src 'self' https://www.mercadopago.com; " +
    "form-action 'self' https://wa.me; " +
    "upgrade-insecure-requests"
  );
}

export function ensureRequestMethod(request, allowedMethods) {
  const methods = new Set((allowedMethods || []).map(method => String(method).toUpperCase()));
  return methods.has(String(request.method || '').toUpperCase());
}

export function validateWebhookRequest(request, rawBody = '', secretOverride = env.MERCADOPAGO_WEBHOOK_SECRET) {
  const contentType = String(request.headers['content-type'] || '');
  if (contentType && !/^application\/json\b/i.test(contentType)) {
    throw new Error('Webhook inválido.');
  }
  const webhookSecret = String(secretOverride || '').trim();
  if (!webhookSecret) {
    return true;
  }
  const signature = request.headers['x-signature'] || request.headers['x-mercadopago-signature'];
  if (!signature || !String(signature).trim()) {
    throw new Error('Assinatura do webhook ausente.');
  }
  const expectedSignature = createHmac('sha256', webhookSecret).update(rawBody || '').digest('hex');
  if (String(signature).trim() !== expectedSignature) {
    throw new Error('Assinatura do webhook inválida.');
  }
  return true;
}

function json(response, status, body) {
  applySecurityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function jsonError(response, status, error) {
  json(response, status, { error: getSafeErrorMessage(error) });
}

async function loadEnv() {
  const values = {};
  try {
    const contents = await readFile(join(root, '.env'), 'utf8');
    for (const line of contents.split('\n')) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Environment variables supplied by the hosting platform are still supported.
  }
  return { ...values, ...process.env };
}

async function readRawBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBody(request) {
  const rawBody = await readRawBody(request);
  return JSON.parse(rawBody || '{}');
}

export function sanitizeCartItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && typeof item === 'object' && !!catalog[item.id])
    .map(item => {
      const quantity = Number(item.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return null;
      return { id: String(item.id), quantity };
    })
    .filter(Boolean);
}

export function calculateShippingEstimate(items = [], cep = '') {
  const hasGear = Array.isArray(items) && items.some(item => {
    const product = catalog[String(item.id)];
    return Boolean(product && product.category === 'gear');
  });
  if (!hasGear) return 0;
  const digits = String(cep || '').replace(/\D/g, '');
  const premiumRegions = ['70', '71', '72', '73', '74', '75', '76', '77', '78', '79'];
  const value = premiumRegions.some(prefix => digits.startsWith(prefix)) ? 39.9 : 29.9;
  return Number(value.toFixed(2));
}

function resolveProductId(id) {
  return String(id);
}

function calculateOrder(items) {
  const sanitizedItems = sanitizeCartItems(items).map(item => ({ ...item, id: resolveProductId(item.id) }));
  if (sanitizedItems.length === 0) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('Carrinho vazio.');
    throw new Error('Item inválido no carrinho.');
  }
  return sanitizedItems.map(item => {
    const product = catalog[item.id];
    return { id: item.id, title: product.name, unit_price: product.price, quantity: item.quantity };
  });
}

async function mercadoPago(path, options) {
  if (!mercadoPagoToken || mercadoPagoToken === 'SEU_TOKEN_DO_MERCADO_PAGO') throw new Error('MERCADOPAGO_ACCESS_TOKEN não configurado.');
  const requestOptions = options || {};
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...requestOptions,
    headers: { Authorization: `Bearer ${mercadoPagoToken}`, 'Content-Type': 'application/json', ...(requestOptions.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.message === 'Unauthorized use of live credentials') throw new Error('Credencial incompatível: use um token TEST- com usuário de teste ou um token APP_USR- com conta e pagador reais.');
    throw new Error(data.message || data.error || 'Mercado Pago recusou a operação.');
  }
  return data;
}

async function createPayment(request, response) {
  const body = await readBody(request);
  const email = String(body.email || '').trim();
  const method = body.method === 'card' ? 'card' : 'pix';
  const items = calculateOrder(body.items);
  const requiresAddressData = items.some(item => catalog[String(item.id)]?.category === 'gear');
  const address = String(body.address || '').trim();
  const cep = String(body.cep || '').trim();
  const cpf = String(body.cpf || '').trim();
  const phone = String(body.phone || '').trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Informe um e-mail válido.');
  if (requiresAddressData && (!address || !cep || !cpf || !phone)) {
    throw new Error('Para compras de periféricos, informe endereço, CEP, CPF e telefone.');
  }
  const shippingEstimate = calculateShippingEstimate(items, cep);
  const total = Number((items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0) + shippingEstimate).toFixed(2));
  const externalReference = randomUUID();
  const metadata = {
    email,
    cart: JSON.stringify(items.map(item => ({ id: item.id, quantity: item.quantity }))),
    ...(requiresAddressData ? { address, cep, cpf, phone, shippingEstimate } : {})
  };

  if (method === 'pix') {
    const paymentBody = {
      transaction_amount: total,
      description: `Lobo Vendas - ${items.map(item => item.title).join(', ')}`,
      payment_method_id: 'pix',
      external_reference: externalReference,
      payer: { email },
      metadata
    };
    if (hasPublicCallback) paymentBody.notification_url = `${publicUrl}/api/payments/webhook`;
    const payment = await mercadoPago('/v1/payments', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': externalReference },
      body: JSON.stringify(paymentBody)
    });
    pendingOrders.set(String(payment.id), { email, cart: metadata.cart });
    const delivery = await grantDeliveryForPayment(payment);
    return json(response, 201, {
      method,
      id: payment.id,
      status: payment.status,
      qrCode: payment.point_of_interaction?.transaction_data?.qr_code,
      qrCodeBase64: payment.point_of_interaction?.transaction_data?.qr_code_base64,
      ticketUrl: payment.point_of_interaction?.transaction_data?.ticket_url,
      shippingEstimate,
      totalAmount: total,
      keys: delivery.delivered.map(entry => entry.key)
    });
  }

  const preferenceBody = {
    items: items.map(item => ({ title: item.title, quantity: item.quantity, unit_price: item.unit_price, currency_id: 'BRL' })),
    payer: { email },
    external_reference: externalReference,
    metadata
  };
  if (hasPublicCallback) Object.assign(preferenceBody, {
    notification_url: `${publicUrl}/api/payments/webhook`,
    back_urls: { success: publicUrl, failure: publicUrl, pending: publicUrl },
    auto_return: 'approved'
  });
  const preference = await mercadoPago('/checkout/preferences', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': externalReference },
    body: JSON.stringify(preferenceBody)
  });
  return json(response, 201, { method, id: preference.id, checkoutUrl: preference.init_point, shippingEstimate, totalAmount: total });
}

async function handle(request, response) {
  try {
    const routeKey = request.url.split('?')[0];
    if (routeKey === '/api/payments/create' || routeKey === '/api/payments/webhook') {
      checkRateLimit(`${request.method}:${routeKey}:${request.headers['x-forwarded-for'] || request.socket.remoteAddress || 'unknown'}`, 15, 60000);
    }

    if (routeKey === '/api/payments/create' && !ensureRequestMethod(request, ['POST'])) return jsonError(response, 405, new Error('Método não permitido.'));
    if (routeKey === '/api/payments/webhook' && !ensureRequestMethod(request, ['POST'])) return jsonError(response, 405, new Error('Método não permitido.'));
    if (routeKey === '/api/health' && !ensureRequestMethod(request, ['GET'])) return jsonError(response, 405, new Error('Método não permitido.'));
    if (routeKey === '/api/stock' && !ensureRequestMethod(request, ['GET'])) return jsonError(response, 405, new Error('Método não permitido.'));
    if (routeKey.startsWith('/api/payments/status') && !ensureRequestMethod(request, ['GET'])) return jsonError(response, 405, new Error('Método não permitido.'));

    if (request.url === '/api/payments/create' && request.method === 'POST') return await createPayment(request, response);
    if (request.url === '/api/payments/webhook' && request.method === 'POST') {
      const rawBody = await readRawBody(request);
      validateWebhookRequest(request, rawBody);
      const body = JSON.parse(rawBody || '{}');
      const paymentId = body?.data?.id || body?.id;
      console.log('Mercado Pago webhook recebido:', JSON.stringify(body));
      if (!paymentId) return json(response, 200, { received: true });
      const payment = await mercadoPago(`/v1/payments/${paymentId}`);
      await refreshInventory();
      const delivery = await grantDeliveryForPayment(payment);
      return json(response, 200, { received: true, delivery });
    }
    if (request.url === '/api/health' && request.method === 'GET') return json(response, 200, { ok: true, payments: Boolean(mercadoPagoToken) });
    if (request.url === '/api/stock' && request.method === 'GET') {
      await refreshInventory();
      return json(response, 200, Object.fromEntries(products.map(product => [product.id, inventory[product.id]?.length || 0])));
    }
    if (request.url.startsWith('/api/payments/status') && request.method === 'GET') {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const paymentId = url.searchParams.get('paymentId');
      if (!paymentId) return jsonError(response, 400, new Error('paymentId obrigatório.'));
      const payment = await mercadoPago(`/v1/payments/${paymentId}`);
      await refreshInventory();
      const delivery = await grantDeliveryForPayment(payment);
      return json(response, 200, {
        paymentId,
        status: payment.status,
        ready: ['approved', 'processed'].includes(String(payment.status || '').toLowerCase()),
        delivered: delivery.delivered
      });
    }
    if (request.method !== 'GET') return jsonError(response, 405, new Error('Método não permitido.'));
    if (request.url === '/LojaKeys-download.zip') {
      const archive = await readFile(join(root, 'LojaKeys-download.zip'));
      response.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="LojaKeys-download.zip"',
        'Content-Length': archive.length
      });
      return response.end(archive);
    }
    const requestedPath = request.url === '/' ? '/index.html' : request.url.split('?')[0];
    const filePath = normalize(join(root, requestedPath));
    if (!filePath.startsWith(root)) return jsonError(response, 403, new Error('Acesso negado.'));
    const contents = await readFile(filePath);
    const contentTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
    applySecurityHeaders(response);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream' });
    response.end(contents);
  } catch (error) {
    console.error('Erro de requisição:', getSafeErrorMessage(error));
    jsonError(response, 400, error);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createServer(handle).listen(port, () => console.log(`Lobo Vendas em ${publicUrl}`));
}

export { catalog, deliveryLedger, inventory };
