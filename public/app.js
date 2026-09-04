// ==========================================================================
// OferDay PRO EDITION - Client-side Dashboard Application Controller
// ==========================================================================

// Global App State
let appState = {
  config: null,
  telegram: null,
  whatsapp: null,
  feed: [],
  autoScroll: true
};

// --- Modal Management System ---
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalEl) {
  if (modalEl) {
    modalEl.classList.remove('active');
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.remove('active'));
}

// Bind modal trigger buttons
document.addEventListener('click', (e) => {
  const targetBtn = e.target.closest('[data-modal]');
  if (targetBtn) {
    e.preventDefault();
    const modalId = targetBtn.getAttribute('data-modal');
    if (modalId) openModal(modalId);
    return;
  }

  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) {
    e.preventDefault();
    const modal = closeBtn.closest('.modal-overlay');
    closeModal(modal);
    return;
  }

  // Backdrop click
  if (e.target.classList.contains('modal-overlay')) {
    closeModal(e.target);
  }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeAllModals();
  }
});

// --- Collapsible Sidebar Groups ---
document.querySelectorAll('.nav-group-header').forEach((header) => {
  header.addEventListener('click', () => {
    const parentGroup = header.closest('.nav-group');
    if (parentGroup) {
      parentGroup.classList.toggle('open');
    }
  });
});

// --- Theme Switcher (Light / Dark) ---
const btnThemeLight = document.getElementById('btnThemeLight');
const btnThemeDark = document.getElementById('btnThemeDark');

btnThemeLight?.addEventListener('click', () => {
  document.body.classList.remove('theme-dark');
  document.body.classList.add('theme-light');
  btnThemeLight.classList.add('active');
  btnThemeDark.classList.remove('active');
  localStorage.setItem('oferday_theme', 'light');
});

btnThemeDark?.addEventListener('click', () => {
  document.body.classList.remove('theme-light');
  document.body.classList.add('theme-dark');
  btnThemeDark.classList.add('active');
  btnThemeLight.classList.remove('active');
  localStorage.setItem('oferday_theme', 'dark');
});

// Restore saved theme
const savedTheme = localStorage.getItem('oferday_theme');
if (savedTheme === 'dark') {
  btnThemeDark?.click();
}

// --- Mobile Sidebar Toggle ---
const btnToggleMobileMenu = document.getElementById('btnToggleMobileMenu');
btnToggleMobileMenu?.addEventListener('click', () => {
  document.querySelector('.sidebar')?.classList.toggle('mobile-open');
});

// --- Toast Notification ---
const toastEl = document.getElementById('toast');
function showToast(message, type = 'info') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 4000);
}

// --- DOM References ---
// Telegram
const tgBadge = document.getElementById('tgBadge');
const tgAuthForm = document.getElementById('tgAuthForm');
const tgCodeStep = document.getElementById('tgCodeStep');
const tg2FaStep = document.getElementById('tg2FaStep');
const tgConnectedStep = document.getElementById('tgConnectedStep');
const tgApiId = document.getElementById('tgApiId');
const tgApiHash = document.getElementById('tgApiHash');
const tgPhone = document.getElementById('tgPhone');
const tgCode = document.getElementById('tgCode');
const tg2FaPass = document.getElementById('tg2FaPass');
const btnTgSendCode = document.getElementById('btnTgSendCode');
const btnTgVerifyCode = document.getElementById('btnTgVerifyCode');
const btnTgCancelCode = document.getElementById('btnTgCancelCode');
const btnTgSubmit2Fa = document.getElementById('btnTgSubmit2Fa');
const btnTgLogout = document.getElementById('btnTgLogout');

// WhatsApp
const waBadge = document.getElementById('waBadge');
const waQrSection = document.getElementById('waQrSection');
const waConnectedSection = document.getElementById('waConnectedSection');
const waQrImg = document.getElementById('waQrImg');
const waQrPlaceholder = document.getElementById('waQrPlaceholder');
const btnWaReconnect = document.getElementById('btnWaReconnect');
const btnWaDisconnect = document.getElementById('btnWaDisconnect');

// Sidebar Status Indicators
const sidebarWaDot = document.getElementById('sidebarWaDot');
const sidebarWaBadge = document.getElementById('sidebarWaBadge');
const sidebarTgDot = document.getElementById('sidebarTgDot');
const sidebarTgBadge = document.getElementById('sidebarTgBadge');

