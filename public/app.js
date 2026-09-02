// State
let appState = {
  config: null,
  telegram: null,
  whatsapp: null,
  feed: [],
  autoScroll: true
};

// DOM Elements
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
const tgActiveChannel = document.getElementById('tgActiveChannel');

const btnTgSendCode = document.getElementById('btnTgSendCode');
const btnTgVerifyCode = document.getElementById('btnTgVerifyCode');
const btnTgCancelCode = document.getElementById('btnTgCancelCode');
const btnTgSubmit2Fa = document.getElementById('btnTgSubmit2Fa');
const btnTgLogout = document.getElementById('btnTgLogout');

const waBadge = document.getElementById('waBadge');
const waQrSection = document.getElementById('waQrSection');
const waConnectedSection = document.getElementById('waConnectedSection');
const waQrImg = document.getElementById('waQrImg');
const waQrPlaceholder = document.getElementById('waQrPlaceholder');
const btnWaReconnect = document.getElementById('btnWaReconnect');
const btnWaDisconnect = document.getElementById('btnWaDisconnect');

const forwarderActiveSwitch = document.getElementById('forwarderActiveSwitch');
const forwarderStatusLabel = document.getElementById('forwarderStatusLabel');
const cfgSourceChannel = document.getElementById('cfgSourceChannel');
const cfgDestJid = document.getElementById('cfgDestJid');
const btnSaveConfig = document.getElementById('btnSaveConfig');

// Pipeline DOM
const nodeTelegram = document.getElementById('nodeTelegram');
const nodeProcessor = document.getElementById('nodeProcessor');
const nodeWhatsApp = document.getElementById('nodeWhatsApp');
const pipeTgChannel = document.getElementById('pipeTgChannel');
const pipeTgBadge = document.getElementById('pipeTgBadge');
const pipeProcessorStatus = document.getElementById('pipeProcessorStatus');
const pipeProcessorBadge = document.getElementById('pipeProcessorBadge');
const pipeWaDest = document.getElementById('pipeWaDest');
const pipeWaBadge = document.getElementById('pipeWaBadge');

// Feed DOM
const feedContainer = document.getElementById('feedContainer');
const emptyFeedMsg = document.getElementById('emptyFeedMsg');
const feedCountBadge = document.getElementById('feedCountBadge');

// Simulator DOM
const simText = document.getElementById('simText');
const simImage = document.getElementById('simImage');
const btnSimulate = document.getElementById('btnSimulate');

// Terminal DOM
const logTerminal = document.getElementById('logTerminal');
const autoScrollCheck = document.getElementById('autoScrollCheck');
const btnClearLogs = document.getElementById('btnClearLogs');
const toastEl = document.getElementById('toast');

// --- Toast Notification ---
function showToast(message, type = 'info') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type}`;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 4000);
}

// --- SSE Setup ---
function setupSSE() {
  const eventSource = new EventSource('/api/events');

  eventSource.addEventListener('init', (e) => {
    const data = JSON.parse(e.data);
    appState.config = data.config;
    updateConfigUI(data.config);
    updateTelegramUI(data.telegram);
    updateWhatsAppUI(data.whatsapp);
    
    if (data.logs) {
      logTerminal.innerHTML = '';
      data.logs.forEach(appendLog);
    }

    if (data.feed) {
      appState.feed = data.feed;
      renderFeed(data.feed);
    }
  });

  eventSource.addEventListener('log', (e) => {
    const entry = JSON.parse(e.data);
    appendLog(entry);
  });

  eventSource.addEventListener('logs_cleared', () => {
    logTerminal.innerHTML = '';
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
    triggerPulseAnimation();
  });

  eventSource.addEventListener('message_updated', (e) => {
    const item = JSON.parse(e.data);
    updateFeedItemStatus(item);
  });

  eventSource.onerror = () => {
    console.warn('SSE desconectado, tentando reconectar...');
  };
}

// --- Trigger Visual Pulse when Message arrives ---
function triggerPulseAnimation() {
  nodeProcessor.classList.add('active');
  pipeProcessorStatus.textContent = '⚡ Repassando mensagem...';
  setTimeout(() => {
    nodeProcessor.classList.remove('active');
    pipeProcessorStatus.textContent = 'Aguardando Mensagens';
  }, 2000);
}

// --- Log Rendering ---
function appendLog(entry) {
  const logDiv = document.createElement('div');
  logDiv.className = `log-entry ${entry.module.toLowerCase()} ${entry.level}`;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${entry.timestamp}]`;

  const tagSpan = document.createElement('span');
  tagSpan.className = 'log-tag';
  tagSpan.textContent = `[${entry.module}]`;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = entry.message;

  logDiv.appendChild(timeSpan);
  logDiv.appendChild(tagSpan);
  logDiv.appendChild(msgSpan);

  logTerminal.appendChild(logDiv);

  if (appState.autoScroll) {
    logTerminal.scrollTop = logTerminal.scrollHeight;
  }
}

