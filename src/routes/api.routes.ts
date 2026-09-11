import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { telegramService } from '../services/telegram.service.js';
import { whatsappService } from '../services/whatsapp.service.js';
import { configService } from '../config/config.service.js';
import { logger } from '../services/logger.service.js';
import { imageService } from '../services/image.service.js';
import { forwarderService } from '../services/forwarder.service.js';
import { affiliateService } from '../services/affiliate.service.js';
import { meliAuthService } from '../services/meli-auth.service.js';
import { divulgadorService } from '../services/divulgador.service.js';
import { templateService } from '../services/template.service.js';

export const apiRouter = Router();

// SSE Clients list
const sseClients: Response[] = [];

function broadcastSSE(type: string, data: any) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res) => {
    try {
      res.write(payload);
    } catch {
      // client disconnected
    }
  });
}

// Wire events to SSE
logger.on('log', (entry) => broadcastSSE('log', entry));
logger.on('cleared', () => broadcastSSE('logs_cleared', {}));
whatsappService.on('qr', (qr) => broadcastSSE('whatsapp_qr', { qr }));
whatsappService.on('status_change', (status) => broadcastSSE('whatsapp_status', status));
telegramService.on('status_change', (status) => broadcastSSE('telegram_status', status));
forwarderService.on('new_forwarded_message', (item) => broadcastSSE('new_forwarded_message', item));
forwarderService.on('message_updated', (item) => broadcastSSE('message_updated', item));

// SSE Stream endpoint
apiRouter.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send initial snapshot
  res.write(`event: init\ndata: ${JSON.stringify({
    config: configService.getConfig(),
    telegram: telegramService.getStatus(),
    whatsapp: whatsappService.getStatus(),
    logs: logger.getRecentLogs(),
    feed: forwarderService.getRecentMessages()
  })}\n\n`);

  sseClients.push(res);

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) {
      sseClients.splice(idx, 1);
    }
  });
});

// Overall Status
apiRouter.get('/status', (req: Request, res: Response) => {
  res.json({
    config: configService.getConfig(),
    telegram: telegramService.getStatus(),
    whatsapp: whatsappService.getStatus()
  });
});

// Config
apiRouter.get('/config', (req: Request, res: Response) => {
  res.json(configService.getConfig());
});

