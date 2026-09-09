import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import { logger } from './logger.service.js';
import { configService } from '../config/config.service.js';
import { ConnectionStatus } from '../types/index.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SESSION_FILE = path.join(DATA_DIR, 'telegram.session');
const PROCESSED_FILE = path.join(DATA_DIR, 'telegram_processed.json');

export interface TelegramAuthPending {
  phoneNumber: string;
  phoneCodeHash: string;
  apiId: number;
  apiHash: string;
}

class TelegramService extends EventEmitter {
  private client: TelegramClient | null = null;
  private status: ConnectionStatus = 'disconnected';
  private pendingAuth: TelegramAuthPending | null = null;
  private listeningChannel: string | null = null;
  private listeningChannels: Map<string, { id?: string; username?: string; title?: string }> = new Map();
  private isConnecting: boolean = false;
  private messageHandler: ((event: NewMessageEvent) => Promise<void>) | null = null;
  private processedMessageKeys: Set<string> = new Set<string>();

  constructor() {
    super();
    this.loadProcessedKeys();
  }

  private loadProcessedKeys(): void {
    try {
      if (fs.existsSync(PROCESSED_FILE)) {
        const raw = fs.readFileSync(PROCESSED_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.processedMessageKeys = new Set(parsed);
          logger.info('TELEGRAM', `Carregados ${this.processedMessageKeys.size} IDs de mensagens processadas do disco.`);
        }
      }
    } catch (err: any) {
      logger.warn('TELEGRAM', `Aviso ao carregar mensagens processadas: ${err.message}`);
    }
  }

