import fs from 'fs';
import path from 'path';
import { logger } from './logger.service.js';
import { configService } from '../config/config.service.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'ml_tokens.json');

export interface MeliTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in ms
  token_type?: string;
  scope?: string;
  user_id?: number;
}

class MeliAuthService {
  private tokens: MeliTokens | null = null;
  private isRefreshing = false;

  constructor() {
    this.loadTokens();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  public loadTokens(): MeliTokens | null {
    try {
      this.ensureDataDir();
      if (fs.existsSync(TOKEN_FILE)) {
        const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
        this.tokens = JSON.parse(raw);
        return this.tokens;
      }
    } catch (err: any) {
      logger.error('AFFILIATE', `Erro ao carregar ml_tokens.json: ${err.message}`);
    }

    // Fallback to environment variables if present and no file exists
    const envAccessToken = process.env.ML_ACCESS_TOKEN || process.env.MELI_ACCESS_TOKEN;
    const envRefreshToken = process.env.ML_REFRESH_TOKEN || process.env.MELI_REFRESH_TOKEN;
    if (envAccessToken) {
      this.tokens = {
        access_token: envAccessToken,
        refresh_token: envRefreshToken || '',
        expires_at: Date.now() + 6 * 3600 * 1000 // default 6h if unknown
      };
      this.saveTokens(this.tokens);
    }

    return this.tokens;
  }

  public saveTokens(tokens: Partial<MeliTokens>): MeliTokens {
    this.ensureDataDir();
    this.tokens = {
      access_token: tokens.access_token || this.tokens?.access_token || '',
      refresh_token: tokens.refresh_token || this.tokens?.refresh_token || '',
      expires_at: tokens.expires_at || this.tokens?.expires_at || (Date.now() + 6 * 3600 * 1000),
      token_type: tokens.token_type || this.tokens?.token_type || 'Bearer',
      scope: tokens.scope || this.tokens?.scope,
      user_id: tokens.user_id || this.tokens?.user_id
    };

    try {
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(this.tokens, null, 2), 'utf-8');
      logger.success('AFFILIATE', 'Tokens do Mercado Livre salvos em data/ml_tokens.json com sucesso.');
    } catch (err: any) {
      logger.error('AFFILIATE', `Erro ao salvar ml_tokens.json: ${err.message}`);
    }

    return this.tokens;
  }

  public getTokens(): MeliTokens | null {
    if (!this.tokens) {
      this.loadTokens();
    }
    return this.tokens;
  }

  public getTokenStatus(): {
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    isExpired: boolean;
    expiresInMinutes: number;
    expiresAtDate?: string;
  } {
    const tokens = this.getTokens();
    if (!tokens || !tokens.access_token) {
      return {
        hasAccessToken: false,
        hasRefreshToken: false,
        isExpired: true,
        expiresInMinutes: 0
      };
    }

    const now = Date.now();
    const isExpired = tokens.expires_at <= now;
    const diffMs = tokens.expires_at - now;
    const expiresInMinutes = Math.max(0, Math.floor(diffMs / (60 * 1000)));

    return {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      isExpired,
      expiresInMinutes,
      expiresAtDate: new Date(tokens.expires_at).toLocaleString('pt-BR')
    };
  }

  /**
   * Refreshes the OAuth access token using refresh_token.
   */
  public async refreshAccessToken(): Promise<string> {
    if (this.isRefreshing) {
      // wait a bit if already refreshing
      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (this.tokens?.access_token) return this.tokens.access_token;
    }

    this.isRefreshing = true;

    try {
      const config = configService.getConfig();
      const clientId = (config.affiliate?.mlAppId || process.env.ML_APP_ID || process.env.MELI_APP_ID || '').trim();
      const clientSecret = (config.affiliate?.mlSecretKey || process.env.ML_SECRET_KEY || process.env.MELI_SECRET_KEY || '').trim();
      const currentRefreshToken = (this.tokens?.refresh_token || process.env.ML_REFRESH_TOKEN || '').trim();

      if (!clientId || !clientSecret) {
        throw new Error('ML_APP_ID ou ML_SECRET_KEY não configurados para renovação de token OAuth.');
      }

      if (!currentRefreshToken) {
        throw new Error('Nenhum refresh_token disponível para renovação. Forneça o token no painel.');
      }

      logger.info('AFFILIATE', `Mercado Livre: Renovando access_token via OAuth (Client ID: ${clientId})...`);

      const params = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: currentRefreshToken
      });

