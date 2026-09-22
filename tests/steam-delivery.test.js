import test from 'node:test';
import assert from 'node:assert/strict';

import { inventory, issueSteamKey, grantDeliveryForPayment, resetDeliveryState } from '../server.js';

test('issueSteamKey nunca repete a mesma key', async () => {
  resetDeliveryState();
  inventory['marvels-spider-man-2'] = ['TEST-ONE', 'TEST-TWO'];
  const first = await issueSteamKey('marvels-spider-man-2');
  const second = await issueSteamKey('marvels-spider-man-2');

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first, second);
});

test('grantDeliveryForPayment entrega keys quando o pagamento é aprovado', async () => {
  resetDeliveryState();
  inventory['marvels-spider-man-2'] = ['TEST-SPIDER'];
  inventory['elden-ring'] = ['TEST-ELDEN'];

  const result = await grantDeliveryForPayment({
    status: 'approved',
    metadata: {
      cart: JSON.stringify([
        { id: 'marvels-spider-man-2', quantity: 1 },
        { id: 'elden-ring', quantity: 1 }
      ])
    }
  });

  assert.equal(result.status, 'approved');
  assert.equal(result.delivered.length, 2);
  assert.ok(result.delivered.every(entry => typeof entry.key === 'string' && entry.key.length > 8));
});

test('grantDeliveryForPayment não duplica a entrega do mesmo pagamento', async () => {
  resetDeliveryState();
  inventory['marvels-spider-man-2'] = ['TEST-IDEMPOTENT'];
  const payment = {
    id: 'payment-idempotent-test',
    status: 'approved',
    metadata: {
      cart: JSON.stringify([{ id: 'marvels-spider-man-2', quantity: 1 }])
    }
  };

  const first = await grantDeliveryForPayment(payment);
  const second = await grantDeliveryForPayment(payment);

  assert.equal(first.delivered[0].key, second.delivered[0].key);
});
