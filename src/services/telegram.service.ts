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
  private isConnecting: boolean = false;
  private messageHandler: ((event: NewMessageEvent) => Promise<void>) | null = null;

  constructor() {
    super();
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

  public async listenToChannel(channelUsernameOrLink: string): Promise<void> {
    if (!this.client || this.status !== 'connected') {
      logger.warn('TELEGRAM', 'Não é possível entrar no canal: Telegram não está conectado.');
      return;
    }

    let cleanChannel = channelUsernameOrLink.trim();
    if (cleanChannel.startsWith('https://t.me/')) {
      cleanChannel = cleanChannel.replace('https://t.me/', '');
    }
    if (cleanChannel.startsWith('@')) {
      cleanChannel = cleanChannel.substring(1);
    }

    if (!cleanChannel) {
      logger.warn('TELEGRAM', 'Nome de canal de origem inválido.');
      return;
    }

    try {
      logger.info('TELEGRAM', `Buscando canal de origem: @${cleanChannel}...`);
      const entity = await this.client.getEntity(cleanChannel);

      // Join channel if not joined
      try {
        await this.client.invoke(new Api.channels.JoinChannel({ channel: entity }));
        logger.info('TELEGRAM', `Canal @${cleanChannel} verificado e ingressado com sucesso.`);
      } catch (err: any) {
        // May fail if already joined or public, which is fine
        if (!err.message?.includes('USER_ALREADY_PARTICIPANT')) {
          logger.info('TELEGRAM', `Entrada no canal: ${err.message}`);
        }
      }

      this.listeningChannel = cleanChannel;
      this.setupEventListener(entity, cleanChannel);
      logger.success('TELEGRAM', `Escuta de novas mensagens ativada com sucesso no canal @${cleanChannel}!`);
      this.emit('status_change', this.getStatus());
    } catch (err: any) {
      logger.error('TELEGRAM', `Erro ao acessar o canal @${cleanChannel}: ${err.message}`);
    }
  }

  private setupEventListener(channelEntity: any, channelUsername: string): void {
    if (!this.client) return;

    // Remove previous handler if any
    if (this.messageHandler) {
      try {
        this.client.removeEventHandler(this.messageHandler, new NewMessage({}));
      } catch {
        // ignore
      }
    }

    const targetChannelId = channelEntity?.id?.toString();

    this.messageHandler = async (event: NewMessageEvent) => {
      try {
        const msg = event.message;
        if (!msg) return;

        // Verify if message comes from the target channel
        const chat = await msg.getChat().catch(() => null);
        const chatUsername = (chat as any)?.username?.toLowerCase();
        const chatId = (chat as any)?.id?.toString();

        const matchesChannel =
          (chatUsername && chatUsername === channelUsername.toLowerCase()) ||
          (chatId && targetChannelId && chatId === targetChannelId);

        if (!matchesChannel) {
          return;
        }

        const text = msg.message || '';
        const hasMedia = !!msg.media;

        logger.info('TELEGRAM', `Nova mensagem recebida do canal @${this.listeningChannel}! (Tamanho do texto: ${text.length} caracteres, Possui mídia: ${hasMedia ? 'Sim' : 'Não'})`);

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
          date: msg.date
        });
      } catch (err: any) {
        logger.error('TELEGRAM', `Erro ao processar mensagem recebida: ${err.message}`);
      }
    };

    this.client.addEventHandler(this.messageHandler, new NewMessage({}));
  }

  public async logout(): Promise<void> {
    logger.info('TELEGRAM', 'Encerrando sessão do Telegram...');
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