// Top Metric Cards
const cardWaStatusText = document.getElementById('cardWaStatusText');
const cardWaSubLink = document.getElementById('cardWaSubLink');
const cardWaActionText = document.getElementById('cardWaActionText');
const cardMonitoredCount = document.getElementById('cardMonitoredCount');
const cardDestChannelName = document.getElementById('cardDestChannelName');
const cardAffiliatesCount = document.getElementById('cardAffiliatesCount');

// Checklist Steps
const chkStep1 = document.getElementById('chkStep1');
const chkStep2 = document.getElementById('chkStep2');
const chkStep3 = document.getElementById('chkStep3');
const chkStep4 = document.getElementById('chkStep4');

// Config & Inputs
const cfgSourceChannel = document.getElementById('cfgSourceChannel');
const cfgDestJid = document.getElementById('cfgDestJid');
const forwarderActiveSwitch = document.getElementById('forwarderActiveSwitch');
const forwarderStatusLabel = document.getElementById('forwarderStatusLabel');
const btnSaveConfig = document.getElementById('btnSaveConfig');
const btnSaveConfigRouting = document.getElementById('btnSaveConfigRouting');

// Feed
const feedContainer = document.getElementById('feedContainer');

// Simulator
const simText = document.getElementById('simText');
const simImage = document.getElementById('simImage');
const btnSimulate = document.getElementById('btnSimulate');

// Terminal & Logs
const logTerminal = document.getElementById('logTerminal');
const autoScrollCheck = document.getElementById('autoScrollCheck');
const btnClearLogs = document.getElementById('btnClearLogs');

// WhatsApp Channel Resolver
const btnLoadChats = document.getElementById('btnLoadChats');
const chatSelectDropdown = document.getElementById('chatSelectDropdown');
const resolvedJidBadge = document.getElementById('resolvedJidBadge');

// Meli Tokens
const meliTokenBadge = document.getElementById('meliTokenBadge');
const meliTokenExpireInfo = document.getElementById('meliTokenExpireInfo');
const btnRefreshMeliToken = document.getElementById('btnRefreshMeliToken');

// --- SSE Setup ---
function setupSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    appState.config = data.config;
    updateConfigUI(data.config);
    updateTelegramUI(data.telegram);
    updateWhatsAppUI(data.whatsapp);
    
    if (data.logs && logTerminal) {
      logTerminal.innerHTML = '';
      data.logs.forEach(appendLog);
    }

    if (data.feed && data.feed.length > 0) {
      appState.feed = data.feed;
      renderFeed(data.feed);
    }
  });

  eventSource.addEventListener('log', (e) => {
    const entry = JSON.parse(e.data);
    appendLog(entry);
  });

  eventSource.addEventListener('logs_cleared', () => {
    if (logTerminal) logTerminal.innerHTML = '';
  });

  eventSource.addEventListener('whatsapp_qr', (e) => {
    const data = JSON.parse(e.data);
    if (data.qr) {
      renderQr(data.qr);
    }
  });

  eventSource.addEventListener('whatsapp_status', (e) => {
    const data = JSON.parse(e.data);
    updateWhatsAppUI(data);
  });

  eventSource.addEventListener('telegram_status', (e) => {
    const data = JSON.parse(e.data);
    updateTelegramUI(data);
  });

  eventSource.addEventListener('config_updated', (e) => {
    const config = JSON.parse(e.data);
    appState.config = config;
    updateConfigUI(config);
  });

  eventSource.addEventListener('new_forwarded_message', (e) => {
    const item = JSON.parse(e.data);
    addFeedItemUI(item, true);
  });

  eventSource.addEventListener('message_updated', (e) => {
    const item = JSON.parse(e.data);
    updateFeedItemStatus(item);
  });

  eventSource.onerror = () => {
    console.warn('SSE desconectado, tentando reconectar...');
  };
}

