// EventFlow Operations Dashboard
const API_BASE = window.__ENV__?.API_BASE || '%%API_BASE%%';
const DEVIN_API_URL = '%%DEVIN_API_URL%%';
const DEVIN_API_KEY = '%%DEVIN_API_KEY%%';
const WEBHOOK_URL = '%%WEBHOOK_URL%%';

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
  } else if (hostname.includes('-main')) {
    teamId = 'main';
    teamNumber = '';
    document.getElementById('team-badge').textContent = 'Main';
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

    // Detect orders with payment failures (failed status or JPY stuck in pending)
    incidents = [];
    orders.forEach(o => {
      if (o.status === 'failed' || (o.currency === 'JPY' && o.status === 'pending')) {
        incidents.push({
          order_id: o.order_id,
          currency: o.currency,
          amount: o.amount,
          status: o.status,
          created_at: o.created_at,
          error_type: 'Payment Processing Failure',
          error_detail: o.status === 'failed'
            ? 'Payment service crashed while processing this order. Customer received "Unable to Process Order" error.'
            : 'Order stuck in pending — payment service appears to have crashed or timed out while processing this order.',
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
      const isError = o.status === 'failed' || (o.currency === 'JPY' && o.status === 'pending');
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
        <p>No incidents detected. Place an order from the <a href="/">storefront</a> using different currencies to test the system.</p>
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
  const branch = 'main';

  // Build incident details from the most recent incident
  const incident = incidents.length > 0 ? incidents[0] : null;
  const orderId = incident ? incident.order_id : 'unknown';
  const currency = incident ? incident.currency : 'unknown';
  const amount = incident ? incident.total_amount : 'unknown';

  return `## Production Incident

**Team**: ${teamId || 'unknown'}
**Time detected**: ${new Date().toISOString()}

### Impacted Services

- **Order Service**: ${orderUrl}
- **Payment Service**: ${paymentUrl}

Some customer orders are failing. We received reports of orders not completing successfully.

**Recent affected order:**
- Order ID: \`${orderId}\`

### Production Logs

Query the production logs to understand what is happening. Azure CLI credentials are already configured as environment variables (\`AZURE_CLIENT_ID\`, \`AZURE_CLIENT_SECRET\`, \`AZURE_TENANT_ID\`).

\`\`\`bash
az login --service-principal -u $AZURE_CLIENT_ID -p $AZURE_CLIENT_SECRET --tenant $AZURE_TENANT_ID -o none

az monitor log-analytics query \\
  --workspace "4cf2afba-136e-4018-9f2d-42b3dbafc3a8" \\
  --analytics-query "ContainerAppConsoleLogs_CL | where TimeGenerated > ago(2h) | where Log_s !contains 'GET /health' | order by TimeGenerated desc | take 50 | project TimeGenerated, ContainerAppName_s, Log_s" \\
  -o table
\`\`\`

Start by querying the logs. They are the source of truth for what is happening at runtime.

### Repositories

- https://github.com/Cognition-Partner-Workshops/app_eventflow-order-service (branch: \`${branch}\`)
- https://github.com/Cognition-Partner-Workshops/app_eventflow-payment-service (branch: \`${branch}\`)
- https://github.com/Cognition-Partner-Workshops/app_eventflow-infra
- https://github.com/Cognition-Partner-Workshops/app_eventflow-storefront (branch: \`${branch}\`)

### Your Task

1. **Query logs** — Pull production logs and determine what is going wrong.
2. **Investigate** — Examine the source code to understand the root cause of the failures.
3. **Fix** — Open a Pull Request on the appropriate repository against the \`${branch}\` branch with the fix.
4. **Verify** — Make sure the fix passes CI.

Open your fix PR against the \`main\` branch.`;
}

async function launchDevinInvestigation() {
  const btn = document.getElementById('devin-investigate-btn');
  const resultDiv = document.getElementById('devin-result');
  const resultHeader = document.getElementById('devin-result-header');
  const resultBody = document.getElementById('devin-result-body');

  btn.disabled = true;
  btn.innerHTML = '<svg class="spin-icon" width="18" height="18" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" fill="none" stroke-dasharray="31.4 31.4" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" dur="0.8s" from="0 12 12" to="360 12 12" repeatCount="indefinite"/></circle></svg> Creating Devin Session...';

  const prompt = buildDevinPrompt();

  // Check if webhook proxy is configured
  if (!WEBHOOK_URL || WEBHOOK_URL === '' || WEBHOOK_URL.includes('%')) {
    resultDiv.style.display = 'block';
    resultHeader.innerHTML = '<span class="devin-status devin-status-info">Manual Mode</span> Webhook not configured';
    resultBody.innerHTML = `
      <p>The webhook proxy is not configured for this deployment. You can use the prompt manually:</p>
      <ol>
        <li>Go to <a href="https://app.devin.ai" target="_blank">app.devin.ai</a></li>
        <li>Start a new session</li>
        <li>Paste the investigation prompt (click "Copy Prompt" above)</li>
      </ol>
      <p style="margin-top:12px;"><strong>For automatic mode:</strong> Set the <code>WEBHOOK_URL</code> environment variable on the storefront container.</p>
    `;
    btn.disabled = false;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Investigate with Devin';
    return;
  }

  try {
    // Call the webhook proxy (server-side) to avoid browser CORS issues
    const response = await fetch(`${WEBHOOK_URL}/investigate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ team_id: teamId, prompt: prompt })
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const sessionUrl = data.devin_url || data.url || '';
    const sessionId = data.devin_session_id || data.session_id || 'N/A';
    resultDiv.style.display = 'block';
    resultHeader.innerHTML = '<span class="devin-status devin-status-success">Session Created</span> Devin is investigating';
    resultBody.innerHTML = `
      <p>Devin has started investigating the incident automatically.</p>
      ${sessionUrl ? `<p style="margin:16px 0;"><a href="${sessionUrl}" target="_blank" class="devin-btn devin-btn-primary" style="display:inline-flex;text-decoration:none;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Open Devin Session
      </a></p>` : ''}
      <div class="devin-session-info">
        <div class="ctx-row"><span class="ctx-label">Session ID:</span> <span class="ctx-value">${sessionId}</span></div>
        <div class="ctx-row"><span class="ctx-label">Status:</span> <span class="ctx-value">In Progress</span></div>
        ${sessionUrl ? `<div class="ctx-row"><span class="ctx-label">Session URL:</span> <a href="${sessionUrl}" target="_blank" class="devin-link">${sessionUrl}</a></div>` : ''}
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
