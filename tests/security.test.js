import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { applySecurityHeaders, calculateShippingEstimate, ensureRequestMethod, getSafeErrorMessage, validateWebhookRequest } from '../server.js';

test('applySecurityHeaders adiciona headers de segurança básicos', () => {
  const headers = {};
  const response = {
    setHeader: (key, value) => {
      headers[key] = value;
    }
  };

  applySecurityHeaders(response);

  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.ok(headers['Content-Security-Policy']);
  assert.equal(headers['Permissions-Policy'], 'geolocation=(), camera=(), microphone=()');
});

test('getSafeErrorMessage oculta detalhes internos em respostas públicas', () => {
  const message = getSafeErrorMessage(new Error('MERCADOPAGO_ACCESS_TOKEN não configurado.'));
  assert.equal(message, 'Operação inválida ou indisponível no momento.');
});

test('ensureRequestMethod restringe rotas a métodos permitidos', () => {
  const request = { method: 'GET' };
  assert.equal(ensureRequestMethod(request, ['POST']), false);
  assert.equal(ensureRequestMethod({ method: 'POST' }, ['POST']), true);
});

test('validateWebhookRequest aceita assinatura válida e rejeita inválida', () => {
  const payload = JSON.stringify({ data: { id: '123' } });
  const validSignature = createHmac('sha256', 'secret-prod').update(payload).digest('hex');
  const validRequest = {
    headers: {
      'content-type': 'application/json',
      'x-signature': validSignature
    }
  };

  assert.doesNotThrow(() => validateWebhookRequest(validRequest, payload, 'secret-prod'));
  assert.throws(() => validateWebhookRequest(validRequest, payload, 'wrong-secret'));
});

test('calculateShippingEstimate aplica frete somente para periféricos e inclui valor aproximado', () => {
  assert.equal(calculateShippingEstimate([], '01000000'), 0);
  assert.equal(calculateShippingEstimate([{ id: 'mouse-smailwolf-rs6', quantity: 1 }], '01000000'), 29.9);
  assert.equal(calculateShippingEstimate([{ id: 'mouse-smailwolf-rs6', quantity: 1 }], '70000000'), 39.9);
});
