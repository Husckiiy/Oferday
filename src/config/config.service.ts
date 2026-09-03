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
    mlAppId: process.env.ML_APP_ID || process.env.MELI_APP_ID || '5288380056275392',
    mlSecretKey: process.env.ML_SECRET_KEY || process.env.MELI_SECRET_KEY || 'ZOsYifTD0e6TSksppgKagbgBKM45dih3',
    mlAffiliateTag: process.env.ML_AFFILIATE_TAG || process.env.MELI_AFFILIATE_TAG || 'G20260107233651',
    mlRedirectUri: process.env.ML_REDIRECT_URI || 'https://localhost',
    mlListShortUrl: process.env.ML_LIST_SHORT_URL || 'https://meli.la/2H1hvz6',
    meliCookie: process.env.ML_COOKIE || process.env.MELI_COOKIE || process.env.MERCADOLIVRE_COOKIE || '',
    meliAccessToken: process.env.ML_ACCESS_TOKEN || process.env.MELI_ACCESS_TOKEN || '6282693331910478',
    meliAffiliateTag: process.env.ML_AFFILIATE_TAG || process.env.MELI_AFFILIATE_TAG || 'G20260107233651',
    shopeeAppId: process.env.SHOPEE_APP_ID || '18378190901',
    shopeeAppSecret: process.env.SHOPEE_APP_SECRET || 'ITHJMNNGTV4JOSEZLT27UZ3TY7ICCC6L',
    amazonTag: process.env.AMAZON_TAG || process.env.AMAZON_AFFILIATE_TAG || 'ibanez08-20',
    amazonCookie: process.env.AMAZON_COOKIE || '',
    magaluTag: process.env.MAGALU_TAG || process.env.MAGALU_AFFILIATE_TAG || 'magazineibanez01',
    aliexpressAppKey: process.env.ALIEXPRESS_APP_KEY || '544386',
    aliexpressAppSecret: process.env.ALIEXPRESS_APP_SECRET || 'g7NPfxfXQIYYvCHFfTd7VTgRDKgBbYDz',
    aliexpressTrackingId: process.env.ALIEXPRESS_TRACKING_ID || process.env.ALIEXPRESS_AFFILIATE_TAG || 'ibanez'
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

      // Check if data/cookie.txt exists (Mercado Livre)
      const cookieFile = path.join(DATA_DIR, 'cookie.txt');
      if (fs.existsSync(cookieFile)) {
        const c = fs.readFileSync(cookieFile, 'utf-8').trim();
        if (c) {
          this.config.affiliate.meliCookie = c;
        }
      }

      // Check if data/amazon_cookie.txt exists (Amazon SiteStripe)
      const amazonCookieFile = path.join(DATA_DIR, 'amazon_cookie.txt');
      if (fs.existsSync(amazonCookieFile)) {
        const ac = fs.readFileSync(amazonCookieFile, 'utf-8').trim();
        if (ac) {
          this.config.affiliate.amazonCookie = ac;
        }
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

    const currentAff = this.config.affiliate;
    const incomingAff = (newConfig.affiliate || {}) as Partial<AppConfig['affiliate']>;

    const cleanAffiliate = {
      ...currentAff,
      ...incomingAff,
      shopeeAppId: incomingAff.shopeeAppId || currentAff.shopeeAppId || DEFAULT_CONFIG.affiliate.shopeeAppId,
      shopeeAppSecret: incomingAff.shopeeAppSecret || currentAff.shopeeAppSecret || DEFAULT_CONFIG.affiliate.shopeeAppSecret,
      mlAffiliateTag: incomingAff.mlAffiliateTag || currentAff.mlAffiliateTag || DEFAULT_CONFIG.affiliate.mlAffiliateTag,
      meliAffiliateTag: incomingAff.meliAffiliateTag || incomingAff.mlAffiliateTag || currentAff.meliAffiliateTag || DEFAULT_CONFIG.affiliate.meliAffiliateTag,
      mlListShortUrl: incomingAff.mlListShortUrl || currentAff.mlListShortUrl || DEFAULT_CONFIG.affiliate.mlListShortUrl,
      amazonTag: incomingAff.amazonTag || currentAff.amazonTag || DEFAULT_CONFIG.affiliate.amazonTag,
      magaluTag: incomingAff.magaluTag || currentAff.magaluTag || DEFAULT_CONFIG.affiliate.magaluTag,
      aliexpressAppKey: incomingAff.aliexpressAppKey || currentAff.aliexpressAppKey || DEFAULT_CONFIG.affiliate.aliexpressAppKey,
      aliexpressAppSecret: incomingAff.aliexpressAppSecret || currentAff.aliexpressAppSecret || DEFAULT_CONFIG.affiliate.aliexpressAppSecret,
      aliexpressTrackingId: incomingAff.aliexpressTrackingId || currentAff.aliexpressTrackingId || DEFAULT_CONFIG.affiliate.aliexpressTrackingId,
      meliCookie: incomingAff.meliCookie || currentAff.meliCookie,
      amazonCookie: incomingAff.amazonCookie || currentAff.amazonCookie
    };

    this.config = {
      telegram: { ...this.config.telegram, ...(newConfig.telegram || {}) },
      whatsapp: { ...this.config.whatsapp, ...(newConfig.whatsapp || {}) },
      forwarder: { ...this.config.forwarder, ...(newConfig.forwarder || {}) },
      affiliate: cleanAffiliate
    };

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');

      if (newConfig.affiliate?.meliCookie) {
        fs.writeFileSync(path.join(DATA_DIR, 'cookie.txt'), newConfig.affiliate.meliCookie.trim(), 'utf-8');
      }
      if (newConfig.affiliate?.amazonCookie) {
        fs.writeFileSync(path.join(DATA_DIR, 'amazon_cookie.txt'), newConfig.affiliate.amazonCookie.trim(), 'utf-8');
      }

      logger.info('SYSTEM', 'Configurações salvas em data/config.json com sucesso.');
    } catch (err: any) {
      logger.error('SYSTEM', `Erro ao salvar config.json: ${err.message}`);
    }

    return this.config;
  }
}

export const configService = new ConfigService();
