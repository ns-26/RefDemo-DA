// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';

const DEFAULT_SERVICE_URL = 'https://hook.app.workfrontfusion.com/xot9mamgl12su5dteagfw64f6lklf7ge';

/* ── SVG icons (inline to avoid external deps) ───────────────────────── */

const ICON_SUCCESS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none">
  <circle cx="12" cy="12" r="11" fill="#12805c"/>
  <path d="M7 12.5l3 3 7-7" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICON_FAILURE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none">
  <circle cx="12" cy="12" r="11" fill="#d7373f"/>
  <path d="M8 8l8 8M16 8l-8 8" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
</svg>`;

/* ── Placeholders config ─────────────────────────────────────────────── */

function buildPlaceholdersUrl(org, repo) {
  return `https://main--${repo}--${org}.aem.live/config/placeholder.json`;
}

async function fetchPlaceholders(org, repo) {
  const url = buildPlaceholdersUrl(org, repo);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Placeholders fetch failed: ${resp.status}`);
  const json = await resp.json();

  const lookup = {};
  (json.data || []).forEach((row) => {
    if (row.key) lookup[row.key.toLowerCase()] = row.value || '';
  });

  let rawPayload = lookup['external-service-payload'] || '';
  if (rawPayload.startsWith("'") && rawPayload.endsWith("'")) {
    rawPayload = rawPayload.slice(1, -1);
  }

  return {
    externalServiceUrl: lookup['external-service-url'] || '',
    externalServicePayload: rawPayload,
  };
}

/* ── User profile ────────────────────────────────────────────────────── */

async function fetchUserProfile(token) {
  try {
    const resp = await fetch('https://ims-na1.adobelogin.com/ims/profile/v1', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return { userName: '', userEmail: '' };
    const profile = await resp.json();
    return {
      userName: profile.displayName || profile.name || '',
      userEmail: profile.email || '',
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[invoke-service] Failed to fetch user profile:', e);
    return { userName: '', userEmail: '' };
  }
}

/* ── Resolve org / repo from DA SDK context ──────────────────────────── */

function resolveOrgRepo(context) {
  if (context.org && context.repo) {
    return { org: context.org, repo: context.repo, path: context.path || '/' };
  }

  const url = context.url || context.location || context.href || '';
  const hashPath = url.includes('#') ? url.split('#')[1] : '';
  const segments = (hashPath || '').split('/').filter(Boolean);
  if (segments.length >= 2) {
    return { org: segments[0], repo: segments[1], path: `/${segments.slice(2).join('/')}` };
  }

  const values = Object.values(context).filter((v) => typeof v === 'string');
  const slashVal = values.find((v) => v.split('/').filter(Boolean).length >= 2);
  if (slashVal) {
    const parts = slashVal.split('/').filter(Boolean);
    return { org: parts[0], repo: parts[1], path: `/${parts.slice(2).join('/')}` };
  }

  throw new Error(`Could not resolve org/repo from context: ${JSON.stringify(context)}`);
}

/* ── External service call ───────────────────────────────────────────── */

async function invokeExternalService(token, context) {
  // eslint-disable-next-line no-console
  console.log('[invoke-service] DA SDK context →', JSON.stringify(context, null, 2));

  const { org, repo, path } = resolveOrgRepo(context);
  // eslint-disable-next-line no-console
  console.log('[invoke-service] Resolved →', { org, repo, path });

  const [profile, config] = await Promise.all([
    fetchUserProfile(token),
    fetchPlaceholders(org, repo).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[invoke-service] Placeholders fetch failed, using defaults:', err);
      return { externalServiceUrl: '', externalServicePayload: '' };
    }),
  ]);

  const resolvedUrl = config.externalServiceUrl || DEFAULT_SERVICE_URL;

  let resolvedPayload;
  if (config.externalServicePayload) {
    try {
      resolvedPayload = JSON.parse(config.externalServicePayload);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[invoke-service] Failed to parse custom payload, using default:', e);
    }
  }

  if (!resolvedPayload) {
    resolvedPayload = {
      org,
      repo,
      path,
      'user-name': profile.userName,
      'user-email': profile.userEmail,
    };
  }

  // eslint-disable-next-line no-console
  console.log('[invoke-service] Calling service →', resolvedUrl);

  const resp = await fetch(resolvedUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(resolvedPayload),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw new Error(`External service error: ${resp.status} – ${errorBody}`);
  }

  return resp.json();
}

/* ── UI rendering with Spectrum CSS ──────────────────────────────────── */

function renderConfirm(root, { onConfirm, onCancel }) {
  root.innerHTML = `
    <div class="invoke-service-panel">
      <p class="invoke-service-message">Invoke the external service for this document?</p>
      <div class="invoke-service-actions">
        <button class="spectrum-Button spectrum-Button--sizeM spectrum-Button--secondary spectrum-Button--outline" id="invoke-cancel">
          <span class="spectrum-Button-label">Cancel</span>
        </button>
        <button class="spectrum-Button spectrum-Button--sizeM spectrum-Button--accent spectrum-Button--fill" id="invoke-confirm">
          <span class="spectrum-Button-label">Confirm</span>
        </button>
      </div>
    </div>`;
  root.querySelector('#invoke-cancel').addEventListener('click', onCancel);
  root.querySelector('#invoke-confirm').addEventListener('click', onConfirm);
}

function renderLoading(root) {
  root.innerHTML = `
    <div class="invoke-service-panel">
      <div class="invoke-service-loading">
        <div class="spectrum-ProgressCircle spectrum-ProgressCircle--indeterminate spectrum-ProgressCircle--small">
          <div class="spectrum-ProgressCircle-track"></div>
          <div class="spectrum-ProgressCircle-fills">
            <div class="spectrum-ProgressCircle-fillMask1">
              <div class="spectrum-ProgressCircle-fillSubMask1">
                <div class="spectrum-ProgressCircle-fill"></div>
              </div>
            </div>
            <div class="spectrum-ProgressCircle-fillMask2">
              <div class="spectrum-ProgressCircle-fillSubMask2">
                <div class="spectrum-ProgressCircle-fill"></div>
              </div>
            </div>
          </div>
        </div>
        <p class="invoke-service-message">Executing external service…</p>
      </div>
    </div>`;
}

function renderResult(root, { isSuccess, message, onClose }) {
  const icon = isSuccess ? ICON_SUCCESS : ICON_FAILURE;
  const label = isSuccess ? 'Success' : 'Failed';

  root.innerHTML = `
    <div class="invoke-service-panel">
      <div class="invoke-service-result">
        <div class="invoke-service-icon">${icon}</div>
        <p class="invoke-service-label">${label}</p>
        <p class="invoke-service-detail">${message}</p>
      </div>
      <div class="invoke-service-actions">
        <button class="spectrum-Button spectrum-Button--sizeM spectrum-Button--accent spectrum-Button--fill" id="invoke-close">
          <span class="spectrum-Button-label">Close</span>
        </button>
      </div>
    </div>`;
  root.querySelector('#invoke-close').addEventListener('click', onClose);
}

/* ── Init ─────────────────────────────────────────────────────────────── */

(async function init() {
  const { context, token, actions } = await DA_SDK;
  const root = document.getElementById('invoke-service-root');

  const handlers = {
    onCancel: () => actions.closeLibrary(),
    onClose: () => actions.closeLibrary(),
    onConfirm: async () => {
      renderLoading(root);
      let isSuccess = false;
      let message = '';
      try {
        await invokeExternalService(token, context);
        isSuccess = true;
        message = 'The external service executed successfully.';
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[invoke-service] Error:', err);
        isSuccess = false;
        message = err.message || 'An unexpected error occurred.';
      }
      renderResult(root, { isSuccess, message, onClose: handlers.onClose });
    },
  };

  renderConfirm(root, handlers);
}());