// --- Feed UI Rendering ---
function renderFeed(items) {
  feedContainer.innerHTML = '';
  if (!items || items.length === 0) {
    feedContainer.appendChild(emptyFeedMsg);
    feedCountBadge.textContent = '0 itens';
    return;
  }
  feedCountBadge.textContent = `${items.length} itens`;
  items.forEach((item) => addFeedItemUI(item, false));
}

function addFeedItemUI(item, prepend = true) {
  emptyFeedMsg.remove();

  const itemEl = document.createElement('div');
  itemEl.className = 'feed-item';
  itemEl.id = `feed-${item.id}`;

  let mediaHtml = '';
  if (item.mediaBase64) {
    mediaHtml = `<img src="${item.mediaBase64}" class="feed-thumb" alt="Thumbnail">`;
  } else {
    mediaHtml = `<div class="feed-no-thumb">📝</div>`;
  }

  const statusLabel = {
    success: 'Entregue no WhatsApp',
    failed: `Falhou: ${item.error || 'Erro'}`,
    pending: 'Enviando...'
  }[item.status] || item.status;

  const statusClass = item.status;

  itemEl.innerHTML = `
    ${mediaHtml}
    <div class="feed-content">
      <div class="feed-header">
        <span class="feed-origin">${item.channel || 'Telegram'} #${item.telegramMessageId}</span>
        <span class="feed-time">${item.timestamp}</span>
      </div>
      <div class="feed-text">${escapeHtml(item.text || '[Apenas mídia]')}</div>
      <div class="feed-footer">
        <span class="feed-dest">Destino: ${escapeHtml(item.destinationJid)}</span>
        <span class="feed-status ${statusClass}">${statusLabel}</span>
      </div>
    </div>
  `;

  if (prepend) {
    feedContainer.prepend(itemEl);
  } else {
    feedContainer.appendChild(itemEl);
  }

  const count = feedContainer.querySelectorAll('.feed-item').length;
  feedCountBadge.textContent = `${count} itens`;
}

