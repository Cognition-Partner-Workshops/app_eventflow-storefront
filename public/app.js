// EventFlow Storefront
// Backend URL is injected at container startup via env substitution
const API_BASE = window.__ENV__?.API_BASE || '%%API_BASE%%';

let selectedCurrency = 'USD';
let cart = {}; // { productId: quantity }

// ── Currency toggle ──
function setCurrency(currency) {
  selectedCurrency = currency;
  document.querySelectorAll('.currency-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.currency === currency);
  });
  // Update displayed prices
  document.querySelectorAll('.product-card').forEach(card => {
    const priceEl = card.querySelector('.product-price');
    priceEl.textContent = currency === 'USD' ? priceEl.dataset.usd : priceEl.dataset.jpy;
  });
  updateSummary();
}

// ── Quantity controls ──
function changeQty(btn, delta) {
  const card = btn.closest('.product-card');
  const productId = card.dataset.productId;
  const qtyEl = card.querySelector('.qty-value');
  let qty = parseInt(qtyEl.textContent) + delta;
  if (qty < 0) qty = 0;
  if (qty > 10) qty = 10;
  qtyEl.textContent = qty;

  if (qty > 0) {
    cart[productId] = qty;
    card.classList.add('selected');
  } else {
    delete cart[productId];
    card.classList.remove('selected');
  }
  updateSummary();
}

// ── Order summary ──
function updateSummary() {
  const container = document.getElementById('summary-items');
  const totalEl = document.getElementById('summary-total-value');
  const btn = document.getElementById('place-order-btn');
  const items = getCartItems();

  if (items.length === 0) {
    container.innerHTML = '<p class="empty-cart">No items selected</p>';
    totalEl.textContent = selectedCurrency === 'USD' ? '$0.00' : '\u00a50';
    btn.disabled = true;
    return;
  }

  let total = 0;
  container.innerHTML = items.map(item => {
    const lineTotal = item.unit_price * item.quantity;
    total += lineTotal;
    const display = selectedCurrency === 'USD'
      ? '$' + (lineTotal / 100).toFixed(2)
      : '\u00a5' + lineTotal.toLocaleString();
    return `<div class="summary-item">
      <span class="item-name">${item.name} x${item.quantity}</span>
      <span class="item-price">${display}</span>
    </div>`;
  }).join('');

  totalEl.textContent = selectedCurrency === 'USD'
    ? '$' + (total / 100).toFixed(2)
    : '\u00a5' + total.toLocaleString();

  btn.disabled = false;
}

function getCartItems() {
  const items = [];
  document.querySelectorAll('.product-card').forEach(card => {
    const qty = parseInt(card.querySelector('.qty-value').textContent);
    if (qty > 0) {
      const priceKey = selectedCurrency === 'USD' ? 'priceUsd' : 'priceJpy';
      items.push({
        product_id: card.dataset.productId,
        name: card.dataset.name,
        quantity: qty,
        unit_price: parseInt(card.dataset[priceKey])
      });
    }
  });
  return items;
}

