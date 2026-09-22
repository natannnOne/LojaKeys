const PAYMENT_API = '/api/payments/create';
let reviews = [];
let reviewIndex = 0;
// A chave privada do provedor deve ficar somente no backend. O frontend usa apenas endpoints públicos.
let products = [];
let stockById = {};
const resolveProductId = id => {
  const lookup = {
    horizon: 'horizon-zero-down-remaster',
    'horizon-zero': 'horizon-zero-down-remaster',
    'horizon-zero-down': 'horizon-zero-down-remaster',
    'horizon-zero-down-remaster': 'horizon-zero-down-remaster'
  };
  return lookup[String(id)] || String(id);
};
const productById = id => products.find(product => product.id === resolveProductId(id));
const sanitizeCart = (items = []) => (Array.isArray(items) ? items.filter(item => item && productById(item.id)).map(item => ({ id: resolveProductId(item.id), quantity: Math.min(Math.max(Math.floor(Number(item.quantity) || 1), 1), 20) })) : []);
let cart = [];
let activeFilter = 'all';
const money = value => value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const calculateShippingEstimate = (items = [], cep = '') => {
  const hasGear = Array.isArray(items) && items.some(item => {
    const product = productById(item.id);
    return product && product.category === 'gear';
  });
  if (!hasGear) return 0;
  const digits = String(cep || '').replace(/\D/g, '');
  const premiumRegions = ['70', '71', '72', '73', '74', '75', '76', '77', '78', '79'];
  const value = premiumRegions.some(prefix => digits.startsWith(prefix)) ? 39.9 : 29.9;
  return Number(value.toFixed(2));
};
const grid = document.querySelector('#product-grid');
const toast = message => { const element = document.querySelector('#toast'); element.textContent = message; element.classList.add('show'); setTimeout(() => element.classList.remove('show'), 2300); };

function showReview(review) {
  if (!review) return;
  const quote = document.querySelector('#review-outdoor-quote');
  const author = document.querySelector('#review-outdoor-author');
  const content = document.querySelector('#review-outdoor-content');
  content.classList.remove('review-change');
  void content.offsetWidth;
  quote.textContent = `“${review.quote}”`;
  author.textContent = `${review.name} · ${review.product}`;
  content.classList.add('review-change');
}

async function initializeReviews() {
  const response = await fetch('/reviews.json');
  if (!response.ok) return;
  reviews = await response.json();
  showReview(reviews[0]);
  setInterval(() => {
    reviewIndex = (reviewIndex + 1) % reviews.length;
    showReview(reviews[reviewIndex]);
  }, 4500);
}

function updateFilterCounts() {
  const filterButtons = document.querySelectorAll('.filter');
  filterButtons.forEach(button => {
    const category = button.dataset.filter;
    const total = products.filter(product => category === 'all' ? true : product.category === category).length;
    const count = button.querySelector('span');
    if (count) count.textContent = total;
  });
}

function renderProducts() {
  const sort = document.querySelector('#sort-products').value;
  let visible = products.filter(product => activeFilter === 'all' || product.category === activeFilter);
  if (sort === 'price-low') visible.sort((a,b) => a.price - b.price);
  if (sort === 'price-high') visible.sort((a,b) => b.price - a.price);
  grid.innerHTML = visible.map(product => {
    const stock = stockById[product.id] || 0;
    const stockText = stock === 0 ? 'Esgotado' : `${stock} disponível${stock === 1 ? '' : 'is'}`;
    return `<article class="product-card ${product.category}"><div class="product-visual"><img src="${product.image}" alt="${product.name}" loading="lazy"><span class="product-badge">${product.badge}</span></div><div class="product-info"><div><h3>${product.name}</h3><p>${product.description}</p><p class="stock-label ${stock === 0 ? 'out-of-stock' : ''}">${stockText}</p></div><div class="product-price"><del>${money(product.oldPrice)}</del><strong>${money(product.price)}</strong></div><button class="add-button" data-add="${product.id}" ${stock === 0 ? 'disabled' : ''}>${stock === 0 ? 'Indisponível' : 'Adicionar ao carrinho'} <span>+</span></button></div></article>`;
  }).join('');
  grid.querySelectorAll('[data-add]').forEach(button => button.addEventListener('click', () => addToCart(button.dataset.add)));
}
function addToCart(id) { const line = cart.find(item => item.id === id); if (line) line.quantity += 1; else cart.push({id,quantity:1}); saveCart(); openCart(); toast('Item adicionado ao carrinho'); }
function saveCart() { cart = sanitizeCart(cart); localStorage.setItem('keyforge-cart', JSON.stringify(cart)); renderCart(); }
function cartTotal() { return cart.reduce((total,item) => { const product = productById(item.id); return total + (product ? product.price * item.quantity : 0); }, 0); }
function cartHasGear() {
  return cart.some(item => {
    const product = productById(item.id);
    return product && product.category === 'gear';
  });
}

