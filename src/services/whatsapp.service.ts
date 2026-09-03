import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  getBinaryNodeChild,
  getBinaryNodeChildren,
  WASocket,
  proto
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';
import pino from 'pino';
import { EventEmitter } from 'events';
import { logger } from './logger.service.js';
import { ConnectionStatus } from '../types/index.js';
import { configService } from '../config/config.service.js';

const AUTH_DIR = path.resolve(process.cwd(), 'data', 'auth_whatsapp');

class WhatsAppService extends EventEmitter {
  private sock: WASocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private qrCodeDataUrl: string | null = null;
  private isConnecting: boolean = false;
  private pinoLogger = pino({ level: 'silent' });
  private resolvedJidCache = new Map<string, string>();

  constructor() {
    super();
  }

  public getStatus(): { status: ConnectionStatus; qrCode: string | null; user?: any } {
    return {
      status: this.status,
      qrCode: this.qrCodeDataUrl,
      user: this.sock?.user || null
    };
  }

  public async initialize(): Promise<void> {
    if (this.isConnecting || this.status === 'connected') {
      return;
    }

    this.isConnecting = true;
    this.status = 'connecting';
    this.emit('status_change', this.getStatus());
    logger.info('WHATSAPP', 'Iniciando cliente WhatsApp Baileys...');

    try {
      if (!fs.existsSync(AUTH_DIR)) {
        fs.mkdirSync(AUTH_DIR, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info('WHATSAPP', `Versão Baileys: v${version.join('.')}${isLatest ? ' (mais recente)' : ''}`);

      this.sock = makeWASocket({
        version,
        logger: this.pinoLogger,
        printQRInTerminal: false,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.pinoLogger)
        },
        browser: ['Oferday', 'Chrome', '1.0.0'],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
            this.status = 'connecting';
            logger.info('WHATSAPP', 'Novo QR Code gerado. Aguardando leitura pelo WhatsApp no painel...');
            this.emit('qr', this.qrCodeDataUrl);
            this.emit('status_change', this.getStatus());
          } catch (err: any) {
            logger.error('WHATSAPP', `Erro ao gerar imagem do QR Code: ${err.message}`);
          }
        }

        if (connection === 'close') {
          this.isConnecting = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          this.qrCodeDataUrl = null;
          logger.warn('WHATSAPP', `Conexão fechada. Motivo / Status: ${statusCode || 'Desconhecido'}. Tentará reconectar: ${shouldReconnect}`);

          if (shouldReconnect) {
            this.status = 'connecting';
            this.emit('status_change', this.getStatus());
            setTimeout(() => this.initialize(), 3000);
          } else {
            this.status = 'disconnected';
            this.emit('status_change', this.getStatus());
            logger.error('WHATSAPP', 'Sessão desconectada/encerrada. É necessário ler o QR Code novamente.');
            this.clearAuthState();
          }
        } else if (connection === 'open') {
          this.isConnecting = false;
          this.status = 'connected';
          this.qrCodeDataUrl = null;
          const userJid = this.sock?.user?.id || 'Conectado';
          logger.success('WHATSAPP', `Conexão do WhatsApp estabelecida com sucesso! (${userJid})`);
          
          // Keep the session invisible/offline so mobile notifications continue working 100%
          try {
            await this.sock?.sendPresenceUpdate('unavailable');
            logger.info('WHATSAPP', 'Presença definida como Invisível (Offline) para manter todas as notificações no celular.');
          } catch {
            // ignore
          }

          this.emit('status_change', this.getStatus());
        }
      });
    } catch (err: any) {
      this.isConnecting = false;
      this.status = 'error';
      logger.error('WHATSAPP', `Falha ao iniciar WhatsApp: ${err.message}`);
      this.emit('status_change', this.getStatus());
    }
  }

  public async disconnect(): Promise<void> {
    logger.info('WHATSAPP', 'Desconectando sessão do WhatsApp...');
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.end(undefined);
        this.sock = null;
      }
      this.clearAuthState();
      this.status = 'disconnected';
      this.qrCodeDataUrl = null;
      this.emit('status_change', this.getStatus());
      logger.info('WHATSAPP', 'Sessão do WhatsApp limpa com sucesso.');
    } catch (err: any) {
      logger.error('WHATSAPP', `Erro ao desconectar WhatsApp: ${err.message}`);
    }
  }

  private clearAuthState(): void {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      }
    } catch (err: any) {
      logger.error('WHATSAPP', `Erro ao limpar arquivos de autenticação: ${err.message}`);
    }
  }

  /**
   * Resolves links or raw input to valid WhatsApp JIDs:
   * - Channel link: https://whatsapp.com/channel/CODE -> xxxxx@newsletter
   * - Group link: https://chat.whatsapp.com/CODE -> xxxxx@g.us
   * - Plain phone number: +55 11 9999-9999 -> 551199999999@s.whatsapp.net
   * - Raw JID: 120363... -> keeps intact
   */
  public async resolveJid(input: string): Promise<{ jid: string; name?: string; type: 'channel' | 'group' | 'contact' | 'unknown' }> {
    if (!input || !input.trim()) {
      throw new Error('Destino do WhatsApp não foi informado.');
    }

    const raw = input.trim();

    if (this.resolvedJidCache.has(raw)) {
      return { jid: this.resolvedJidCache.get(raw)!, type: 'unknown' };
    }

    // 1. WhatsApp Channel Link (https://whatsapp.com/channel/CODE or CODE)
    const channelMatch = raw.match(/(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([a-zA-Z0-9_-]+)/i);
    if (channelMatch && channelMatch[1]) {
      const inviteCode = channelMatch[1];
      logger.info('WHATSAPP', `Resolvendo link de Canal do WhatsApp (código: ${inviteCode})...`);
      
      if (!this.sock || this.status !== 'connected') {
        throw new Error('WhatsApp precisa estar conectado para resolver link de canal.');
      }

      try {
        const metadata = await this.sock.newsletterMetadata('invite', inviteCode);
        if (metadata && metadata.id) {
          logger.success('WHATSAPP', `Canal "${metadata.name || 'Sem nome'}" resolvido com sucesso para o JID: ${metadata.id}`);
          this.resolvedJidCache.set(raw, metadata.id);
          return { jid: metadata.id, name: metadata.name, type: 'channel' };
        }
      } catch (err: any) {
        logger.error('WHATSAPP', `Não foi possível resolver o link do canal: ${err.message}`);
        throw new Error(`Erro ao resolver canal do WhatsApp (${inviteCode}): ${err.message}`);
      }
    }

    // 2. WhatsApp Group Link (https://chat.whatsapp.com/CODE)
    const groupMatch = raw.match(/(?:https?:\/\/)?chat\.whatsapp\.com\/([a-zA-Z0-9_-]+)/i);
    if (groupMatch && groupMatch[1]) {
      const inviteCode = groupMatch[1];
      logger.info('WHATSAPP', `Resolvendo link de Grupo do WhatsApp (código: ${inviteCode})...`);
      
      if (!this.sock || this.status !== 'connected') {
        throw new Error('WhatsApp precisa estar conectado para resolver link de grupo.');
      }

      try {
        const groupInfo = await this.sock.groupGetInviteInfo(inviteCode);
        if (groupInfo && groupInfo.id) {
          logger.success('WHATSAPP', `Grupo "${groupInfo.subject || 'Sem nome'}" resolvido com sucesso para o JID: ${groupInfo.id}`);
          this.resolvedJidCache.set(raw, groupInfo.id);
          return { jid: groupInfo.id, name: groupInfo.subject, type: 'group' };
        }
      } catch (err: any) {
        logger.error('WHATSAPP', `Não foi possível resolver o link do grupo: ${err.message}`);
        throw new Error(`Erro ao resolver grupo do WhatsApp (${inviteCode}): ${err.message}`);
      }
    }

    // 3. Already a formatted JID
    if (raw.endsWith('@newsletter')) {
      return { jid: raw, type: 'channel' };
    }
    if (raw.endsWith('@g.us')) {
      return { jid: raw, type: 'group' };
    }
    if (raw.endsWith('@s.whatsapp.net')) {
      return { jid: raw, type: 'contact' };
    }

    // 4. Raw Invite Code if alphanumeric of length ~ 20-30 without special chars
    if (/^[a-zA-Z0-9]{20,30}$/.test(raw) && this.sock && this.status === 'connected') {
      try {
        const metadata = await this.sock.newsletterMetadata('invite', raw);
        if (metadata && metadata.id) {
          logger.success('WHATSAPP', `Canal "${metadata.name}" resolvido pelo código para o JID: ${metadata.id}`);
          this.resolvedJidCache.set(raw, metadata.id);
          return { jid: metadata.id, name: metadata.name, type: 'channel' };
        }
      } catch {
        // Not a channel invite, continue
      }
    }

    // 5. Phone number format (clean non-digits)
    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly.length >= 8) {
      const contactJid = `${digitsOnly}@s.whatsapp.net`;
      return { jid: contactJid, type: 'contact' };
    }

    return { jid: raw, type: 'unknown' };
  }

  public async getAvailableChannels(): Promise<{ id: string; name: string; type: 'channel'; role?: string }[]> {
    if (!this.sock || this.status !== 'connected') {
      return [];
    }

    const channels: { id: string; name: string; type: 'channel'; role?: string }[] = [];

    // Fetch subscribed/administered Channels (Newsletters)
    try {
      const result = await (this.sock as any).query({
        tag: 'iq',
        attrs: {
          to: 's.whatsapp.net',
          type: 'get',
          xmlns: 'newsletter'
        },
        content: [{ tag: 'subscribed', attrs: {} }]
      });

      const subscribedNode = getBinaryNodeChild(result, 'subscribed') || result;
      const newsletterNodes = getBinaryNodeChildren(subscribedNode, 'newsletter') || [];

      for (const node of newsletterNodes) {
        const jid = node.attrs?.jid || node.attrs?.id;
        const role = node.attrs?.role || 'admin';
        if (jid) {
          let name = '';
          try {
            const metadata = await this.sock.newsletterMetadata('jid', jid);
            name = metadata?.name || '';
          } catch {
            name = `Canal (${jid.split('@')[0]})`;
          }
          channels.push({
            id: jid,
            name: name ? `📢 ${name}` : `📢 Canal ${jid.split('@')[0]}`,
            type: 'channel',
            role
          });
        }
      }
    } catch (err: any) {
      logger.warn('WHATSAPP', `Aviso ao buscar canais inscritos: ${err.message}`);
    }

    // Add destination channel from config if it's a channel
    const currentDest = configService.getConfig().whatsapp.destinationJid;
    if (currentDest && currentDest.endsWith('@newsletter') && !channels.some(c => c.id === currentDest)) {
      channels.unshift({
        id: currentDest,
        name: `📢 Canal Atual (${currentDest})`,
        type: 'channel',
        role: 'admin'
      });
    }

    // Add cached resolved channels
    for (const [key, jid] of this.resolvedJidCache.entries()) {
      if (jid.endsWith('@newsletter') && !channels.some(c => c.id === jid)) {
        channels.unshift({
          id: jid,
          name: `📢 Canal (${jid})`,
          type: 'channel',
          role: 'admin'
        });
      }
    }

    return channels;
  }

  public async getAvailableChats(): Promise<{ id: string; name: string; type: 'group' | 'channel'; role?: string }[]> {
    return this.getAvailableChannels();
  }

  public async sendMessage(
    targetDestination: string,
    text: string,
    imageBuffer?: Buffer | null
  ): Promise<proto.WebMessageInfo | undefined> {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp não está conectado no momento.');
    }

    // Auto-resolve destination links (e.g. https://whatsapp.com/channel/0029VbEGx7g23n3lYEIUGE3A -> xxxxx@newsletter)
    const { jid: formattedJid, name, type } = await this.resolveJid(targetDestination);

    const typeDesc = type === 'channel' ? `Canal (${name || formattedJid})` : type === 'group' ? `Grupo (${name || formattedJid})` : formattedJid;
    logger.info('WHATSAPP', `Enviando mensagem para ${typeDesc}...`);

    let result: proto.WebMessageInfo | undefined;

    try {
      if (imageBuffer && imageBuffer.length > 0) {
        result = await this.sock.sendMessage(formattedJid, {
          image: imageBuffer,
          caption: text || ''
        });
      } else {
        result = await this.sock.sendMessage(formattedJid, {
          text: text || ''
        });
      }

      logger.success('WHATSAPP', `Mensagem entregue com sucesso no destino (${typeDesc})!`);
      return result;
    } catch (sendErr: any) {
      if (formattedJid.endsWith('@newsletter')) {
        logger.error('WHATSAPP', `Falha ao postar no Canal do WhatsApp: certifique-se de que a conta conectada no QR Code é Administradora ou Proprietária deste Canal. Detalhe: ${sendErr.message}`);
      } else {
        logger.error('WHATSAPP', `Falha ao enviar mensagem para ${formattedJid}: ${sendErr.message}`);
      }
      throw sendErr;
    }
  }
}

export const whatsappService = new WhatsAppService();