// ── Place order ──
async function placeOrder() {
  const btn = document.getElementById('place-order-btn');
  const btnText = btn.querySelector('.btn-text');
  const btnSpinner = btn.querySelector('.btn-spinner');

  btn.disabled = true;
  btn.classList.add('loading');
  btnText.style.display = 'none';
  btnSpinner.style.display = 'flex';

  const items = getCartItems();
  const payload = {
    customer_id: document.getElementById('customer-id').value,
    currency: selectedCurrency,
    items: items
  };

  try {
    // Submit the order to the order service
    const orderRes = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!orderRes.ok) {
      throw new Error(`Order service returned ${orderRes.status}`);
    }

    const order = await orderRes.json();

    // Poll order status — payment service processes async via Service Bus
    // and calls back to update the order status
    const finalOrder = await pollOrderStatus(order.order_id);
    if (finalOrder && finalOrder.status === 'completed') {
      showSuccess(finalOrder);
    } else {
      showError(
        order.order_id,
        'ERR_PAYMENT_PROCESSING_FAILED',
        'Unable to process order — the downstream payment processor was unable to complete your transaction.'
      );
    }
  } catch (err) {
    showError(null, 'ERR_SERVICE_UNAVAILABLE', err.message);
  } finally {
    btn.classList.remove('loading');
    btnText.style.display = 'inline';
    btnSpinner.style.display = 'none';
    btn.disabled = false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollOrderStatus(orderId) {
  // Poll the order service for status updates
  // Payment service calls back to update order status after processing
  const maxAttempts = 15;
  const intervalMs = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs);
    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}`);
      if (res.ok) {
        const order = await res.json();
        if (order.status !== 'pending') {
          return order;
        }
      }
    } catch (e) {
      // ignore fetch errors, keep polling
    }
  }
  // Timed out — order still pending (payment service likely crashed)
  return null;
}

// ── Results ──
function showSuccess(order) {
  document.getElementById('step-products').style.display = 'none';
  document.getElementById('step-checkout').style.display = 'none';
  document.getElementById('result-section').style.display = 'block';
  document.getElementById('result-success').style.display = 'block';
  document.getElementById('result-error').style.display = 'none';

  const total = selectedCurrency === 'USD'
    ? '$' + (order.amount / 100).toFixed(2)
    : '\u00a5' + order.amount.toLocaleString();

  document.getElementById('success-detail').textContent =
    `Your order has been placed and payment is being processed.`;

  document.getElementById('success-meta').innerHTML =
    `<strong>Order ID:</strong> ${order.order_id}<br>` +
    `<strong>Amount:</strong> ${total} ${order.currency}<br>` +
    `<strong>Status:</strong> ${order.status}<br>` +
    `<strong>Created:</strong> ${new Date(order.created_at).toLocaleString()}`;

  loadOrders();
}

function showError(orderId, code, detail) {
  document.getElementById('step-products').style.display = 'none';
  document.getElementById('step-checkout').style.display = 'none';
  document.getElementById('result-section').style.display = 'block';
  document.getElementById('result-success').style.display = 'none';
  document.getElementById('result-error').style.display = 'block';

  let errorInfo = `Error Code: ${code}\nTimestamp: ${new Date().toISOString()}`;
  if (orderId) {
    errorInfo += `\nOrder ID: ${orderId}`;
  }
  errorInfo += `\n\nPlease contact support if this issue persists.\nReference: ${code}-${Date.now().toString(36).toUpperCase()}`;

  document.getElementById('error-code').textContent = errorInfo;

  loadOrders();
}

function resetForm() {
  document.getElementById('step-products').style.display = 'block';
  document.getElementById('step-checkout').style.display = 'block';
  document.getElementById('result-section').style.display = 'none';

  // Reset cart
  cart = {};
  document.querySelectorAll('.product-card').forEach(card => {
    card.querySelector('.qty-value').textContent = '0';
    card.classList.remove('selected');
  });
  updateSummary();
}

// ── Order History ──
async function loadOrders() {
  const container = document.getElementById('orders-list');
  try {
    const res = await fetch(`${API_BASE}/api/orders?limit=10`);
    if (!res.ok) throw new Error('Failed to fetch');
    const orders = await res.json();

    if (!orders.length) {
      container.innerHTML = '<p class="empty-orders">No orders yet. Place your first order above!</p>';
      return;
    }

    container.innerHTML = `
      <div class="order-row" style="font-weight:600; color:#64748b; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #e2e8f0;">
        <span>Order ID</span>
        <span>Currency</span>
        <span>Amount</span>
        <span style="text-align:right">Status</span>
      </div>
    ` + orders.map(o => {
      const amt = o.currency === 'USD'
        ? '$' + (o.amount / 100).toFixed(2)
        : '\u00a5' + o.amount.toLocaleString();
      return `<div class="order-row">
        <span class="order-id">${o.order_id.substring(0, 8)}...</span>
        <span class="order-currency">${o.currency}</span>
        <span class="order-amount">${amt}</span>
        <span class="order-status"><span class="status-badge status-${o.status}">${o.status}</span></span>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="empty-orders">Could not load orders</p>';
  }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  // Detect team from URL or env
  const hostname = window.location.hostname;
  const teamMatch = hostname.match(/team(\d+)/);
  if (teamMatch) {
    document.getElementById('team-badge').textContent = `Team ${teamMatch[1]}`;
    document.getElementById('customer-id').value = `team${teamMatch[1]}-user`;
  }

  updateSummary();
  loadOrders();
});

// Expose functions to global scope for onclick handlers
window.setCurrency = setCurrency;
window.changeQty = changeQty;
window.placeOrder = placeOrder;
window.resetForm = resetForm;
window.loadOrders = loadOrders;