function renderCheckoutShipping() {
  const shipping = calculateShippingEstimate(cart, document.querySelector('#checkout-cep')?.value || '');
  const shippingElement = document.querySelector('#checkout-shipping');
  const totalElement = document.querySelector('#checkout-total');
  const subtotal = cartTotal();
  if (shippingElement) shippingElement.textContent = money(shipping);
  if (totalElement) totalElement.textContent = money(subtotal + shipping);
}

function renderCart() {
  cart = sanitizeCart(cart);
  const items = document.querySelector('#cart-items'); const empty = document.querySelector('#cart-empty');
  document.querySelector('#cart-count').textContent = cart.reduce((sum,item) => sum + item.quantity, 0);
  document.querySelector('#cart-total').textContent = money(cartTotal());
  renderCheckoutShipping();
  items.innerHTML = cart.map(item => { const product = productById(item.id); if (!product) return ''; return `<div class="cart-item"><img src="${product.image}" alt=""><div><h3>${product.name}</h3><p>${money(product.price)} cada</p><div class="quantity-controls"><button data-minus="${product.id}">−</button><span>${item.quantity}</span><button data-plus="${product.id}">+</button></div></div><strong>${money(product.price * item.quantity)}</strong></div>`; }).join('');
  empty.classList.toggle('show', cart.length === 0); document.querySelector('#checkout-open').disabled = cart.length === 0;
  items.querySelectorAll('[data-minus]').forEach(button => button.addEventListener('click', () => changeQuantity(button.dataset.minus,-1)));
  items.querySelectorAll('[data-plus]').forEach(button => button.addEventListener('click', () => changeQuantity(button.dataset.plus,1)));
}
function changeQuantity(id, amount) { const line = cart.find(item => item.id === id); line.quantity += amount; if (line.quantity <= 0) cart = cart.filter(item => item.id !== id); saveCart(); }
function openCart() { document.querySelector('#cart-drawer').classList.add('open'); document.querySelector('#drawer-backdrop').classList.add('open'); document.querySelector('#cart-drawer').setAttribute('aria-hidden','false'); }
function closeCart() { document.querySelector('#cart-drawer').classList.remove('open'); document.querySelector('#drawer-backdrop').classList.remove('open'); document.querySelector('#cart-drawer').setAttribute('aria-hidden','true'); }
function updateCheckoutRequirements() {
  const needsShipping = cartHasGear();
  document.querySelectorAll('.shipping-field').forEach(field => {
    field.hidden = !needsShipping;
  });
  document.querySelector('#checkout-address').required = needsShipping;
  document.querySelector('#checkout-cep').required = needsShipping;
  document.querySelector('#checkout-cpf').required = needsShipping;
  document.querySelector('#checkout-phone').required = needsShipping;
  renderCheckoutShipping();
}