// --- Terminal Log Rendering ---
function appendLog(entry) {
  if (!logTerminal) return;
  const logDiv = document.createElement('div');
  logDiv.className = `log-entry ${entry.module?.toLowerCase() || 'system'} ${entry.level || 'info'}`;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${entry.timestamp || '--:--:--'}]`;

  const tagSpan = document.createElement('span');
  tagSpan.className = 'log-tag';
  tagSpan.textContent = `[${entry.module || 'SYS'}]`;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = entry.message || '';

  logDiv.appendChild(timeSpan);
  logDiv.appendChild(tagSpan);
  logDiv.appendChild(msgSpan);

  logTerminal.appendChild(logDiv);

  if (appState.autoScroll) {
    logTerminal.scrollTop = logTerminal.scrollHeight;
  }
}

// --- Feed UI Rendering ---
function detectStore(text) {
  if (!text) return 'OFERTA';
  const t = text.toLowerCase();
  if (t.includes('mercadolivre') || t.includes('meli.la') || t.includes('mercado livre')) return 'MERCADO LIVRE';
  if (t.includes('amazon.com') || t.includes('amzn.to')) return 'AMAZON';
  if (t.includes('shopee.com') || t.includes('s.shopee')) return 'SHOPEE';
  if (t.includes('magazineluiza') || t.includes('magazinevoce') || t.includes('magalu')) return 'MAGAZINE LUIZA';
  if (t.includes('aliexpress') || t.includes('s.click.aliexpress')) return 'ALIEXPRESS';
  return 'OFERTA PROMO';
}

function getStoreClass(store) {
  if (store.includes('MERCADO')) return 'store-meli';
  if (store.includes('AMAZON')) return 'store-amazon';
  if (store.includes('SHOPEE')) return 'store-shopee';
  return 'store-meli';
}

function extractTitleAndSnippet(text) {
  if (!text) return { title: 'Nova Oferta Repassada', snippet: '' };
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const title = lines[0] || 'Oferta Repassada';
  const snippet = lines.slice(1).join(' ') || text;
  return { title, snippet };
}

function renderFeed(items) {
  if (!feedContainer) return;
  feedContainer.innerHTML = '';
  if (!items || items.length === 0) return;
  items.slice(0, 15).forEach((item) => addFeedItemUI(item, false));
}

function addFeedItemUI(item, prepend = true) {
  if (!feedContainer) return;

  // Remove mock items if any
  const mock1 = document.getElementById('mockOffer1');
  const mock2 = document.getElementById('mockOffer2');
  const mock3 = document.getElementById('mockOffer3');
  if (mock1) mock1.remove();
  if (mock2) mock2.remove();
  if (mock3) mock3.remove();

  const itemEl = document.createElement('div');
  itemEl.className = 'offer-item-card';
  itemEl.id = `feed-${item.id}`;

  const store = detectStore(item.text);
  const storeClass = getStoreClass(store);
  const { title, snippet } = extractTitleAndSnippet(item.text);
  const originChannel = item.channel || 'Telegram';
  const destName = cardDestChannelName?.textContent || 'Canal';

  itemEl.innerHTML = `
    <div class="offer-header-row">
      <div class="offer-store-and-origin">
        <span class="store-pill ${storeClass}">${escapeHtml(store)}</span>
        <span class="offer-origin">de ${escapeHtml(originChannel)} • ${escapeHtml(item.timestamp || 'Agora mesmo')}</span>
      </div>
      <span class="badge-status-sent" id="status-${item.id}">Disparado ✅</span>
    </div>
    <div class="offer-title">${escapeHtml(title)}</div>
    <div class="offer-snippet">${escapeHtml(snippet)}</div>
    <div class="offer-footer-row">
      <span class="offer-dest-tag">Destino: <strong>${escapeHtml(destName)}</strong></span>
    </div>
  `;

  if (prepend) {
    feedContainer.prepend(itemEl);
  } else {
    feedContainer.appendChild(itemEl);
  }
}

function updateFeedItemStatus(item) {
  const statusEl = document.getElementById(`status-${item.id}`);
  if (statusEl) {
    if (item.status === 'success') {
      statusEl.textContent = 'Disparado ✅';
      statusEl.className = 'badge-status-sent';
    } else if (item.status === 'failed') {
      statusEl.textContent = 'Falha ⚠️';
      statusEl.className = 'status-pill-badge badge-red';
    } else {
      statusEl.textContent = 'Enviando...';
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Config Synchronization & UI Updates ---
function updateConfigUI(config) {
  if (!config) return;

  if (cfgSourceChannel && config.telegram?.sourceChannel) {
    cfgSourceChannel.value = config.telegram.sourceChannel;
  }
  if (cfgDestJid && config.whatsapp?.destinationJid) {
    cfgDestJid.value = config.whatsapp.destinationJid;
  }

  // Update channels count metric
  if (cardMonitoredCount && config.telegram?.sourceChannel) {
    const channels = config.telegram.sourceChannel.split(',').filter((c) => c.trim().length > 0);
    cardMonitoredCount.textContent = `${channels.length || 1} canais`;
  }

  // Update destination channel metric
  if (cardDestChannelName) {
    const dest = config.whatsapp?.destinationJid || 'Teste <3';
    cardDestChannelName.textContent = dest.includes('@') ? dest.split('@')[0] : (dest || 'Teste <3');
  }

  // Telegram inputs
  if (config.telegram?.apiId && tgApiId) tgApiId.value = config.telegram.apiId;
  if (config.telegram?.apiHash && tgApiHash) tgApiHash.value = config.telegram.apiHash;
  if (config.telegram?.phoneNumber && tgPhone) tgPhone.value = config.telegram.phoneNumber;

  // Shopee
  const cfgShopeeAppId = document.getElementById('cfgShopeeAppId');
  const cfgShopeeAppSecret = document.getElementById('cfgShopeeAppSecret');
  if (cfgShopeeAppId && config.affiliate?.shopeeAppId) cfgShopeeAppId.value = config.affiliate.shopeeAppId;
  if (cfgShopeeAppSecret && config.affiliate?.shopeeAppSecret) cfgShopeeAppSecret.value = config.affiliate.shopeeAppSecret;

  // Mercado Livre
  const cfgMlTag = document.getElementById('cfgMlTag');
  const cfgMlListUrl = document.getElementById('cfgMlListUrl');
  const cfgMlAppId = document.getElementById('cfgMlAppId');
  const cfgMlSecretKey = document.getElementById('cfgMlSecretKey');
  if (cfgMlTag && (config.affiliate?.mlAffiliateTag || config.affiliate?.meliAffiliateTag)) {
    cfgMlTag.value = config.affiliate.mlAffiliateTag || config.affiliate.meliAffiliateTag;
  }
  if (cfgMlListUrl && config.affiliate?.mlListShortUrl) cfgMlListUrl.value = config.affiliate.mlListShortUrl;
  if (cfgMlAppId && config.affiliate?.mlAppId) cfgMlAppId.value = config.affiliate.mlAppId;
  if (cfgMlSecretKey && config.affiliate?.mlSecretKey) cfgMlSecretKey.value = config.affiliate.mlSecretKey;

  // Amazon
  const cfgAmazonTag = document.getElementById('cfgAmazonTag');
  if (cfgAmazonTag && config.affiliate?.amazonTag) cfgAmazonTag.value = config.affiliate.amazonTag;

  // Magalu
  const cfgMagaluTag = document.getElementById('cfgMagaluTag');
  if (cfgMagaluTag && config.affiliate?.magaluTag) cfgMagaluTag.value = config.affiliate.magaluTag;

  // AliExpress
  const cfgAliAppKey = document.getElementById('cfgAliAppKey');
  const cfgAliAppSecret = document.getElementById('cfgAliAppSecret');
  const cfgAliTrackingId = document.getElementById('cfgAliTrackingId');
  if (cfgAliAppKey && config.affiliate?.aliexpressAppKey) cfgAliAppKey.value = config.affiliate.aliexpressAppKey;
  if (cfgAliAppSecret && config.affiliate?.aliexpressAppSecret) cfgAliAppSecret.value = config.affiliate.aliexpressAppSecret;
  if (cfgAliTrackingId && config.affiliate?.aliexpressTrackingId) cfgAliTrackingId.value = config.affiliate.aliexpressTrackingId;

  // Master Forwarder Switch
  if (forwarderActiveSwitch) {
    forwarderActiveSwitch.checked = !!config.forwarder?.active;
  }
  if (forwarderStatusLabel) {
    forwarderStatusLabel.textContent = config.forwarder?.active ? 'Repasse: Ativo' : 'Repasse: Pausado';
  }
}

// --- Telegram Status UI ---
function updateTelegramUI(statusObj) {
  if (!statusObj) return;
  const status = statusObj.status;

  tgAuthForm?.classList.add('hidden');
  tgCodeStep?.classList.add('hidden');
  tg2FaStep?.classList.add('hidden');
  tgConnectedStep?.classList.add('hidden');

  if (status === 'connected') {
    if (tgBadge) {
      tgBadge.textContent = 'Conectado';
      tgBadge.className = 'badge badge-green';
    }
    tgConnectedStep?.classList.remove('hidden');

    if (sidebarTgDot) sidebarTgDot.className = 'status-dot dot-green';
    if (sidebarTgBadge) {
      sidebarTgBadge.textContent = 'Online';
      sidebarTgBadge.className = 'status-pill-badge badge-green';
    }
  } else if (status === 'waiting_code') {
    if (tgBadge) {
      tgBadge.textContent = 'Aguardando Código';
      tgBadge.className = 'badge badge-yellow';
    }
    tgCodeStep?.classList.remove('hidden');

    if (sidebarTgDot) sidebarTgDot.className = 'status-dot dot-yellow';
    if (sidebarTgBadge) {
      sidebarTgBadge.textContent = 'Código';
      sidebarTgBadge.className = 'status-pill-badge badge-gray';
    }
  } else if (status === 'waiting_2fa') {
    if (tgBadge) {
      tgBadge.textContent = 'Aguardando 2FA';
      tgBadge.className = 'badge badge-yellow';
    }
    tg2FaStep?.classList.remove('hidden');

    if (sidebarTgDot) sidebarTgDot.className = 'status-dot dot-yellow';
    if (sidebarTgBadge) {
      sidebarTgBadge.textContent = '2FA';
      sidebarTgBadge.className = 'status-pill-badge badge-gray';
    }
  } else {
    if (tgBadge) {
      tgBadge.textContent = 'Desconectado';
      tgBadge.className = 'badge badge-gray';
    }
    tgAuthForm?.classList.remove('hidden');

    if (sidebarTgDot) sidebarTgDot.className = 'status-dot dot-gray';
    if (sidebarTgBadge) {
      sidebarTgBadge.textContent = 'Offline';
      sidebarTgBadge.className = 'status-pill-badge badge-gray';
    }
  }
}

// --- WhatsApp Status UI ---
function updateWhatsAppUI(statusObj) {
  if (!statusObj) return;
  const status = statusObj.status;

  if (status === 'connected') {
    if (waBadge) {
      waBadge.textContent = 'Conectado';
      waBadge.className = 'badge badge-green';
    }
    waQrSection?.classList.add('hidden');
    waConnectedSection?.classList.remove('hidden');

    // Sidebar
    if (sidebarWaDot) sidebarWaDot.className = 'status-dot dot-green';
    if (sidebarWaBadge) {
      sidebarWaBadge.textContent = 'Online';
      sidebarWaBadge.className = 'status-pill-badge badge-green';
    }

    // Metric card
    if (cardWaStatusText) cardWaStatusText.textContent = 'Conectado';
    if (cardWaActionText) cardWaActionText.textContent = 'Sessão Ativa';
    if (cardWaSubLink) {
      cardWaSubLink.className = 'metric-link text-green';
      cardWaSubLink.innerHTML = '<span class="status-dot-mini dot-green"></span> <span>Sessão 24h Ativa</span>';
    }

    // Checklist step 1 completed
    if (chkStep1) {
      chkStep1.className = 'step-num-circle check-completed';
      chkStep1.innerHTML = '✓';
    }
  } else if (status === 'connecting') {
    if (waBadge) {
      waBadge.textContent = 'Aguardando QR Code';
      waBadge.className = 'badge badge-yellow';
    }
    waQrSection?.classList.remove('hidden');
    waConnectedSection?.classList.add('hidden');
    if (statusObj.qrCode) {
      renderQr(statusObj.qrCode);
    }

    // Sidebar
    if (sidebarWaDot) sidebarWaDot.className = 'status-dot dot-yellow';
    if (sidebarWaBadge) {
      sidebarWaBadge.textContent = 'QR Code';
      sidebarWaBadge.className = 'status-pill-badge badge-gray';
    }

    // Metric card
    if (cardWaStatusText) cardWaStatusText.textContent = 'Aguardando QR';
    if (cardWaActionText) cardWaActionText.textContent = 'Escanear QR agora';
    if (cardWaSubLink) cardWaSubLink.className = 'metric-link alert-link';
  } else {
    if (waBadge) {
      waBadge.textContent = 'Desconectado';
      waBadge.className = 'badge badge-gray';
    }
    waQrSection?.classList.remove('hidden');
    waConnectedSection?.classList.add('hidden');
    waQrImg?.classList.add('hidden');
    waQrPlaceholder?.classList.remove('hidden');

    // Sidebar
    if (sidebarWaDot) sidebarWaDot.className = 'status-dot dot-gray';
    if (sidebarWaBadge) {
      sidebarWaBadge.textContent = 'Offline';
      sidebarWaBadge.className = 'status-pill-badge badge-gray';
    }

    // Metric card
    if (cardWaStatusText) cardWaStatusText.textContent = 'Desconectado';
    if (cardWaActionText) cardWaActionText.textContent = 'Conectar agora';
    if (cardWaSubLink) cardWaSubLink.className = 'metric-link alert-link';
  }
}

function renderQr(dataUrl) {
  if (waQrPlaceholder) waQrPlaceholder.classList.add('hidden');
  if (waQrImg) {
    waQrImg.src = dataUrl;
    waQrImg.classList.remove('hidden');
  }
}

// --- Telegram Action Handlers ---
btnTgSendCode?.addEventListener('click', async () => {
  const apiId = tgApiId.value.trim();
  const apiHash = tgApiHash.value.trim();
  const phoneNumber = tgPhone.value.trim();

  if (!apiId || !apiHash || !phoneNumber) {
    showToast('Preencha API ID, API Hash e Telefone.', 'error');
    return;
  }

  btnTgSendCode.disabled = true;
  btnTgSendCode.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/telegram/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiId, apiHash, phoneNumber })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Código de verificação enviado!', 'success');
    } else {
      showToast(`Erro: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    btnTgSendCode.disabled = false;
    btnTgSendCode.textContent = 'Enviar Código de Login';
  }
});