  private saveProcessedKeys(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const arr = Array.from(this.processedMessageKeys).slice(-2000);
      fs.writeFileSync(PROCESSED_FILE, JSON.stringify(arr), 'utf-8');
    } catch (err: any) {
      logger.warn('TELEGRAM', `Erro ao salvar histórico de mensagens processadas: ${err.message}`);
    }
  }

  public getStatus(): { status: ConnectionStatus; channel: string | null; me?: any } {
    return {
      status: this.status,
      channel: this.listeningChannel
    };
  }

  private loadSessionString(): string {
    try {
      if (fs.existsSync(SESSION_FILE)) {
        const fileContent = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
        if (fileContent) return fileContent;
      }
    } catch (err: any) {
      logger.error('TELEGRAM', `Erro ao ler arquivo de sessão: ${err.message}`);
    }
    return (process.env.TELEGRAM_SESSION || process.env.TG_SESSION || '').trim();
  }

  private saveSessionString(sessionStr: string): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(SESSION_FILE, sessionStr, 'utf-8');
      logger.info('TELEGRAM', 'Sessão do Telegram salva localmente em data/telegram.session');
    } catch (err: any) {
      logger.error('TELEGRAM', `Erro ao salvar arquivo de sessão: ${err.message}`);
    }
  }

  public async initialize(): Promise<void> {
    if (this.isConnecting || this.status === 'connected') {
      return;
    }

    const config = configService.getConfig();
    const apiId = config.telegram.apiId;
    const apiHash = config.telegram.apiHash;

    if (!apiId || !apiHash) {
      logger.warn('TELEGRAM', 'Telegram API ID e API Hash não configurados. Configure no painel ou config.json.');
      this.status = 'disconnected';
      this.emit('status_change', this.getStatus());
      return;
    }

    const savedSession = this.loadSessionString();
    if (!savedSession) {
      logger.info('TELEGRAM', 'Nenhuma sessão salva encontrada. Faça login pelo formulário no painel.');
      this.status = 'disconnected';
      this.emit('status_change', this.getStatus());
      return;
    }

    this.isConnecting = true;
    this.status = 'connecting';
    this.emit('status_change', this.getStatus());
    logger.info('TELEGRAM', 'Conectando ao Telegram usando sessão salva...');

    try {
      const stringSession = new StringSession(savedSession);
      this.client = new TelegramClient(stringSession, Number(apiId), apiHash, {
        connectionRetries: Infinity,
        autoReconnect: true
      });

      await this.client.connect();

      const isAuthorized = await this.client.checkAuthorization();
      if (!isAuthorized) {
        logger.warn('TELEGRAM', 'Sessão salva expirou ou é inválida. Faça login novamente.');
        this.status = 'disconnected';
        this.isConnecting = false;
        this.emit('status_change', this.getStatus());
        return;
      }

      const me = await this.client.getMe() as any;
      const username = me.username ? `@${me.username}` : (me.firstName || me.phone || 'Usuário');
      this.status = 'connected';
      this.isConnecting = false;
      logger.success('TELEGRAM', `Conexão do Telegram estabelecida com sucesso! (${username})`);
      this.emit('status_change', this.getStatus());

      // Start listening to channel if configured
      if (config.telegram.sourceChannel) {
        await this.listenToChannel(config.telegram.sourceChannel);
      }
    } catch (err: any) {
      this.isConnecting = false;
      this.status = 'error';
      logger.error('TELEGRAM', `Erro ao conectar com Telegram: ${err.message}`);
      this.emit('status_change', this.getStatus());
    }
  }

  public async sendLoginCode(apiId: number, apiHash: string, phoneNumber: string): Promise<void> {
    try {
      logger.info('TELEGRAM', `Enviando código de verificação para o número ${phoneNumber}...`);
      const stringSession = new StringSession('');
      this.client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5
      });

      await this.client.connect();

      const { phoneCodeHash } = await this.client.sendCode(
        { apiId, apiHash },
        phoneNumber
      );

      this.pendingAuth = {
        phoneNumber,
        phoneCodeHash,
        apiId,
        apiHash
      };

      this.status = 'waiting_code';
      this.emit('status_change', this.getStatus());
      logger.info('TELEGRAM', `Código enviado via Telegram/SMS para ${phoneNumber}. Insira o código no painel.`);
    } catch (err: any) {
      this.status = 'error';
      this.emit('status_change', this.getStatus());
      logger.error('TELEGRAM', `Erro ao enviar código de login: ${err.message}`);
      throw err;
    }
  }

  public async verifyLoginCode(code: string): Promise<boolean> {
    if (!this.pendingAuth || !this.client) {
      throw new Error('Nenhuma autenticação pendente. Solicite o código primeiro.');
    }

    try {
      logger.info('TELEGRAM', 'Validando código de verificação...');
      await this.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: this.pendingAuth.phoneNumber,
          phoneCodeHash: this.pendingAuth.phoneCodeHash,
          phoneCode: code
        })
      );

      const sessionString = (this.client.session as any).save();
      this.saveSessionString(sessionString);

      // Save api credentials to config
      configService.saveConfig({
        telegram: {
          ...configService.getConfig().telegram,
          apiId: this.pendingAuth.apiId,
          apiHash: this.pendingAuth.apiHash,
          phoneNumber: this.pendingAuth.phoneNumber
        }
      });

      this.status = 'connected';
      this.pendingAuth = null;
      logger.success('TELEGRAM', 'Login no Telegram realizado e sessão salva com sucesso!');
      this.emit('status_change', this.getStatus());

      const config = configService.getConfig();
      if (config.telegram.sourceChannel) {
        await this.listenToChannel(config.telegram.sourceChannel);
      }

      return true;
    } catch (err: any) {
      if (err.message && err.message.includes('SESSION_PASSWORD_NEEDED')) {
        this.status = 'waiting_2fa';
        this.emit('status_change', this.getStatus());
        logger.warn('TELEGRAM', 'Verificação em 2 etapas (2FA) detectada. Digite sua senha de nuvem no painel.');
        return false;
      }
      logger.error('TELEGRAM', `Erro ao validar código do Telegram: ${err.message}`);
      throw err;
    }
  }

  public async submit2FaPassword(password: string): Promise<void> {
    if (!this.client) {
      throw new Error('Cliente Telegram não inicializado.');
    }

    try {
      logger.info('TELEGRAM', 'Enviando senha de 2 etapas (2FA)...');
      await this.client.signInWithPassword(
        {
          apiId: this.pendingAuth?.apiId || configService.getConfig().telegram.apiId!,
          apiHash: this.pendingAuth?.apiHash || configService.getConfig().telegram.apiHash
        },
        {
          password: async () => password,
          onError: (err: Error) => {
            logger.error('TELEGRAM', `Erro no 2FA: ${err.message}`);
          }
        }
      );

      const sessionString = (this.client.session as any).save();
      this.saveSessionString(sessionString);

      if (this.pendingAuth) {
        configService.saveConfig({
          telegram: {
            ...configService.getConfig().telegram,
            apiId: this.pendingAuth.apiId,
            apiHash: this.pendingAuth.apiHash,
            phoneNumber: this.pendingAuth.phoneNumber
          }
        });
      }

      this.status = 'connected';
      this.pendingAuth = null;
      logger.success('TELEGRAM', 'Autenticação 2FA concluída e sessão salva com sucesso!');
      this.emit('status_change', this.getStatus());

      const config = configService.getConfig();
      if (config.telegram.sourceChannel) {
        await this.listenToChannel(config.telegram.sourceChannel);
      }
    } catch (err: any) {
      logger.error('TELEGRAM', `Erro na autenticação 2FA: ${err.message}`);
      throw err;
    }
  }

  public async listenToChannel(channelListOrInput: string): Promise<void> {
    if (!this.client || this.status !== 'connected') {
      logger.warn('TELEGRAM', 'Não é possível entrar no canal: Telegram não está conectado.');
      return;
    }

    // Split by comma, newline, semicolon, or whitespace/spaces
    const rawList = channelListOrInput
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (rawList.length === 0) {
      logger.warn('TELEGRAM', 'Nenhum canal de origem informado.');
      return;
    }

    this.listeningChannels.clear();

    for (const raw of rawList) {
      let cleanChannel = raw.trim();

      // 1. Check for private invite links: https://t.me/+HASH or https://t.me/joinchat/HASH
      const inviteHashMatch = cleanChannel.match(/(?:https?:\/\/)?(?:t\.me\/(?:\+|joinchat\/))([a-zA-Z0-9_-]+)/i);
      if (inviteHashMatch && inviteHashMatch[1]) {
        const hash = inviteHashMatch[1];
        try {
          logger.info('TELEGRAM', `Ingressando via link de convite privado: +${hash}...`);
          const result: any = await this.client.invoke(new Api.messages.ImportChatInvite({ hash }));
          const chats = result.chats || [];
          const entity = chats[0];
          if (entity) {
            const id = entity.id?.toString();
            const username = entity.username?.toLowerCase() || '';
            const title = entity.title || hash;
            this.listeningChannels.set(id || hash, { id, username, title });
            logger.success('TELEGRAM', `Escuta de novas mensagens ativada no canal privado "${title}"!`);
            continue;
          }
        } catch (err: any) {
          if (err.message?.includes('USER_ALREADY_PARTICIPANT')) {
            logger.info('TELEGRAM', `Usuário já participa do canal de convite +${hash}.`);
          } else {
            logger.warn('TELEGRAM', `Aviso ao entrar no canal de convite +${hash}: ${err.message}`);
          }
        }
      }

      // 2. Clean public channel link or username
      if (cleanChannel.startsWith('https://t.me/')) {
        cleanChannel = cleanChannel.replace('https://t.me/', '');
      } else if (cleanChannel.startsWith('http://t.me/')) {
        cleanChannel = cleanChannel.replace('http://t.me/', '');
      } else if (cleanChannel.startsWith('t.me/')) {
        cleanChannel = cleanChannel.replace('t.me/', '');
      }

      if (cleanChannel.startsWith('@')) {
        cleanChannel = cleanChannel.substring(1);
      }

      // Remove any trailing slashes or queries
      cleanChannel = cleanChannel.split('/')[0].split('?')[0].trim();

      if (!cleanChannel) {
        continue;
      }

      try {
        logger.info('TELEGRAM', `Buscando canal de origem: @${cleanChannel}...`);
        const entity: any = await this.client.getEntity(cleanChannel);

        // Join channel if not joined
        try {
          await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }));
          logger.info('TELEGRAM', `Canal @${cleanChannel} verificado e ingressado.`);
        } catch (err: any) {
          if (!err.message?.includes('USER_ALREADY_PARTICIPANT')) {
            logger.info('TELEGRAM', `Entrada no canal: ${err.message}`);
          }
        }

        const id = entity?.id?.toString();
        const username = entity?.username?.toLowerCase() || cleanChannel.toLowerCase();
        const title = entity?.title || cleanChannel;
        this.listeningChannels.set(id || cleanChannel, { id, username, title });
        logger.success('TELEGRAM', `Escuta ativada no canal @${cleanChannel} ("${title}")!`);
      } catch (err: any) {
        logger.error('TELEGRAM', `Erro ao acessar o canal @${cleanChannel}: ${err.message}`);
      }
    }

    const channelNames = Array.from(this.listeningChannels.values()).map((c) => `@${c.username || c.title}`);
    this.listeningChannel = channelNames.join(', ') || channelListOrInput;

    // Check for missed messages or seed history
    if (this.processedMessageKeys.size === 0) {
      // First boot on clean database: seed current messages so we don't spam old history
      for (const [key, ch] of this.listeningChannels.entries()) {
        try {
          const entity = ch.username || ch.id || key;
          const initialMsgs = await this.client.getMessages(entity, { limit: 10 });
          for (const msg of initialMsgs) {
            const normChatId = this.normalize(msg.chatId || (msg.peerId as any)?.channelId || ch.id || key);
            this.processedMessageKeys.add(`${normChatId}_${msg.id}`);
          }
        } catch {
          // ignore
        }
      }
      this.saveProcessedKeys();
    } else {
      // Container restart or reconnection: catch up on any messages posted while offline (last 30 minutes)
      logger.info('TELEGRAM', `Catch-Up Ativo: Verificando se houve mensagens enviadas durante a reinicialização...`);
      for (const [key, ch] of this.listeningChannels.entries()) {
        try {
          const entity = ch.username || ch.id || key;
          const recentMsgs = await this.client.getMessages(entity, { limit: 10 });
          // Process in chronological order (oldest to newest)
          const chronological = [...recentMsgs].reverse();
          const nowSec = Math.floor(Date.now() / 1000);

          for (const msg of chronological) {
            const normChatId = this.normalize(msg.chatId || (msg.peerId as any)?.channelId || ch.id || key);
            const msgKey = `${normChatId}_${msg.id}`;
            if (!this.processedMessageKeys.has(msgKey)) {
              const msgAgeSec = nowSec - (msg.date || 0);
              if (msgAgeSec < 30 * 60) {
                logger.info('TELEGRAM', `[Catch-Up] Recuperando mensagem #${msg.id} de "${ch.title || key}" postada durante reinício (${Math.round(msgAgeSec / 60)} min atrás)!`);
                await this.dispatchMessage(msg, ch.title || ch.username || key);
              } else {
                this.processedMessageKeys.add(msgKey);
              }
            }
          }
          this.saveProcessedKeys();
        } catch (err: any) {
          logger.warn('TELEGRAM', `Aviso no Catch-Up do canal ${ch.title || key}: ${err.message}`);
        }
      }
    }

    this.setupEventListener();
    logger.success('TELEGRAM', `Monitorando ${this.listeningChannels.size} canal(is) de origem em tempo real (Push + Poller Ativo): ${this.listeningChannel}`);
    this.emit('status_change', this.getStatus());
  }

  private keepAliveInterval: NodeJS.Timeout | null = null;
  private pollerInterval: NodeJS.Timeout | null = null;

  private normalize(val?: string | number | null): string {
    if (!val) return '';
    return val.toString().replace(/^-100/, '').replace(/^-/, '').toLowerCase().trim();
  }

  private setupKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    this.keepAliveInterval = setInterval(async () => {
      if (this.client && this.status === 'connected') {
        try {
          await this.client.invoke(new Api.updates.GetState());
        } catch (err: any) {
          logger.warn('TELEGRAM', `Watchdog: Tentando reconectar socket do Telegram... (${err.message})`);
          try {
            await this.client.connect();
          } catch {}
        }
      }
    }, 30000);
  }

  private setupPoller(): void {
    if (this.pollerInterval) {
      clearInterval(this.pollerInterval);
    }

    // Active sync poller running every 8 seconds across all channels
    this.pollerInterval = setInterval(async () => {
      if (!this.client || this.status !== 'connected' || this.listeningChannels.size === 0) {
        return;
      }

      for (const [key, ch] of this.listeningChannels.entries()) {
        try {
          const target = ch.username || ch.id || key;
          const msgs = await this.client.getMessages(target, { limit: 2 });
          for (const msg of msgs) {
            const normChatId = this.normalize(msg.chatId || (msg.peerId as any)?.channelId || ch.id || key);
            const msgKey = `${normChatId}_${msg.id}`;
            if (!this.processedMessageKeys.has(msgKey)) {
              await this.dispatchMessage(msg, ch.title || ch.username || key);
            }
          }
        } catch {
          // ignore rate limits or channel read hiccups
        }
      }
    }, 8000);
  }

  private async dispatchMessage(msg: any, channelTitle: string): Promise<void> {
    try {
      if (!msg) return;

      const normChatId = this.normalize(msg.chatId || (msg.peerId as any)?.channelId || '');
      const msgKey = `${normChatId}_${msg.id}`;

      if (this.processedMessageKeys.has(msgKey)) {
        return;
      }
      this.processedMessageKeys.add(msgKey);
      this.saveProcessedKeys();

      // Keep set bounded
      if (this.processedMessageKeys.size > 3000) {
        const first = this.processedMessageKeys.values().next().value;
        if (first) this.processedMessageKeys.delete(first);
      }

      const text = msg.message || '';
      const hasMedia = !!msg.media;

      logger.info('TELEGRAM', `Nova mensagem recebida do canal "${channelTitle || this.listeningChannel}"! (ID #${msg.id}, Tamanho: ${text.length} caracteres, Mídia: ${hasMedia ? 'Sim' : 'Não'})`);

      let mediaBuffer: Buffer | null = null;
      if (hasMedia) {
        try {
          logger.info('TELEGRAM', 'Baixando mídia da mensagem do Telegram...');
          const downloaded = await this.client?.downloadMedia(msg, {});
          if (downloaded && Buffer.isBuffer(downloaded)) {
            mediaBuffer = downloaded;
            logger.info('TELEGRAM', `Mídia baixada com sucesso (${(mediaBuffer.length / 1024).toFixed(1)} KB).`);
          } else if (downloaded && typeof downloaded === 'string') {
            mediaBuffer = fs.readFileSync(downloaded);
          }
        } catch (mediaErr: any) {
          logger.warn('TELEGRAM', `Não foi possível baixar mídia: ${mediaErr.message}`);
        }
      }

      this.emit('new_message', {
        id: msg.id,
        text,
        mediaBuffer,
        date: msg.date,
        channel: channelTitle || this.listeningChannel
      });
    } catch (err: any) {
      logger.error('TELEGRAM', `Erro ao despachar mensagem #${msg?.id}: ${err.message}`);
    }
  }

  private setupEventListener(): void {
    if (!this.client) return;

    this.setupKeepAlive();
    this.setupPoller();

    // Remove previous handler if any
    if (this.messageHandler) {
      try {
        this.client.removeEventHandler(this.messageHandler, new NewMessage({}));
      } catch {
        // ignore
      }
    }

    this.messageHandler = async (event: NewMessageEvent) => {
      try {
        const msg = event.message;
        if (!msg) return;

        // Collect all possible identifier clues for the source chat
        const rawChatId = msg.chatId?.toString() || '';
        const peerChannelId = (msg.peerId as any)?.channelId?.toString() || '';
        const peerChatId = (msg.peerId as any)?.chatId?.toString() || '';

        const normRawChatId = this.normalize(rawChatId);
        const normPeerChannelId = this.normalize(peerChannelId);
        const normPeerChatId = this.normalize(peerChatId);

        let chatUsername = '';
        let chatTitle = '';

        try {
          const chat: any = await msg.getChat().catch(() => null);
          if (chat) {
            chatUsername = this.normalize(chat.username);
            chatTitle = chat.title || '';
          }
        } catch {
          // ignore
        }

        let matches = false;
        let matchedTitle = '';

        for (const [key, ch] of this.listeningChannels.entries()) {
          const normKey = this.normalize(key);
          const normChId = this.normalize(ch.id);
          const normChUser = this.normalize(ch.username);

          const idMatches = (
            (normChId && (normChId === normRawChatId || normChId === normPeerChannelId || normChId === normPeerChatId)) ||
            (normKey && (normKey === normRawChatId || normKey === normPeerChannelId || normKey === normPeerChatId))
          );

          const userMatches = (
            (normChUser && chatUsername && normChUser === chatUsername) ||
            (normKey && chatUsername && normKey === chatUsername)
          );

          if (idMatches || userMatches) {
            matches = true;
            matchedTitle = ch.title || ch.username || key;
            break;
          }
        }

        // If no specific channels matched but listening channels list is configured, skip
        if (!matches && this.listeningChannels.size > 0) {
          return;
        }

        await this.dispatchMessage(msg, matchedTitle || chatTitle || this.listeningChannel || '');
      } catch (err: any) {
        logger.error('TELEGRAM', `Erro ao processar mensagem recebida: ${err.message}`);
      }
    };

    this.client.addEventHandler(this.messageHandler, new NewMessage({}));
  }

  public async logout(): Promise<void> {
    logger.info('TELEGRAM', 'Encerrando sessão do Telegram...');
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.pollerInterval) {
      clearInterval(this.pollerInterval);
      this.pollerInterval = null;
    }
    try {
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }
      if (fs.existsSync(SESSION_FILE)) {
        fs.unlinkSync(SESSION_FILE);
      }
      this.status = 'disconnected';
      this.listeningChannel = null;
      this.emit('status_change', this.getStatus());
      logger.info('TELEGRAM', 'Sessão do Telegram removida com sucesso.');
    } catch (err: any) {
      logger.error('TELEGRAM', `Erro ao deslogar Telegram: ${err.message}`);
    }
  }
}

export const telegramService = new TelegramService();