function openCheckout() { closeCart(); updateCheckoutRequirements(); document.querySelector('#checkout-modal').classList.add('open'); }
function closeCheckout() { document.querySelector('#checkout-modal').classList.remove('open'); document.querySelector('.checkout-modal').classList.remove('success'); document.querySelector('#checkout-form').reset(); document.querySelector('#payment-error').textContent = '⌁ Ambiente protegido · Mercado Pago'; updateCheckoutRequirements(); }

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { activeFilter = button.dataset.filter; document.querySelectorAll('.filter').forEach(tab => tab.classList.remove('active')); button.classList.add('active'); renderProducts(); }));
document.querySelector('#sort-products').addEventListener('change', renderProducts);
document.querySelector('#cart-open').addEventListener('click', openCart); document.querySelector('#cart-close').addEventListener('click', closeCart); document.querySelector('#drawer-backdrop').addEventListener('click', closeCart); document.querySelector('#checkout-open').addEventListener('click', openCheckout); document.querySelector('#checkout-close').addEventListener('click', closeCheckout); document.querySelector('#success-close').addEventListener('click', closeCheckout);
document.querySelectorAll('.payment-method').forEach(button => {
  button.setAttribute('aria-pressed', button.classList.contains('active') ? 'true' : 'false');
  button.addEventListener('click', event => {
    event.preventDefault();
    document.querySelectorAll('.payment-method').forEach(method => {
      method.classList.remove('active');
      method.setAttribute('aria-pressed', 'false');
    });
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
  });
});
async function waitForApprovedPayment(paymentId) {
  const maxAttempts = 60;
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch(`/api/payments/status?paymentId=${encodeURIComponent(paymentId)}`);
    const statusResult = await response.json();
    const paymentStatus = String(statusResult.status || '').toLowerCase();
    if (paymentStatus === 'approved' || paymentStatus === 'processed') {
      return statusResult;
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  return { status: 'pending', delivered: [] };
}

document.querySelector('#checkout-form').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  const email = event.currentTarget.querySelector('input[type="email"]').value;
  const method = document.querySelector('.payment-method.active').dataset.method;
  const address = document.querySelector('#checkout-address')?.value || '';
  const cep = document.querySelector('#checkout-cep')?.value || '';
  const cpf = document.querySelector('#checkout-cpf')?.value || '';
  const phone = document.querySelector('#checkout-phone')?.value || '';
  cart = sanitizeCart(cart);
  if (cart.length === 0) {
    document.querySelector('#payment-error').textContent = 'Erro: carrinho vazio ou com itens inválidos.';
    return;
  }
  const needsShipping = cartHasGear();
  if (needsShipping && (!address || !cep || !cpf || !phone)) {
    document.querySelector('#payment-error').textContent = 'Para periféricos, preencha endereço, CEP, CPF e telefone.';
    return;
  }
  submit.disabled = true;
  submit.firstChild.textContent = 'Processando... ';
  document.querySelector('#payment-error').textContent = '⌁ Comunicando com o Mercado Pago...';
  try {
    const payload = { email, method, items: cart };
    if (needsShipping) {
      payload.address = address;
      payload.cep = cep;
      payload.cpf = cpf;
      payload.phone = phone;
      payload.shippingEstimate = calculateShippingEstimate(cart, cep);
    }
    const response = await fetch(PAYMENT_API, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
    const payment = await response.json();
    if (!response.ok) throw new Error(payment.error || 'Não foi possível criar o pagamento.');
    if (payment.method === 'card') return window.location.assign(payment.checkoutUrl);
    document.querySelector('#pix-qr').src = `data:image/png;base64,${payment.qrCodeBase64}`;
    document.querySelector('#pix-code').textContent = payment.qrCode || '';
    document.querySelector('#payment-link').href = payment.ticketUrl || '#';
    document.querySelector('#payment-link').style.display = payment.ticketUrl ? 'inline-flex' : 'none';
    document.querySelector('#payment-message').textContent = 'Aguardando confirmação do pagamento...';
    document.querySelector('.checkout-modal').classList.add('success');

    const approved = await waitForApprovedPayment(payment.id);
    if (approved.delivered && approved.delivered.length > 0) {
      const keys = approved.delivered.map(item => item.key).join('\n');
      document.querySelector('#payment-message').textContent = 'Pagamento confirmado! Sua Steam key foi liberada abaixo.';
      document.querySelector('#pix-code').textContent = keys;
      document.querySelector('#pix-qr').style.display = 'none';
      document.querySelector('#payment-link').style.display = 'none';
      document.querySelector('#copy-pix').textContent = 'Copiar key(s)';
    } else {
      document.querySelector('#payment-message').textContent = 'Pagamento recebido, mas ainda aguardando confirmação do Mercado Pago.';
    }
  } catch (error) {
    document.querySelector('#payment-error').textContent = `Erro: ${error.message}`;
  } finally {
    submit.disabled = false;
    submit.firstChild.textContent = 'Gerar pagamento ';
  }
});
document.querySelector('#copy-pix').addEventListener('click', async () => {
  await navigator.clipboard.writeText(document.querySelector('#pix-code').textContent);
  toast('Código Pix copiado');
});
document.querySelector('#copy-steam-command').addEventListener('click', async () => {
  await navigator.clipboard.writeText(document.querySelector('#steam-command-text').textContent);
  toast('Comando copiado');
});
document.querySelector('#checkout-cep').addEventListener('input', renderCheckoutShipping);
document.querySelector('#newsletter-form').addEventListener('submit', event => { event.preventDefault(); event.currentTarget.reset(); toast('Você entrou para a lista de ofertas'); });
document.querySelector('.search-trigger').addEventListener('click', () => { document.querySelector('#catalogo').scrollIntoView(); toast('Use os filtros para encontrar seu próximo jogo'); });

async function initializeCatalog() {
  const [catalogResponse, stockResponse] = await Promise.all([fetch('/products.json'), fetch('/api/stock')]);
  if (!catalogResponse.ok || !stockResponse.ok) throw new Error('Não foi possível carregar o catálogo.');
  products = await catalogResponse.json();
  stockById = await stockResponse.json();
  try {
    cart = sanitizeCart(JSON.parse(localStorage.getItem('keyforge-cart') || '[]'));
  } catch {
    cart = [];
  }
  updateFilterCounts();
  renderProducts();
  renderCart();
}

async function refreshStock() {
  const response = await fetch('/api/stock', { cache: 'no-store' });
  if (!response.ok) return;
  stockById = await response.json();
  renderProducts();
}

initializeCatalog().catch(error => {
  grid.innerHTML = `<p class="catalog-error">${error.message}</p>`;
});
initializeReviews();
setInterval(() => refreshStock().catch(() => {}), 5000);