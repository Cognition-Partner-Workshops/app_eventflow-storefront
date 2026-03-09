// EventFlow Operations Dashboard
const API_BASE = window.__ENV__?.API_BASE || '%%API_BASE%%';
const DEVIN_API_URL = '%%DEVIN_API_URL%%';
const DEVIN_API_KEY = '%%DEVIN_API_KEY%%';

let teamId = '';
let teamNumber = '';
let incidents = [];
let lastErrorOrder = null;

// ── Team Detection ──
function detectTeam() {
  const hostname = window.location.hostname;
  const teamMatch = hostname.match(/team(\d+)/);
  if (teamMatch) {
    teamNumber = teamMatch[1];
    teamId = `team${teamNumber}`;
    document.getElementById('team-badge').textContent = `Team ${teamNumber}`;
  }

  // Set service URLs in health cards
  const orderBase = API_BASE;
  const paymentBase = API_BASE.replace('ef-order-', 'ef-payment-');
  document.getElementById('order-url').textContent = orderBase;
  document.getElementById('payment-url').textContent = paymentBase;
  document.getElementById('storefront-url').textContent = window.location.origin;
}

// ── Health Checks ──
async function checkHealth() {
  // Check Order Service
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      setHealthStatus('order', 'healthy', 'Responding normally');
    } else {
      setHealthStatus('order', 'degraded', `Status: ${res.status}`);
    }
  } catch (e) {
    setHealthStatus('order', 'unhealthy', 'Connection failed');
  }

  // Check Payment Service
  const paymentBase = API_BASE.replace('ef-order-', 'ef-payment-');
  try {
    const res = await fetch(`${paymentBase}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      setHealthStatus('payment', 'healthy', 'Responding normally');
    } else {
      setHealthStatus('payment', 'degraded', `Status: ${res.status}`);
    }
  } catch (e) {
    setHealthStatus('payment', 'unhealthy', 'Connection failed');
  }

  updateSystemStatus();
}

function setHealthStatus(service, status, detail) {
  const badge = document.getElementById(`${service}-health-badge`);
  const detailEl = document.getElementById(`${service}-detail`);
  const card = document.getElementById(`health-${service}`);

  badge.textContent = status;
  badge.className = `health-badge health-${status}`;
  detailEl.textContent = detail;

  card.className = `health-card health-card-${status}`;
}

function updateSystemStatus() {
  const indicator = document.getElementById('system-status');
  const orderBadge = document.getElementById('order-health-badge');
  const paymentBadge = document.getElementById('payment-health-badge');

  const orderOk = orderBadge.textContent === 'healthy';
  const paymentOk = paymentBadge.textContent === 'healthy';

  if (orderOk && paymentOk) {
    indicator.innerHTML = '<span class="status-dot dot-healthy"></span> All Systems Operational';
  } else {
    indicator.innerHTML = '<span class="status-dot dot-error"></span> Issues Detected';
  }
}

// ── Order Loading & Incident Detection ──
async function loadOrders() {
  const container = document.getElementById('ops-orders-list');
  try {
    const res = await fetch(`${API_BASE}/api/orders?limit=20`);
    if (!res.ok) throw new Error('Failed to fetch');
    const orders = await res.json();

    if (!orders.length) {
      container.innerHTML = '<p class="ops-empty-state-text">No orders found. Place orders from the <a href="/">storefront</a>.</p>';
      return;
    }

    // Detect JPY orders that are stuck in "pending" (indicating payment failure)
    incidents = [];
    orders.forEach(o => {
      if (o.currency === 'JPY' && o.status === 'pending') {
        incidents.push({
          order_id: o.order_id,
          currency: o.currency,
          amount: o.amount,
          status: o.status,
          created_at: o.created_at,
          error_type: 'Payment Processing Failure',
          error_detail: 'JPY order stuck in pending - payment service likely crashed during processing. ValueError: zero-decimal currency conversion error.',
          severity: 'critical'
        });
      }
    });

    // Render orders table
    container.innerHTML = `
      <div class="ops-order-row ops-order-header">
        <span>Order ID</span>
        <span>Customer</span>
        <span>Currency</span>
        <span>Amount</span>
        <span>Status</span>
        <span>Time</span>
      </div>
    ` + orders.map(o => {
      const amt = o.currency === 'USD'
        ? '$' + (o.amount / 100).toFixed(2)
        : '\u00a5' + o.amount.toLocaleString();
      const isError = o.currency === 'JPY' && o.status === 'pending';
      const rowClass = isError ? 'ops-order-row ops-order-error' : 'ops-order-row';
      const time = new Date(o.created_at).toLocaleTimeString();
      return `<div class="${rowClass}">
        <span class="order-id">${o.order_id.substring(0, 8)}...</span>
        <span>${o.customer_id || 'N/A'}</span>
        <span class="order-currency">${o.currency}</span>
        <span class="order-amount">${amt}</span>
        <span><span class="status-badge status-${o.status}">${o.status}</span>${isError ? ' <span class="error-flag">INCIDENT</span>' : ''}</span>
        <span class="order-time">${time}</span>
      </div>`;
    }).join('');

    renderIncidents();
  } catch (e) {
    container.innerHTML = '<p class="ops-empty-state-text">Could not load orders. Check service health above.</p>';
  }
}

function renderIncidents() {
  const container = document.getElementById('incidents-list');
  const countEl = document.getElementById('incident-count');
  const devinSection = document.getElementById('devin-section');

  if (incidents.length === 0) {
    countEl.textContent = '0 errors';
    countEl.classList.remove('has-incidents');
    devinSection.style.display = 'none';
    container.innerHTML = `
      <div class="ops-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        <p>No incidents detected. Submit a JPY order from the <a href="/">storefront</a> to trigger the bug.</p>
      </div>`;
    return;
  }

  countEl.textContent = `${incidents.length} error${incidents.length > 1 ? 's' : ''}`;
  countEl.classList.add('has-incidents');

  // Show Devin section when there are incidents
  devinSection.style.display = 'block';
  lastErrorOrder = incidents[0];

  // Populate Devin context
  const ctxDetails = document.getElementById('devin-context-details');
  ctxDetails.innerHTML = `
    <div class="ctx-row"><span class="ctx-label">Team:</span> <span class="ctx-value">${teamId || 'unknown'}</span></div>
    <div class="ctx-row"><span class="ctx-label">Error Type:</span> <span class="ctx-value ctx-error">${lastErrorOrder.error_type}</span></div>
    <div class="ctx-row"><span class="ctx-label">Affected Order:</span> <span class="ctx-value">${lastErrorOrder.order_id}</span></div>
    <div class="ctx-row"><span class="ctx-label">Currency:</span> <span class="ctx-value">${lastErrorOrder.currency} \u00a5${lastErrorOrder.amount.toLocaleString()}</span></div>
    <div class="ctx-row"><span class="ctx-label">Detail:</span> <span class="ctx-value">${lastErrorOrder.error_detail}</span></div>
    <div class="ctx-row"><span class="ctx-label">Repos:</span> <span class="ctx-value">order-service, payment-service, infra, storefront</span></div>
  `;

  container.innerHTML = incidents.map((inc, i) => {
    const time = new Date(inc.created_at).toLocaleString();
    return `<div class="incident-card">
      <div class="incident-header">
        <span class="incident-severity severity-${inc.severity}">${inc.severity.toUpperCase()}</span>
        <span class="incident-type">${inc.error_type}</span>
        <span class="incident-time">${time}</span>
      </div>
      <div class="incident-body">
        <div class="incident-detail">${inc.error_detail}</div>
        <div class="incident-meta">
          Order: <code>${inc.order_id.substring(0, 12)}...</code> &bull;
          ${inc.currency} \u00a5${inc.amount.toLocaleString()} &bull;
          Status: <span class="status-badge status-${inc.status}">${inc.status}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Devin Integration ──
function buildDevinPrompt() {
  const orderUrl = API_BASE;
  const paymentUrl = API_BASE.replace('ef-order-', 'ef-payment-');
  const branch = teamId || 'main';

  return `## Production Incident Investigation

**Team**: ${teamId || 'unknown'}
**Alert**: Payment Processing Failure on JPY orders
**Severity**: Critical
**Order Service**: ${orderUrl}
**Payment Service**: ${paymentUrl}

### Context

The EventFlow payment processing stack is experiencing errors. JPY (Japanese Yen) orders are accepted by the Order Service but the Payment Service crashes during processing. USD orders work correctly.

The error is: \`ValueError: Amount X.X JPY is below minimum threshold\` — the payment service incorrectly divides all currency amounts by 100 (converting cents to dollars), but JPY is a zero-decimal currency that should not be divided.

### Repositories

- https://github.com/Cognition-Partner-Workshops/app_eventflow-order-service (branch: ${branch})
- https://github.com/Cognition-Partner-Workshops/app_eventflow-payment-service (branch: ${branch})
- https://github.com/Cognition-Partner-Workshops/app_eventflow-infra
- https://github.com/Cognition-Partner-Workshops/app_eventflow-storefront

### Investigation Steps

1. Look at the payment service code in \`app_eventflow-payment-service\`, specifically the payment processor in \`app/services/processor.py\`.
2. Identify the zero-decimal currency bug in the \`convert_to_display_amount()\` function.
3. Open a Pull Request on \`app_eventflow-payment-service\` against the \`${branch}\` branch with:
   - The bug fix: skip division by 100 for zero-decimal currencies (JPY, KRW, VND, etc.)
   - A new test case covering JPY order processing
   - Clear PR description explaining the root cause and fix
4. Verify the fix passes CI.`;
}

async function launchDevinInvestigation() {
  const btn = document.getElementById('devin-investigate-btn');
  const resultDiv = document.getElementById('devin-result');
  const resultHeader = document.getElementById('devin-result-header');
  const resultBody = document.getElementById('devin-result-body');

  btn.disabled = true;
  btn.innerHTML = '<svg class="spin-icon" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 12 12" to="360 12 12" repeatCount="indefinite"/></circle></svg> Creating Devin Session...';

  const prompt = buildDevinPrompt();

  // Check if Devin API is configured (key must start with valid prefix)
  if (!DEVIN_API_KEY || DEVIN_API_KEY === '' || DEVIN_API_KEY.includes('%')) {
    resultDiv.style.display = 'block';
    resultHeader.innerHTML = '<span class="devin-status devin-status-info">Manual Mode</span> Devin API not configured';
    resultBody.innerHTML = `
      <p>The Devin API key is not configured for this deployment. You can use the prompt manually:</p>
      <ol>
        <li>Go to <a href="https://app.devin.ai" target="_blank">app.devin.ai</a></li>
        <li>Start a new session</li>
        <li>Paste the investigation prompt (click "Copy Prompt" above)</li>
      </ol>
      <p style="margin-top:12px;"><strong>For automatic mode:</strong> Set the <code>DEVIN_API_KEY</code> environment variable on the storefront container.</p>
    `;
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Investigate with Devin';
    return;
  }

  try {
    const response = await fetch(`${DEVIN_API_URL}/sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEVIN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: prompt })
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    resultDiv.style.display = 'block';
    resultHeader.innerHTML = '<span class="devin-status devin-status-success">Session Created</span> Devin is investigating';
    resultBody.innerHTML = `
      <p>Devin has started investigating the incident automatically.</p>
      <div class="devin-session-info">
        <div class="ctx-row"><span class="ctx-label">Session ID:</span> <span class="ctx-value">${data.session_id || 'N/A'}</span></div>
        <div class="ctx-row"><span class="ctx-label">Status:</span> <span class="ctx-value">In Progress</span></div>
        ${data.url ? `<div class="ctx-row"><span class="ctx-label">View Session:</span> <a href="${data.url}" target="_blank" class="devin-link">${data.url}</a></div>` : ''}
      </div>
      <p style="margin-top:12px;">Devin will read the production logs, trace the bug across services, and open a PR with the fix. This typically takes 3-5 minutes.</p>
    `;
  } catch (err) {
    resultDiv.style.display = 'block';
    resultHeader.innerHTML = '<span class="devin-status devin-status-error">API Error</span> Could not create session';
    resultBody.innerHTML = `
      <p>Failed to create Devin session: <code>${err.message}</code></p>
      <p style="margin-top:8px;">You can still investigate manually using the copied prompt.</p>
    `;
  }

  btn.disabled = false;
  btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Investigate with Devin';
}

function copyDevinPrompt() {
  const prompt = buildDevinPrompt();
  navigator.clipboard.writeText(prompt).then(() => {
    const btn = event.target.closest('button');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove('copied');
    }, 2000);
  });
}

// ── Refresh ──
function refreshAll() {
  checkHealth();
  loadOrders();
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  detectTeam();
  checkHealth();
  loadOrders();

  // Auto-refresh every 15 seconds
  setInterval(refreshAll, 15000);
});

// Expose to global scope
window.refreshAll = refreshAll;
window.launchDevinInvestigation = launchDevinInvestigation;
window.copyDevinPrompt = copyDevinPrompt;