function updateFeedItemStatus(item) {
  const itemEl = document.getElementById(`feed-${item.id}`);
  if (!itemEl) return;

  const statusEl = itemEl.querySelector('.feed-status');
  if (statusEl) {
    statusEl.className = `feed-status ${item.status}`;
    statusEl.textContent = {
      success: 'Entregue no WhatsApp',
      failed: `Falhou: ${item.error || 'Erro'}`,
      pending: 'Enviando...'
    }[item.status] || item.status;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Config UI ---
function updateConfigUI(config) {
  if (!config) return;
  cfgSourceChannel.value = config.telegram.sourceChannel || '';
  cfgDestJid.value = config.whatsapp.destinationJid || '';
  
  if (config.telegram.apiId) tgApiId.value = config.telegram.apiId;
  if (config.telegram.apiHash) tgApiHash.value = config.telegram.apiHash;
  if (config.telegram.phoneNumber) tgPhone.value = config.telegram.phoneNumber;

  const cfgMlAppId = document.getElementById('cfgMlAppId');
  const cfgMlSecretKey = document.getElementById('cfgMlSecretKey');
  const cfgMlTag = document.getElementById('cfgMlTag');
  if (cfgMlAppId && config.affiliate?.mlAppId) cfgMlAppId.value = config.affiliate.mlAppId;
  if (cfgMlSecretKey && config.affiliate?.mlSecretKey) cfgMlSecretKey.value = config.affiliate.mlSecretKey;
  if (cfgMlTag && (config.affiliate?.mlAffiliateTag || config.affiliate?.meliAffiliateTag)) {
    cfgMlTag.value = config.affiliate.mlAffiliateTag || config.affiliate.meliAffiliateTag;
  }

  loadMeliTokenStatus();

  forwarderActiveSwitch.checked = !!config.forwarder.active;
  forwarderStatusLabel.textContent = config.forwarder.active ? 'Repasse: Ativo' : 'Repasse: Pausado';

  pipeTgChannel.textContent = config.telegram.sourceChannel || '@não_configurado';
  pipeWaDest.textContent = config.whatsapp.destinationJid || 'JID não configurado';

  if (!config.forwarder.active) {
    pipeProcessorBadge.textContent = 'Pausado';
    pipeProcessorBadge.className = 'node-status badge-disconnected';
  } else {
    pipeProcessorBadge.textContent = 'Ativo';
    pipeProcessorBadge.className = 'node-status badge-connected';
  }
}

// --- Telegram UI ---
function updateTelegramUI(statusObj) {
  if (!statusObj) return;
  const status = statusObj.status;

  tgAuthForm.classList.add('hidden');
  tgCodeStep.classList.add('hidden');
  tg2FaStep.classList.add('hidden');
  tgConnectedStep.classList.add('hidden');

  if (status === 'connected') {
    tgBadge.textContent = 'Conectado';
    tgBadge.className = 'badge badge-connected';
    tgConnectedStep.classList.remove('hidden');
    tgActiveChannel.textContent = statusObj.channel ? `@${statusObj.channel}` : 'Nenhum canal ativo';

    nodeTelegram.classList.add('active');
    pipeTgBadge.textContent = 'Conectado';
    pipeTgBadge.className = 'node-status badge-connected';
  } else if (status === 'waiting_code') {
    tgBadge.textContent = 'Aguardando Código';
    tgBadge.className = 'badge badge-connecting';
    tgCodeStep.classList.remove('hidden');
    pipeTgBadge.textContent = 'Aguardando Código';
    pipeTgBadge.className = 'node-status';
  } else if (status === 'waiting_2fa') {
    tgBadge.textContent = 'Aguardando 2FA';
    tgBadge.className = 'badge badge-connecting';
    tg2FaStep.classList.remove('hidden');
    pipeTgBadge.textContent = 'Aguardando 2FA';
    pipeTgBadge.className = 'node-status';
  } else if (status === 'connecting') {
    tgBadge.textContent = 'Conectando...';
    tgBadge.className = 'badge badge-connecting';
    tgAuthForm.classList.remove('hidden');
    pipeTgBadge.textContent = 'Conectando...';
    pipeTgBadge.className = 'node-status';
  } else {
    tgBadge.textContent = 'Desconectado';
    tgBadge.className = 'badge badge-disconnected';
    tgAuthForm.classList.remove('hidden');
    nodeTelegram.classList.remove('active');
    pipeTgBadge.textContent = 'Desconectado';
    pipeTgBadge.className = 'node-status';
  }
}

// --- WhatsApp UI ---
function updateWhatsAppUI(statusObj) {
  if (!statusObj) return;
  const status = statusObj.status;

  if (status === 'connected') {
    waBadge.textContent = 'Conectado';
    waBadge.className = 'badge badge-connected';
    waQrSection.classList.add('hidden');
    waConnectedSection.classList.remove('hidden');

    nodeWhatsApp.classList.add('active');
    pipeWaBadge.textContent = 'Conectado';
    pipeWaBadge.className = 'node-status badge-connected';
  } else if (status === 'connecting') {
    waBadge.textContent = 'Aguardando QR';
    waBadge.className = 'badge badge-connecting';
    waQrSection.classList.remove('hidden');
    waConnectedSection.classList.add('hidden');
    if (statusObj.qrCode) {
      renderQr(statusObj.qrCode);
    }
    pipeWaBadge.textContent = 'Aguardando QR';
    pipeWaBadge.className = 'node-status';
  } else {
    waBadge.textContent = 'Desconectado';
    waBadge.className = 'badge badge-disconnected';
    waQrSection.classList.remove('hidden');
    waConnectedSection.classList.add('hidden');
    waQrImg.classList.add('hidden');
    waQrPlaceholder.classList.remove('hidden');
    nodeWhatsApp.classList.remove('active');
    pipeWaBadge.textContent = 'Desconectado';
    pipeWaBadge.className = 'node-status';
  }
}

function renderQr(dataUrl) {
  waQrPlaceholder.classList.add('hidden');
  waQrImg.src = dataUrl;
  waQrImg.classList.remove('hidden');
}

// --- Event Handlers ---

// Telegram: Send Login Code
btnTgSendCode.addEventListener('click', async () => {
  const apiId = tgApiId.value.trim();
  const apiHash = tgApiHash.value.trim();
  const phoneNumber = tgPhone.value.trim();

  if (!apiId || !apiHash || !phoneNumber) {
    showToast('Preencha API ID, API Hash e Telefone.', 'error');
    return;
  }

  btnTgSendCode.disabled = true;
  btnTgSendCode.textContent = 'Enviando código...';

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
    showToast(`Erro ao enviar código: ${err.message}`, 'error');
  } finally {
    btnTgSendCode.disabled = false;
    btnTgSendCode.textContent = 'Enviar Código de Login';
  }
});

// Telegram: Verify Code
btnTgVerifyCode.addEventListener('click', async () => {
  const code = tgCode.value.trim();
  if (!code) {
    showToast('Digite o código de verificação recebido.', 'error');
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
      if (json.connected) {
        showToast('Login no Telegram realizado com sucesso!', 'success');
      }
    } else {
      showToast(`Erro: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro na validação: ${err.message}`, 'error');
  } finally {
    btnTgVerifyCode.disabled = false;
    btnTgVerifyCode.textContent = 'Confirmar Código';
  }
});

// Telegram: Cancel Code input
btnTgCancelCode.addEventListener('click', () => {
  tgCodeStep.classList.add('hidden');
  tgAuthForm.classList.remove('hidden');
  tgBadge.textContent = 'Desconectado';
  tgBadge.className = 'badge badge-disconnected';
});

// Telegram: Submit 2FA Password
btnTgSubmit2Fa.addEventListener('click', async () => {
  const password = tg2FaPass.value.trim();
  if (!password) {
    showToast('Digite sua senha de 2 etapas (2FA).', 'error');
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
      showToast('Autenticação 2FA concluída com sucesso!', 'success');
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

// Telegram: Logout
btnTgLogout.addEventListener('click', async () => {
  if (!confirm('Deseja realmente desconectar o Telegram?')) return;
  try {
    await fetch('/api/telegram/logout', { method: 'POST' });
    showToast('Telegram desconectado.', 'info');
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
});

// WhatsApp: Reconnect / Regenerate QR
btnWaReconnect.addEventListener('click', async () => {
  waQrPlaceholder.classList.remove('hidden');
  waQrImg.classList.add('hidden');
  try {
    await fetch('/api/whatsapp/connect', { method: 'POST' });
    showToast('Solicitando novo QR Code...', 'info');
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
});

// WhatsApp: Disconnect
btnWaDisconnect.addEventListener('click', async () => {
  if (!confirm('Deseja realmente desconectar o WhatsApp?')) return;
  try {
    await fetch('/api/whatsapp/disconnect', { method: 'POST' });
    showToast('WhatsApp desconectado.', 'info');
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
});

// WhatsApp Group Picker & Resolver DOM
const btnLoadChats = document.getElementById('btnLoadChats');
const chatSelectDropdown = document.getElementById('chatSelectDropdown');
const resolvedJidBadge = document.getElementById('resolvedJidBadge');

// Load User's WhatsApp Groups & Channels
btnLoadChats?.addEventListener('click', async () => {
  btnLoadChats.disabled = true;
  btnLoadChats.textContent = 'Carregando...';
  try {
    const res = await fetch('/api/whatsapp/chats');
    const json = await res.json();
    if (json.success && json.chats && json.chats.length > 0) {
      chatSelectDropdown.innerHTML = '<option value="">-- Selecione um grupo ou canal --</option>';

      const channels = json.chats.filter((c) => c.type === 'channel');
      const groups = json.chats.filter((c) => c.type === 'group');

      if (channels.length > 0) {
        const optGroupChannels = document.createElement('optgroup');
        optGroupChannels.label = `📢 CANAIS (${channels.length})`;
        channels.forEach((chat) => {
          const opt = document.createElement('option');
          opt.value = chat.id;
          opt.textContent = `📢 ${chat.name}`;
          optGroupChannels.appendChild(opt);
        });
        chatSelectDropdown.appendChild(optGroupChannels);
      }

      if (groups.length > 0) {
        const optGroupGroups = document.createElement('optgroup');
        optGroupGroups.label = `👥 GRUPOS (${groups.length})`;
        groups.forEach((chat) => {
          const opt = document.createElement('option');
          opt.value = chat.id;
          opt.textContent = `👥 ${chat.name}`;
          optGroupGroups.appendChild(opt);
        });
        chatSelectDropdown.appendChild(optGroupGroups);
      }

      chatSelectDropdown.classList.remove('hidden');
      showToast(`${json.chats.length} destinos carregados (${channels.length} canais, ${groups.length} grupos)!`, 'success');
    } else {
      showToast('Nenhum grupo ou canal encontrado.', 'warning');
    }
  } catch (err) {
    showToast(`Erro ao carregar lista: ${err.message}`, 'error');
  } finally {
    btnLoadChats.disabled = false;
    btnLoadChats.textContent = '📋 Listar meus Grupos & Canais';
  }
});

chatSelectDropdown?.addEventListener('change', () => {
  if (chatSelectDropdown.value) {
    cfgDestJid.value = chatSelectDropdown.value;
    const selectedText = chatSelectDropdown.options[chatSelectDropdown.selectedIndex].text;
    resolvedJidBadge.textContent = `Destino selecionado: ${selectedText} ➔ JID: ${chatSelectDropdown.value}`;
    resolvedJidBadge.classList.remove('hidden');
  }
});

// Auto-resolve JID on input blur / change
async function checkAndResolveJid(val) {
  if (!val || val.length < 5) {
    resolvedJidBadge.classList.add('hidden');
    return;
  }
  try {
    const res = await fetch('/api/whatsapp/resolve-jid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: val })
    });
    const json = await res.json();
    if (json.success) {
      const typeLabel = json.type === 'channel' ? 'Canal Detectado' : json.type === 'group' ? 'Grupo Detectado' : 'Contato';
      resolvedJidBadge.textContent = `✅ ${typeLabel}: ${json.name || ''} ➔ JID: ${json.jid}`;
      resolvedJidBadge.classList.remove('hidden');
    }
  } catch {
    // ignore
  }
}

cfgDestJid.addEventListener('blur', () => {
  checkAndResolveJid(cfgDestJid.value.trim());
});

// ML OAuth Tokens DOM
const meliTokenBadge = document.getElementById('meliTokenBadge');
const meliTokenExpireInfo = document.getElementById('meliTokenExpireInfo');
const btnRefreshMeliToken = document.getElementById('btnRefreshMeliToken');
const cfgMlAccessToken = document.getElementById('cfgMlAccessToken');
const cfgMlRefreshToken = document.getElementById('cfgMlRefreshToken');
const btnOpenMlAuth = document.getElementById('btnOpenMlAuth');
const btnExchangeMlCode = document.getElementById('btnExchangeMlCode');
const mlAuthCodeInput = document.getElementById('mlAuthCodeInput');

function updateMeliAuthLink() {
  const appId = document.getElementById('cfgMlAppId')?.value.trim() || '6282693331910478';
  if (btnOpenMlAuth) {
    btnOpenMlAuth.href = `https://auth.mercadolibre.com/authorization?response_type=code&client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent('https://localhost')}`;
  }
}

document.getElementById('cfgMlAppId')?.addEventListener('input', updateMeliAuthLink);

btnExchangeMlCode?.addEventListener('click', async () => {
  let raw = mlAuthCodeInput?.value.trim() || '';
  if (!raw) {
    showToast('Cole o código TG-... ou a URL de redirecionamento.', 'error');
    return;
  }

  // If user pasted full URL: extract code param
  if (raw.includes('code=')) {
    try {
      const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
      raw = url.searchParams.get('code') || raw;
    } catch {
      const match = raw.match(/code=([^&]+)/);
      if (match) raw = match[1];
    }
  }

  const clientId = document.getElementById('cfgMlAppId')?.value.trim();
  const clientSecret = document.getElementById('cfgMlSecretKey')?.value.trim();

  if (!clientId || !clientSecret) {
    showToast('Preencha seu App ID e Client Secret antes de gerar tokens.', 'error');
    return;
  }

  btnExchangeMlCode.disabled = true;
  btnExchangeMlCode.textContent = 'Gerando...';

  try {
    // First save App ID & Client Secret
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        affiliate: {
          mlAppId: clientId,
          mlSecretKey: clientSecret
        }
      })
    });

    const res = await fetch('/api/meli/auth-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: raw,
        redirectUri: 'https://localhost'
      })
    });

    const json = await res.json();
    if (json.success) {
      showToast('Tokens gerados e salvos com sucesso no Mercado Livre!', 'success');
      if (mlAuthCodeInput) mlAuthCodeInput.value = '';
      loadMeliTokenStatus();
    } else {
      showToast(`Erro ao gerar tokens: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  } finally {
    btnExchangeMlCode.disabled = false;
    btnExchangeMlCode.textContent = '⚡ Gerar Tokens';
  }
});

async function loadMeliTokenStatus() {
  updateMeliAuthLink();
  try {
    const res = await fetch('/api/meli/tokens');
    const json = await res.json();
    if (json.success && json.status) {
      const st = json.status;
      if (st.hasAccessToken && !st.isExpired) {
        meliTokenBadge.textContent = `Token Ativo (${Math.floor(st.expiresInMinutes / 60)}h ${st.expiresInMinutes % 60}m)`;
        meliTokenBadge.className = 'badge badge-connected';
        meliTokenExpireInfo.textContent = `Expira em: ${st.expiresAtDate}`;
      } else if (st.hasAccessToken && st.isExpired) {
        meliTokenBadge.textContent = 'Token Expirado (Renovável)';
        meliTokenBadge.className = 'badge badge-connecting';
        meliTokenExpireInfo.textContent = 'Clique em "Renovar Token" para atualizar';
      } else {
        meliTokenBadge.textContent = 'Token Ausente';
        meliTokenBadge.className = 'badge badge-disconnected';
        meliTokenExpireInfo.textContent = 'Informe os tokens ou gere via botão acima';
      }
    }
  } catch {
    // ignore
  }
}

btnRefreshMeliToken?.addEventListener('click', async () => {
  const refreshToken = cfgMlRefreshToken?.value.trim() || '';
  const accessToken = cfgMlAccessToken?.value.trim() || '';
  const clientId = document.getElementById('cfgMlAppId')?.value.trim() || '';
  const clientSecret = document.getElementById('cfgMlSecretKey')?.value.trim() || '';

  btnRefreshMeliToken.disabled = true;
  btnRefreshMeliToken.textContent = 'Renovando...';
  try {
    const res = await fetch('/api/meli/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refreshToken,
        access_token: accessToken,
        client_id: clientId,
        client_secret: clientSecret
      })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Token renovado com sucesso via OAuth!', 'success');
      if (cfgMlAccessToken) cfgMlAccessToken.value = '';
      if (cfgMlRefreshToken) cfgMlRefreshToken.value = '';
      loadMeliTokenStatus();
    } else {
      showToast(`Erro na renovação: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro ao renovar token: ${err.message}`, 'error');
  } finally {
    btnRefreshMeliToken.disabled = false;
    btnRefreshMeliToken.textContent = '🔄 Renovar Token Agora';
  }
});

// Save Config
btnSaveConfig.addEventListener('click', async () => {
  const sourceChannel = cfgSourceChannel.value.trim();
  const destinationJid = cfgDestJid.value.trim();
  const active = forwarderActiveSwitch.checked;

  const mlAppId = document.getElementById('cfgMlAppId')?.value.trim() || '';
  const mlSecretKey = document.getElementById('cfgMlSecretKey')?.value.trim() || '';
  const mlAffiliateTag = document.getElementById('cfgMlTag')?.value.trim() || '';
  const accessToken = cfgMlAccessToken?.value.trim() || '';
  const refreshToken = cfgMlRefreshToken?.value.trim() || '';

  try {
    // If access_token or refresh_token was provided in inputs, save them
    if (accessToken || refreshToken) {
      await fetch('/api/meli/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken
        })
      });
      if (cfgMlAccessToken) cfgMlAccessToken.value = '';
      if (cfgMlRefreshToken) cfgMlRefreshToken.value = '';
    }

    // Resolve destination if it's a channel/group invite link
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
        cfgDestJid.value = resolvedDest;
        showToast(`Link resolvido para: ${jsonResolve.jid}`, 'success');
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
          mlAppId,
          mlSecretKey,
          mlAffiliateTag,
          meliAffiliateTag: mlAffiliateTag
        }
      })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Configurações salvas com sucesso!', 'success');
      loadMeliTokenStatus();
    } else {
      showToast(`Erro ao salvar: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
});

// Affiliate Link Tester
const btnTestAffiliate = document.getElementById('btnTestAffiliate');
const testAffInput = document.getElementById('testAffInput');
const affTestResultBox = document.getElementById('affTestResultBox');

btnTestAffiliate?.addEventListener('click', async () => {
  const input = testAffInput.value.trim();
  if (!input) {
    showToast('Insira um link ou texto para testar a conversão.', 'error');
    return;
  }

  btnTestAffiliate.disabled = true;
  btnTestAffiliate.textContent = 'Processando e resolvendo redirecionamento...';

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
            <span class="aff-res-val">Nenhum link de loja monitorada (ML, Shopee, Magalu, Ali) encontrado no texto.</span>
          </div>
        `;
      } else {
        let html = '';
        json.results.forEach((r, idx) => {
          html += `
            <div class="aff-res-row">
              <span class="aff-res-label">#${idx + 1} Loja Identificada:</span>
              <span class="aff-res-val highlight">${r.store}</span>
            </div>
            <div class="aff-res-row">
              <span class="aff-res-label">Link Original:</span>
              <span class="aff-res-val">${escapeHtml(r.originalUrl)}</span>
            </div>
            <div class="aff-res-row">
              <span class="aff-res-label">Link Final Resolvido (após redirects):</span>
              <span class="aff-res-val">${escapeHtml(r.finalResolvedUrl)}</span>
            </div>
            <div class="aff-res-row">
              <span class="aff-res-label">Link de Afiliado Gerado:</span>
              <span class="aff-res-val highlight">${escapeHtml(r.affiliateUrl)}</span>
            </div>
            <hr style="border: 0; border-top: 1px solid var(--border-color); margin: 0.3rem 0;">
          `;
        });
        html += `
          <div class="aff-res-row">
            <span class="aff-res-label">Texto Final da Mensagem:</span>
            <span class="aff-res-val" style="white-space: pre-wrap;">${escapeHtml(json.text)}</span>
          </div>
        `;
        affTestResultBox.innerHTML = html;
      }
      affTestResultBox.classList.remove('hidden');
      showToast('Conversão de link testada com sucesso!', 'success');
    } else {
      showToast(`Erro: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro no teste: ${err.message}`, 'error');
  } finally {
    btnTestAffiliate.disabled = false;
    btnTestAffiliate.textContent = '⚡ Testar Conversão de Link';
  }
});

// Simulator / Quick Test
btnSimulate.addEventListener('click', async () => {
  const text = simText.value.trim();
  const imageUrl = simImage.value.trim();

  if (!cfgDestJid.value.trim()) {
    showToast('Informe o JID de Destino no formulário acima antes de testar.', 'error');
    return;
  }

  btnSimulate.disabled = true;
  btnSimulate.textContent = 'Enviando...';

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, imageUrl })
    });
    const json = await res.json();
    if (json.success) {
      showToast('Oferta de teste enviada com sucesso!', 'success');
    } else {
      showToast(`Erro no envio: ${json.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro ao simular: ${err.message}`, 'error');
  } finally {
    btnSimulate.disabled = false;
    btnSimulate.textContent = '🚀 Disparar Oferta de Teste';
  }
});

// Forwarder Switch
forwarderActiveSwitch.addEventListener('change', async () => {
  const active = forwarderActiveSwitch.checked;
  forwarderStatusLabel.textContent = active ? 'Repasse: Ativo' : 'Repasse: Pausado';
  try {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        forwarder: { active }
      })
    });
    showToast(active ? 'Repasse automático ativado!' : 'Repasse pausado.', 'info');
  } catch (err) {
    console.error(err);
  }
});

// Auto-scroll checkbox
autoScrollCheck.addEventListener('change', () => {
  appState.autoScroll = autoScrollCheck.checked;
});

// Clear Logs
btnClearLogs.addEventListener('click', async () => {
  try {
    await fetch('/api/logs/clear', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }
});

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  setupSSE();
});
