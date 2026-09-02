import fs from 'fs';
import path from 'path';
import { AppConfig } from '../types/index.js';
import { logger } from '../services/logger.service.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = {
  telegram: {
    apiId: process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : null,
    apiHash: process.env.TELEGRAM_API_HASH || '',
    phoneNumber: process.env.TELEGRAM_PHONE || '',
    sourceChannel: process.env.TELEGRAM_SOURCE_CHANNEL || '@PortalDOSsachadinhos',
    enabled: true
  },
  whatsapp: {
    destinationJid: process.env.WHATSAPP_DESTINATION_JID || '120363409015820792@newsletter',
    enabled: true
  },
  forwarder: {
    active: true
  },
  affiliate: {
    mlAppId: process.env.ML_APP_ID || process.env.MELI_APP_ID || '',
    mlSecretKey: process.env.ML_SECRET_KEY || process.env.MELI_SECRET_KEY || '',
    mlAffiliateTag: process.env.ML_AFFILIATE_TAG || process.env.MELI_AFFILIATE_TAG || '',
    mlRedirectUri: process.env.ML_REDIRECT_URI || 'https://localhost',
    mlListShortUrl: process.env.ML_LIST_SHORT_URL || 'https://meli.la/2H1hvz6',
    meliCookie: process.env.ML_COOKIE || process.env.MELI_COOKIE || process.env.MERCADOLIVRE_COOKIE || '',
    meliAccessToken: process.env.ML_ACCESS_TOKEN || process.env.MELI_ACCESS_TOKEN || '',
    meliAffiliateTag: process.env.ML_AFFILIATE_TAG || process.env.MELI_AFFILIATE_TAG || '',
    shopeeAppId: process.env.SHOPEE_APP_ID || '',
    shopeeAppSecret: process.env.SHOPEE_APP_SECRET || '',
    magaluTag: process.env.MAGALU_TAG || '',
    aliexpressAppKey: process.env.ALIEXPRESS_APP_KEY || ''
  }
};

class ConfigService {
  private config: AppConfig = { ...DEFAULT_CONFIG };

  constructor() {
    this.ensureDataDir();
    this.loadConfig();
  }

  private ensureDataDir(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  public loadConfig(): AppConfig {
    try {
      this.ensureDataDir();
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        this.config = {
          telegram: { ...DEFAULT_CONFIG.telegram, ...parsed.telegram },
          whatsapp: { ...DEFAULT_CONFIG.whatsapp, ...parsed.whatsapp },
          forwarder: { ...DEFAULT_CONFIG.forwarder, ...parsed.forwarder },
          affiliate: { ...DEFAULT_CONFIG.affiliate, ...parsed.affiliate }
        };
      } else {
        this.saveConfig(DEFAULT_CONFIG);
      }
    } catch (err: any) {
      logger.error('SYSTEM', `Erro ao carregar arquivo de configuração: ${err.message}`);
      this.config = { ...DEFAULT_CONFIG };
    }
    return this.config;
  }

  public getConfig(): AppConfig {
    return this.config;
  }

  public saveConfig(newConfig: Partial<AppConfig>): AppConfig {
    this.ensureDataDir();
    this.config = {
      telegram: { ...this.config.telegram, ...(newConfig.telegram || {}) },
      whatsapp: { ...this.config.whatsapp, ...(newConfig.whatsapp || {}) },
      forwarder: { ...this.config.forwarder, ...(newConfig.forwarder || {}) },
      affiliate: { ...this.config.affiliate, ...(newConfig.affiliate || {}) }
    };

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
      logger.info('SYSTEM', 'Configurações salvas em data/config.json com sucesso.');
    } catch (err: any) {
      logger.error('SYSTEM', `Erro ao salvar config.json: ${err.message}`);
    }

    return this.config;
  }
}

export const configService = new ConfigService();