      const response = await fetch('https://api.mercadolibre.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: params.toString()
      });

      const data: any = await response.json();

      if (!response.ok) {
        logger.error('AFFILIATE', `Mercado Livre: Erro na renovação OAuth (${response.status}): ${JSON.stringify(data)}`);
        throw new Error(data.message || data.error_description || 'Falha ao renovar token OAuth do Mercado Livre');
      }

      const expiresInSeconds = data.expires_in || 21600; // 6h default
      const expiresAt = Date.now() + (expiresInSeconds - 300) * 1000; // 5 min safety buffer

      this.saveTokens({
        access_token: data.access_token,
        refresh_token: data.refresh_token || currentRefreshToken,
        expires_at: expiresAt,
        token_type: data.token_type || 'Bearer',
        scope: data.scope,
        user_id: data.user_id
      });

      logger.success('AFFILIATE', `Mercado Livre: access_token renovado com sucesso! Válido por ${(expiresInSeconds / 3600).toFixed(1)} horas.`);
      return data.access_token;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Exchanges an authorization code for initial tokens.
   */
  public async exchangeAuthorizationCode(code: string, redirectUri: string): Promise<MeliTokens> {
    const config = configService.getConfig();
    const clientId = config.affiliate?.mlAppId || process.env.ML_APP_ID;
    const clientSecret = config.affiliate?.mlSecretKey || process.env.ML_SECRET_KEY;

    if (!clientId || !clientSecret) {
      throw new Error('ML_APP_ID e ML_SECRET_KEY são necessários para trocar authorization code.');
    }

    logger.info('AFFILIATE', 'Mercado Livre: Trocando authorization code por tokens OAuth...');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId.toString(),
      client_secret: clientSecret,
      code: code.trim(),
      redirect_uri: redirectUri.trim()
    });

    const response = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params.toString()
    });

    const data: any = await response.json();

    if (!response.ok) {
      logger.error('AFFILIATE', `Mercado Livre: Erro ao trocar code (${response.status}): ${JSON.stringify(data)}`);
      throw new Error(data.message || data.error_description || 'Falha ao trocar código de autorização');
    }

    const expiresInSeconds = data.expires_in || 21600;
    const expiresAt = Date.now() + (expiresInSeconds - 300) * 1000;

    const saved = this.saveTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      token_type: data.token_type || 'Bearer',
      scope: data.scope,
      user_id: data.user_id
    });

    logger.success('AFFILIATE', 'Mercado Livre: Autenticação OAuth inicial realizada com sucesso!');
    return saved;
  }

  /**
   * Returns a valid access token, auto-refreshing if expired.
   */
  public async getValidAccessToken(): Promise<string | null> {
    const tokens = this.getTokens();
    if (!tokens || !tokens.access_token) {
      return null;
    }

    const now = Date.now();
    // If expired or expires within 2 minutes and we have a refresh_token, refresh it proactively
    if (tokens.expires_at <= (now + 120 * 1000) && tokens.refresh_token) {
      try {
        return await this.refreshAccessToken();
      } catch (err: any) {
        logger.warn('AFFILIATE', `Aviso ao renovar token proativamente: ${err.message}. Tentando token atual.`);
      }
    }

    return tokens.access_token;
  }

  /**
   * Starts a 24/7 background interval to refresh OAuth token before it expires.
   */
  public startProactiveTokenRefresher(): void {
    logger.info('AFFILIATE', 'Mercado Livre: Monitor 24/7 de renovação proativa de token ativado.');
    setInterval(async () => {
      try {
        const tokens = this.getTokens();
        if (tokens?.refresh_token) {
          const now = Date.now();
          // If token expires in less than 2 hours, proactively refresh
          if (tokens.expires_at <= (now + 2 * 3600 * 1000)) {
            logger.info('AFFILIATE', 'Mercado Livre: Renovação proativa agendada de token executando...');
            await this.refreshAccessToken();
          }
        }
      } catch (err: any) {
        logger.warn('AFFILIATE', `Aviso na renovação agendada de token: ${err.message}`);
      }
    }, 30 * 60 * 1000); // checks every 30 minutes
  }
}

export const meliAuthService = new MeliAuthService();