btnTgVerifyCode?.addEventListener('click', async () => {
  const code = tgCode.value.trim();
  if (!code) {
    showToast('Digite o código recebido.', 'error');
    return;
  }

  btnTgVerifyCode.disabled = true;
  btnTgVerifyCode.textContent = 'Validando...';

  try {
    const res = await fetch('/api/telegram/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Telegram conectado com sucesso!', 'success');
    } else {
      showToast(`Erro: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    btnTgVerifyCode.disabled = false;
    btnTgVerifyCode.textContent = 'Confirmar Código';
  }
});

btnTgCancelCode?.addEventListener('click', () => {
  tgCodeStep?.classList.add('hidden');
  tgAuthForm?.classList.remove('hidden');
});

btnTgSubmit2Fa?.addEventListener('click', async () => {
  const password = tg2FaPass.value.trim();
  if (!password) {
    showToast('Digite sua senha 2FA.', 'error');
    return;
  }

  btnTgSubmit2Fa.disabled = true;
  btnTgSubmit2Fa.textContent = 'Autenticando...';

  try {
    const res = await fetch('/api/telegram/auth/2fa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Autenticação 2FA concluída!', 'success');
    } else {
      showToast(`Erro 2FA: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    btnTgSubmit2Fa.disabled = false;
    btnTgSubmit2Fa.textContent = 'Autenticar 2FA';
  }
});

btnTgLogout?.addEventListener('click', async () => {
  if (!confirm('Deseja desconectar o Telegram?')) return;
  try {
    await fetch('/api/telegram/logout', { method: 'POST' });
    showToast('Telegram desconectado.', 'info');
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
});

// --- WhatsApp Action Handlers ---
btnWaReconnect?.addEventListener('click', async () => {
  waQrPlaceholder?.classList.remove('hidden');
  waQrImg?.classList.add('hidden');
  try {
    await fetch('/api/whatsapp/connect', { method: 'POST' });
    showToast('Gerando novo QR Code...', 'info');
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
});

btnWaDisconnect?.addEventListener('click', async () => {
  if (!confirm('Deseja desconectar o WhatsApp?')) return;
  try {
    await fetch('/api/whatsapp/disconnect', { method: 'POST' });
    showToast('WhatsApp desconectado.', 'info');
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
});

// WhatsApp Channel List Loader
btnLoadChats?.addEventListener('click', async () => {
  if (!btnLoadChats) return;
  btnLoadChats.disabled = true;
  btnLoadChats.textContent = 'Buscando...';
  try {
    const res = await fetch('/api/whatsapp/chats');
    const json = await res.json();
    if (json.success && json.chats && json.chats.length > 0) {
      chatSelectDropdown.innerHTML = '<option value="">-- Selecione um Canal do WhatsApp --</option>';
      const channels = json.chats.filter((c) => c.type === 'channel' || c.id.endsWith('@newsletter'));

      if (channels.length > 0) {
        channels.forEach((chat) => {
          const opt = document.createElement('option');
          opt.value = chat.id;
          opt.textContent = `${chat.name || chat.id}`;
          chatSelectDropdown.appendChild(opt);
        });
        chatSelectDropdown.classList.remove('hidden');
        showToast(`${channels.length} canais encontrados!`, 'success');
      } else {
        showToast('Nenhum canal encontrado na conta.', 'warning');
      }
    } else {
      showToast('Nenhum canal encontrado. Conecte o WhatsApp primeiro.', 'warning');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    btnLoadChats.disabled = false;
    btnLoadChats.textContent = '📢 Listar Meus Canais';
  }
});

chatSelectDropdown?.addEventListener('change', () => {
  if (chatSelectDropdown.value && cfgDestJid) {
    cfgDestJid.value = chatSelectDropdown.value;
    const selectedText = chatSelectDropdown.options[chatSelectDropdown.selectedIndex].text;
    if (resolvedJidBadge) {
      resolvedJidBadge.textContent = `Destino: ${selectedText} (${chatSelectDropdown.value})`;
      resolvedJidBadge.classList.remove('hidden');
    }
  }
});

// --- Mercado Livre OAuth Refresh ---
async function loadMeliTokenStatus() {
  try {
    const res = await fetch('/api/meli/tokens');
    const json = await res.json();
    if (json.success && json.status) {
      const st = json.status;
      if (st.hasAccessToken && !st.isExpired) {
        if (meliTokenBadge) {
          meliTokenBadge.textContent = `OAuth Ativo (${Math.floor(st.expiresInMinutes / 60)}h ${st.expiresInMinutes % 60}m)`;
          meliTokenBadge.className = 'badge badge-green';
        }
        if (meliTokenExpireInfo) {
          meliTokenExpireInfo.textContent = `Expira em: ${st.expiresAtDate} (Renovação automática 24h ativa)`;
        }
      } else if (st.hasAccessToken && st.isExpired) {
        if (meliTokenBadge) {
          meliTokenBadge.textContent = 'Token Expirado (Renovável)';
          meliTokenBadge.className = 'badge badge-yellow';
        }
      }
    }
  } catch {
    // ignore
  }
}

btnRefreshMeliToken?.addEventListener('click', async () => {
  const clientId = document.getElementById('cfgMlAppId')?.value.trim() || '';
  const clientSecret = document.getElementById('cfgMlSecretKey')?.value.trim() || '';

  btnRefreshMeliToken.disabled = true;
  btnRefreshMeliToken.textContent = 'Renovando...';
  try {
    const res = await fetch('/api/meli/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Token renovado com sucesso!', 'success');
      loadMeliTokenStatus();
    } else {
      showToast(`Erro na renovação: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro ao renovar: ${err.message}`, 'error');
  } finally {
    btnRefreshMeliToken.disabled = false;
    btnRefreshMeliToken.textContent = '🔄 Renovar Token Agora';
  }
});

// --- Save Configurations ---
async function saveAllConfig(btn) {
  const sourceChannel = cfgSourceChannel?.value.trim() || '';
  const destinationJid = cfgDestJid?.value.trim() || '';
  const active = forwarderActiveSwitch ? forwarderActiveSwitch.checked : true;

  const shopeeAppId = document.getElementById('cfgShopeeAppId')?.value.trim() || '';
  const shopeeAppSecret = document.getElementById('cfgShopeeAppSecret')?.value.trim() || '';
  const mlAffiliateTag = document.getElementById('cfgMlTag')?.value.trim() || '';
  const mlListShortUrl = document.getElementById('cfgMlListUrl')?.value.trim() || '';
  const mlAppId = document.getElementById('cfgMlAppId')?.value.trim() || '';
  const mlSecretKey = document.getElementById('cfgMlSecretKey')?.value.trim() || '';
  const amazonTag = document.getElementById('cfgAmazonTag')?.value.trim() || '';
  const magaluTag = document.getElementById('cfgMagaluTag')?.value.trim() || '';
  const aliexpressAppKey = document.getElementById('cfgAliAppKey')?.value.trim() || '';
  const aliexpressAppSecret = document.getElementById('cfgAliAppSecret')?.value.trim() || '';
  const aliexpressTrackingId = document.getElementById('cfgAliTrackingId')?.value.trim() || '';

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Salvando...';
  }

  try {
    let resolvedDest = destinationJid;
    if (destinationJid.includes('whatsapp.com/')) {
      const resResolve = await fetch('/api/whatsapp/resolve-jid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: destinationJid })
      });
      const jsonResolve = await resResolve.json();
      if (jsonResolve.success && jsonResolve.jid) {
        resolvedDest = jsonResolve.jid;
        if (cfgDestJid) cfgDestJid.value = resolvedDest;
      }
    }

    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram: { sourceChannel },
        whatsapp: { destinationJid: resolvedDest },
        forwarder: { active },
        affiliate: {
          shopeeAppId,
          shopeeAppSecret,
          mlAffiliateTag,
          meliAffiliateTag: mlAffiliateTag,
          mlListShortUrl,
          mlAppId,
          mlSecretKey,
          amazonTag,
          magaluTag,
          aliexpressAppKey,
          aliexpressAppSecret,
          aliexpressTrackingId
        }
      })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Configurações salvas com sucesso!', 'success');
      closeAllModals();
    } else {
      showToast(`Erro ao salvar: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '💾 Salvar Configurações';
    }
  }
}

btnSaveConfig?.addEventListener('click', () => saveAllConfig(btnSaveConfig));
btnSaveConfigRouting?.addEventListener('click', () => saveAllConfig(btnSaveConfigRouting));

// --- Simulator / Manual Send ---
btnSimulate?.addEventListener('click', async () => {
  const text = simText?.value.trim() || '';
  const imageUrl = simImage?.value.trim() || '';

  if (!cfgDestJid?.value.trim()) {
    showToast('Informe o canal de destino antes de simular.', 'error');
    return;
  }

  btnSimulate.disabled = true;
  btnSimulate.textContent = 'Enviando oferta...';

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, imageUrl })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Oferta disparada com sucesso no WhatsApp!', 'success');
      closeAllModals();
    } else {
      showToast(`Erro no envio: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    btnSimulate.disabled = false;
    btnSimulate.textContent = '🚀 Disparar Oferta no WhatsApp';
  }
});

// --- Affiliate Link Tester ---
const btnTestAffiliate = document.getElementById('btnTestAffiliate');
const testAffInput = document.getElementById('testAffInput');
const affTestResultBox = document.getElementById('affTestResultBox');

btnTestAffiliate?.addEventListener('click', async () => {
  const input = testAffInput?.value.trim() || '';
  if (!input) {
    showToast('Insira um link ou texto para testar.', 'error');
    return;
  }

  btnTestAffiliate.disabled = true;
  btnTestAffiliate.textContent = 'Processando conversão...';

  try {
    const res = await fetch('/api/affiliate/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input })
    });
    const json = await res.json();

    if (json.success) {
      if (!json.results || json.results.length === 0) {
        affTestResultBox.innerHTML = `
          <div class="aff-res-row">
            <span class="aff-res-label">Resultado:</span>
            <span class="aff-res-val">Nenhum link monitorado identificado.</span>
          </div>
        `;
      } else {
        let html = '';
        json.results.forEach((r, idx) => {
          html += `
            <div class="aff-res-row">
              <span class="aff-res-label">#${idx + 1} Loja:</span>
              <span class="aff-res-val highlight">${escapeHtml(r.store)}</span>
            </div>
            <div class="aff-res-row">
              <span class="aff-res-label">Link Original:</span>
              <span class="aff-res-val">${escapeHtml(r.originalUrl)}</span>
            </div>
            <div class="aff-res-row">
              <span class="aff-res-label">Link de Afiliado Gerado:</span>
              <span class="aff-res-val highlight">${escapeHtml(r.affiliateUrl)}</span>
            </div>
            <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 0.4rem 0;">
          `;
        });
        html += `
          <div class="aff-res-row">
            <span class="aff-res-label">Texto Formatado Final:</span>
            <span class="aff-res-val" style="white-space: pre-wrap;">${escapeHtml(json.text)}</span>
          </div>
        `;
        affTestResultBox.innerHTML = html;
      }
      affTestResultBox.classList.remove('hidden');
      showToast('Link testado com sucesso!', 'success');
    } else {
      showToast(`Erro: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    btnTestAffiliate.disabled = false;
    btnTestAffiliate.textContent = '⚡ Testar Conversão de Link';
  }
});

// --- Forwarder Master Switch ---
forwarderActiveSwitch?.addEventListener('change', async () => {
  const active = forwarderActiveSwitch.checked;
  if (forwarderStatusLabel) {
    forwarderStatusLabel.textContent = active ? 'Repasse: Ativo' : 'Repasse: Pausado';
  }
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forwarder: { active } })
    });
    showToast(active ? 'Repasse automático ativado!' : 'Repasse pausado.', 'info');
  } catch (err) {
    console.error(err);
  }
});

// --- Logs & Terminal Controls ---
autoScrollCheck?.addEventListener('change', () => {
  appState.autoScroll = autoScrollCheck.checked;
});

btnClearLogs?.addEventListener('click', async () => {
  try {
    await fetch('/api/logs/clear', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }
});

// --- Initial Load ---
async function loadConfigDirectly() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    if (config) {
      appState.config = config;
      updateConfigUI(config);
    }
  } catch (err) {
    console.error('Erro ao carregar config:', err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  loadConfigDirectly();
  loadMeliTokenStatus();
  setupSSE();
});
