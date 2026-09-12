document.addEventListener('DOMContentLoaded', async () => {
  const serverUrlInput = document.getElementById('serverUrl');
  const mlBadge = document.getElementById('mlBadge');
  const amzBadge = document.getElementById('amzBadge');
  const btnSync = document.getElementById('btnSync');
  const btnCopyML = document.getElementById('btnCopyML');
  const btnCopyAmz = document.getElementById('btnCopyAmz');
  const statusBox = document.getElementById('statusBox');

  const saved = await chrome.storage.local.get(['oferdayServerUrl']);
  serverUrlInput.value = saved.oferdayServerUrl || 'https://oferday-production.up.railway.app';

  serverUrlInput.addEventListener('change', () => {
    let url = serverUrlInput.value.trim().replace(/\/+$/, '');
    chrome.storage.local.set({ oferdayServerUrl: url });
  });

  async function getCookieString(domain) {
    return new Promise((resolve) => {
      chrome.cookies.getAll({ domain }, (cookies) => {
        if (!cookies || cookies.length === 0) {
          resolve('');
          return;
        }
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        resolve(cookieStr);
      });
    });
  }

  let mlCookie = '';
  let amzCookie = '';

  try {
    mlCookie = await getCookieString('.mercadolivre.com.br');
    if (!mlCookie) mlCookie = await getCookieString('mercadolivre.com.br');

    amzCookie = await getCookieString('.amazon.com.br');
    if (!amzCookie) amzCookie = await getCookieString('amazon.com.br');
  } catch (err) {
    console.error(err);
  }

  // Clean status without KB text
  if (mlCookie && mlCookie.length > 50) {
    mlBadge.innerHTML = '● Conectado';
    mlBadge.className = 'pill pill-active';
  } else {
    mlBadge.innerHTML = '○ Não Conectado';
    mlBadge.className = 'pill pill-inactive';
  }

  if (amzCookie && amzCookie.length > 50) {
    amzBadge.innerHTML = '● Conectado';
    amzBadge.className = 'pill pill-active';
  } else {
    amzBadge.innerHTML = '○ Não Conectado';
    amzBadge.className = 'pill pill-inactive';
  }

  function showStatus(msg, isSuccess) {
    statusBox.textContent = msg;
    statusBox.className = 'status-box ' + (isSuccess ? 'status-success' : 'status-error');
    statusBox.style.display = 'block';
  }

  btnCopyML.addEventListener('click', () => {
    if (!mlCookie) return alert('Nenhum cookie do Mercado Livre encontrado. Faça login no mercadolivre.com.br primeiro.');
    navigator.clipboard.writeText(mlCookie);
    showStatus('Cookie do Mercado Livre copiado!', true);
  });

  btnCopyAmz.addEventListener('click', () => {
    if (!amzCookie) return alert('Nenhum cookie da Amazon encontrado. Faça login no amazon.com.br primeiro.');
    navigator.clipboard.writeText(amzCookie);
    showStatus('Cookie da Amazon copiado!', true);
  });

  btnSync.addEventListener('click', async () => {
    const rawUrl = serverUrlInput.value.trim().replace(/\/+$/, '');
    if (!rawUrl) {
      showStatus('Por favor, informe a URL do seu bot Oferday!', false);
      return;
    }

    chrome.storage.local.set({ oferdayServerUrl: rawUrl });

    if (!mlCookie && !amzCookie) {
      showStatus('Nenhum cookie encontrado. Faça login no Mercado Livre ou Amazon.', false);
      return;
    }

    btnSync.disabled = true;
    btnSync.textContent = '⏳ Sincronizando...';

    try {
      const response = await fetch(`${rawUrl}/api/extension/sync-cookies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meliCookie: mlCookie || undefined,
          amazonCookie: amzCookie || undefined
        })
      });

      const data = await response.json();
      if (data.success) {
        showStatus('✅ Cookies sincronizados com sucesso no Bot Oferday!', true);
      } else {
        showStatus('❌ Falha ao sincronizar: ' + (data.error || 'Erro desconhecido'), false);
      }
    } catch (err) {
      showStatus('❌ Erro de conexão com o servidor: ' + err.message, false);
    } finally {
      btnSync.disabled = false;
      btnSync.textContent = '🔄 Sincronizar em 1 Clique';
    }
  });
});