apiRouter.post('/config', async (req: Request, res: Response) => {
  try {
    const prevConfig = configService.getConfig();
    const updated = configService.saveConfig(req.body);

    // If sourceChannel changed and Telegram is connected, update channel listener
    if (
      updated.telegram.sourceChannel &&
      updated.telegram.sourceChannel !== prevConfig.telegram.sourceChannel &&
      telegramService.getStatus().status === 'connected'
    ) {
      await telegramService.listenToChannel(updated.telegram.sourceChannel);
    }

    broadcastSSE('config_updated', updated);
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Telegram Auth & Actions
apiRouter.post('/telegram/auth/send-code', async (req: Request, res: Response) => {
  try {
    const { apiId, apiHash, phoneNumber } = req.body;
    if (!apiId || !apiHash || !phoneNumber) {
      return res.status(400).json({ success: false, error: 'apiId, apiHash e phoneNumber são obrigatórios.' });
    }

    await telegramService.sendLoginCode(Number(apiId), apiHash, phoneNumber);
    res.json({ success: true, message: 'Código enviado com sucesso!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/telegram/auth/verify-code', async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Código de verificação é obrigatório.' });
    }

    const connected = await telegramService.verifyLoginCode(code);
    res.json({ success: true, connected });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/telegram/auth/2fa', async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: 'Senha 2FA é obrigatória.' });
    }

    await telegramService.submit2FaPassword(password);
    res.json({ success: true, message: 'Autenticação 2FA concluída!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/telegram/connect', async (req: Request, res: Response) => {
  try {
    await telegramService.initialize();
    res.json({ success: true, status: telegramService.getStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/telegram/logout', async (req: Request, res: Response) => {
  try {
    await telegramService.logout();
    res.json({ success: true, message: 'Desconectado do Telegram.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// WhatsApp Actions
apiRouter.post('/whatsapp/connect', async (req: Request, res: Response) => {
  try {
    await whatsappService.initialize();
    res.json({ success: true, status: whatsappService.getStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/whatsapp/disconnect', async (req: Request, res: Response) => {
  try {
    await whatsappService.disconnect();
    res.json({ success: true, message: 'Desconectado do WhatsApp.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/whatsapp/test', async (req: Request, res: Response) => {
  try {
    const config = configService.getConfig();
    const destinationJid = req.body.jid || config.whatsapp.destinationJid;
    const testMessage = req.body.text || '🤖 Mensagem de teste enviada com sucesso pelo Telegram->WhatsApp Forwarder!';

    if (!destinationJid) {
      return res.status(400).json({ success: false, error: 'Nenhum JID de destino informado.' });
    }

    await whatsappService.sendMessage(destinationJid, testMessage);
    res.json({ success: true, message: `Mensagem de teste enviada para ${destinationJid}!` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/whatsapp/chats', async (req: Request, res: Response) => {
  try {
    const chats = await whatsappService.getAvailableChats();
    res.json({ success: true, chats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/whatsapp/resolve-jid', async (req: Request, res: Response) => {
  try {
    const { input } = req.body;
    if (!input) {
      return res.status(400).json({ success: false, error: 'Link ou JID não informado.' });
    }
    const resolved = await whatsappService.resolveJid(input);
    res.json({ success: true, ...resolved });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Logs
apiRouter.get('/logs', (req: Request, res: Response) => {
  res.json({ logs: logger.getRecentLogs() });
});

apiRouter.post('/logs/clear', (req: Request, res: Response) => {
  logger.clearLogs();
  res.json({ success: true });
});

// Feed & Simulation
apiRouter.get('/feed', (req: Request, res: Response) => {
  res.json({ feed: forwarderService.getRecentMessages() });
});

apiRouter.post('/simulate', async (req: Request, res: Response) => {
  try {
    const { text, imageUrl } = req.body;
    if (!text && !imageUrl) {
      return res.status(400).json({ success: false, error: 'Informe texto ou URL de imagem.' });
    }
    const item = await forwarderService.sendSimulatedMessage(text, imageUrl);
    res.json({ success: true, message: 'Oferta simulada enviada!', item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Affiliate Link Test Endpoint
apiRouter.post('/affiliate/test', async (req: Request, res: Response) => {
  try {
    const { text, url } = req.body;
    const input = text || url;
    if (!input) {
      return res.status(400).json({ success: false, error: 'Texto ou URL de teste é obrigatório.' });
    }
    const result = await affiliateService.processMessageText(input);
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mercado Livre OAuth Token Endpoints
apiRouter.get('/meli/tokens', (req: Request, res: Response) => {
  const status = meliAuthService.getTokenStatus();
  const tokens = meliAuthService.getTokens();
  res.json({
    success: true,
    status,
    hasAccessToken: !!tokens?.access_token,
    hasRefreshToken: !!tokens?.refresh_token
  });
});

apiRouter.post('/meli/tokens', (req: Request, res: Response) => {
  try {
    const { access_token, refresh_token, expires_in } = req.body;
    if (!access_token && !refresh_token) {
      return res.status(400).json({ success: false, error: 'access_token ou refresh_token é obrigatório.' });
    }

    const expires_at = expires_in ? (Date.now() + Number(expires_in) * 1000) : (Date.now() + 6 * 3600 * 1000);

    const saved = meliAuthService.saveTokens({
      access_token,
      refresh_token,
      expires_at
    });

    res.json({ success: true, message: 'Tokens do Mercado Livre salvos com sucesso!', status: meliAuthService.getTokenStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/meli/refresh', async (req: Request, res: Response) => {
  try {
    const { refresh_token, client_id, client_secret, access_token } = req.body || {};
    if (refresh_token || access_token) {
      meliAuthService.saveTokens({
        access_token: access_token || undefined,
        refresh_token: refresh_token || undefined
      });
    }
    if (client_id || client_secret) {
      const currentCfg = configService.getConfig();
      configService.saveConfig({
        affiliate: {
          ...currentCfg.affiliate,
          mlAppId: client_id || currentCfg.affiliate.mlAppId,
          mlSecretKey: client_secret || currentCfg.affiliate.mlSecretKey
        }
      });
    }
    const newToken = await meliAuthService.refreshAccessToken();
    res.json({ success: true, message: 'Token renovado com sucesso!', status: meliAuthService.getTokenStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.get('/meli/auth-code', async (req: Request, res: Response) => {
  try {
    const code = (req.query.code as string) || '';
    if (!code) {
      return res.status(400).send('<h1>Erro: Nenhum código de autorização recebido.</h1>');
    }
    const rUri = `https://${req.get('host')}/api/meli/auth-code`;
    const tokens = await meliAuthService.exchangeAuthorizationCode(code, rUri);
    res.send(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 30px; border-radius: 12px; background: #e6ffed; border: 2px solid #28a745; text-align: center;">
        <h1 style="color: #28a745;">✅ Mercado Livre Conectado com Sucesso!</h1>
        <p style="font-size: 16px; color: #333;">O bot Oferday agora está conectado à API Oficial do Mercado Livre via OAuth 2.0.</p>
        <p style="font-size: 14px; color: #555;">Os links <b>meli.la</b> agora serão gerados automaticamente para todas as ofertas, e o token será renovado 24h por dia sozinho!</p>
        <p style="color: #888; font-size: 12px; margin-top: 20px;">Você já pode fechar esta aba.</p>
      </div>
    `);
  } catch (err: any) {
    res.status(500).send(`
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 30px; border-radius: 12px; background: #ffeef0; border: 2px solid #dc3545; text-align: center;">
        <h1 style="color: #dc3545;">❌ Erro ao Conectar Mercado Livre</h1>
        <p style="font-size: 14px; color: #333;">${err.message}</p>
      </div>
    `);
  }
});

apiRouter.post('/meli/auth-code', async (req: Request, res: Response) => {
  try {
    const { code, redirectUri } = req.body;
    if (!code) {
      return res.status(400).json({ success: false, error: 'Código de autorização (code) é obrigatório.' });
    }
    const rUri = redirectUri || configService.getConfig().affiliate?.mlRedirectUri || 'https://localhost';
    const tokens = await meliAuthService.exchangeAuthorizationCode(code, rUri);
    res.json({ success: true, message: 'Código trocado por tokens com sucesso!', status: meliAuthService.getTokenStatus() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Filters & Blacklist Management ---
apiRouter.get('/filters', (req: Request, res: Response) => {
  const config = configService.getConfig();
  res.json({
    success: true,
    filters: config.filters || {
      blacklist: ['instagram.com', 'tiktok.com', 'grupo vip'],
      removeTerms: ['bot de moedas', 'economizandobot', 't.me/economizandobot', '(anuncio)', '@economizandocomjp'],
      removeWatermarks: true,
      dedupHours: 4
    }
  });
});

apiRouter.post('/filters', (req: Request, res: Response) => {
  try {
    const { blacklist, removeTerms, removeWatermarks, dedupHours } = req.body;
    const current = configService.getConfig();
    const updated = configService.saveConfig({
      filters: {
        ...current.filters,
        blacklist: Array.isArray(blacklist) ? blacklist : current.filters?.blacklist || [],
        removeTerms: Array.isArray(removeTerms) ? removeTerms : current.filters?.removeTerms || [],
        removeWatermarks: typeof removeWatermarks === 'boolean' ? removeWatermarks : current.filters?.removeWatermarks ?? true,
        dedupHours: typeof dedupHours === 'number' ? dedupHours : current.filters?.dedupHours ?? 4
      }
    });
    res.json({ success: true, message: 'Filtros salvos com sucesso!', filters: updated.filters });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Banner Upload & Management ---
apiRouter.get('/banners/status', (req: Request, res: Response) => {
  try {
    const status = imageService.getBannerStatus();
    res.json({ success: true, ...status });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/banners/upload', async (req: Request, res: Response) => {
  try {
    const { store, imageBase64 } = req.body;
    if (!store || !imageBase64) {
      return res.status(400).json({ success: false, error: 'Loja (store: MELI ou MAGALU) e imagem em base64 são obrigatórios.' });
    }

    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');

    if (buffer.length < 500) {
      return res.status(400).json({ success: false, error: 'Arquivo de imagem inválido ou muito pequeno.' });
    }

    const filename = store.toUpperCase() === 'MAGALU' ? 'alerta_cupons_magalu_limpo.jpg' : 'alerta_cupons_ml_limpo.jpg';
    const dataDir = path.resolve(process.cwd(), 'data', 'banners');
    const assetsDir = path.resolve(process.cwd(), 'assets', 'banners');

    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    fs.writeFileSync(path.join(dataDir, filename), buffer);
    fs.writeFileSync(path.join(assetsDir, filename), buffer);

    await imageService.reload();
    logger.success('IMAGE', `Novo banner carregado para [${store.toUpperCase()}] com sucesso! (${buffer.length} bytes)`);

    res.json({
      success: true,
      message: `Banner de ${store.toUpperCase()} atualizado com sucesso!`,
      status: imageService.getBannerStatus()
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Divulgador & Ofertas (5 Lojas Suportadas)
apiRouter.get('/divulgador/offers', (req: Request, res: Response) => {
  try {
    const { store, category, search, page, limit } = req.query;
    const result = divulgadorService.getOffers({
      store: store ? String(store) : undefined,
      category: category ? String(category) : undefined,
      search: search ? String(search) : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 12
    });
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/divulgador/harvest', async (req: Request, res: Response) => {
  try {
    const count = await divulgadorService.harvestAll();
    res.json({ success: true, message: `Garimpagem concluída com sucesso!`, count });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/divulgador/dispatch', async (req: Request, res: Response) => {
  try {
    const { offerId, offerData } = req.body;
    if (!offerId && !offerData) {
      return res.status(400).json({ success: false, error: 'offerId ou offerData é obrigatório.' });
    }
    const result = await divulgadorService.dispatchOffer(offerId || offerData);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/divulgador/add', (req: Request, res: Response) => {
  try {
    const newOffer = divulgadorService.addOffer(req.body);
    res.json({ success: true, message: 'Oferta adicionada ao Divulgador!', offer: newOffer });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Proxy de Imagens (evita bloqueio de hotlink por CDNs)
apiRouter.get('/proxy-image', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string;
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return res.status(400).send('URL de imagem inválida');
  }

  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Referer': 'https://www.google.com/'
      },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      return res.redirect(imageUrl);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.redirect(imageUrl);
  }
});

// ==========================================
// TEMPLATE DE MENSAGENS PERSONALIZADAS
// ==========================================
apiRouter.get('/template', (req: Request, res: Response) => {
  try {
    const config = configService.getConfig();
    res.json({
      success: true,
      config: config.template || {
        mode: 'default',
        customTemplate: templateService.presets[0].template,
        customWarning: 'Preço sujeito a alteração a qualquer momento.'
      },
      presets: templateService.presets
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/template', (req: Request, res: Response) => {
  try {
    const { mode, customTemplate, customWarning } = req.body;
    const config = configService.getConfig();

    const updated = configService.saveConfig({
      ...config,
      template: {
        mode: mode || 'default',
        customTemplate: customTemplate || templateService.presets[0].template,
        customWarning: customWarning !== undefined ? customWarning : (config.template?.customWarning || 'Preço sujeito a alteração a qualquer momento.')
      }
    });

    logger.success('SYSTEM', 'Template de mensagens atualizado com sucesso!');
    res.json({ success: true, message: 'Template salvo com sucesso!', template: updated.template });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

apiRouter.post('/template/preview', (req: Request, res: Response) => {
  try {
    const { template, sampleData } = req.body;
    const rendered = templateService.render(template, sampleData || {
      title: 'Smart TV 50" 4K UHD LED Wi-Fi HDR Bluetooth Inteligente',
      store: 'MERCADO_LIVRE',
      originalPrice: 2499.00,
      promoPrice: 1749.30,
      discountPercent: 30,
      coupon: 'PROMOTV10',
      affiliateUrl: 'https://meli.la/exemplo-afiliado',
      category: 'Tech'
    });
    res.json({ success: true, rendered });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
