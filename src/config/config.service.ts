import fs from 'fs';
import path from 'path';
import { AppConfig } from '../types/index.js';
import { logger } from '../services/logger.service.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG: AppConfig = {
  telegram: {
    apiId: process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : null,
    apiHash: process.env.TELEGRAM_API_HASH || '',
    phoneNumber: process.env.TELEGRAM_PHONE || '',
    sourceChannel: process.env.TELEGRAM_SOURCE_CHANNEL || '@jptechofertasgerais, @EconomizandoComJP, @Promos_tech1, @PortalDOSsachadinhos',
    sourceChannels: [
      { id: '1', name: 'Jp tech', url: 'https://t.me/jptechofertasgerais', type: 'telegram' },
      { id: '2', name: 'Economizando com JP', url: 'https://t.me/EconomizandoComJP', type: 'telegram' },
      { id: '3', name: 'Promos Tech', url: 'https://t.me/Promos_tech1', type: 'telegram' },
      { id: '4', name: 'Eu', url: 'https://t.me/PortalDOSsachadinhos', type: 'telegram' }
    ],
    enabled: true
  },
  whatsapp: {
    destinationJid: process.env.WHATSAPP_DESTINATION_JID || '120363409015820792@newsletter',
    destinationName: process.env.WHATSAPP_DESTINATION_NAME || 'Teste <3',
    enabled: true
  },
  forwarder: {
    active: true
  },
  filters: {
    blacklist: [
      'instagram.com',
      'tiktok.com',
      'grupo vip'
    ],
    removeTerms: [
      'bot de moedas',
      'economizandobot',
      't.me/economizandobot',
      '(anuncio)',
      '@economizandocomjp'
    ],
    removeWatermarks: true,
    dedupHours: 4
  },
  affiliate: {
    mlAppId: process.env.ML_APP_ID || process.env.MELI_APP_ID || '6282693331910478',
    mlSecretKey: process.env.ML_SECRET_KEY || process.env.MELI_SECRET_KEY || 'gV7EDEKygMX4uEP8J9lh0gLIj6wx42Ya',
    mlAffiliateTag: process.env.ML_AFFILIATE_TAG || process.env.MELI_AFFILIATE_TAG || 'G20260107233651',
    mlRedirectUri: process.env.ML_REDIRECT_URI || 'https://localhost',
    mlListShortUrl: process.env.ML_LIST_SHORT_URL || 'https://meli.la/2H1hvz6',
    meliCookie: process.env.ML_COOKIE || process.env.MELI_COOKIE || process.env.MERCADOLIVRE_COOKIE || '_hjSessionUser_580848=eyJpZCI6Ijc1ZWZmN2M3LTI5Y2QtNTdlMi05OWFhLWIyZTU2MjEwZjg5YiIsImNyZWF0ZWQiOjE3Njg4NDAyMjkzOTQsImV4aXN0aW5nIjp0cnVlfQ==; _tt_enable_cookie=1; _ttp=01KFBHFXVVVEB3RNVCPX6X5WTS_.tt.2; _pin_unauth=dWlkPU5UVXlORFkyTlRJdE1qQmpZUzAwWmprNUxXSmhZVE10WVRBeVlqa3lOREZqWWpOag; _d2id=98caacb3-8aac-46cd-9f3e-7d3d831a5155; ftid=0Dfs2ztsaLyfRUOZqq6SFNsHHU8B2480-1768947166089; _hjSessionUser_720738=eyJpZCI6ImJjODYzNmU4LTZmNjctNWM4ZS04ZjU2LTUwNmZmMDNjYmI1YyIsImNyZWF0ZWQiOjE3Njg5NDcxNjQ4NTAsImV4aXN0aW5nIjp0cnVlfQ==; p_dsid=09a9da60-1321-40bd-bfe4-a9c92b10364e-1768948033326; tooltip=true; modal-configuration={\"cbt_modal\":{\"view_cnt\":2,\"close_cnt\":0,\"view_time\":1775781739,\"close_time\":0}}; cto_bundle=aOdjBl81c1hCYmtYUFFPWEpxZXVpcXhoUVdGT211azVza3Q3ejBtV3dMVUdGaWpDZmhMZUZra1AxUXF4ZE1nekFVUm1sUUpjVGtKNGdQbVp5bTc4ZEVtOVhnUUZHSnpSWHZwcEJwZnpuQSUyRjZZcWQlMkJvZWlobHZTTmZJQkFaSFUlMkZuR3duMTZtb05mM3hVYXclMkZ6am5tSm5HVW9HV3ZjamJvZiUyQjlrblNzSVhpOGg0emFVJTNE; _gcl_gs=2.1.k4$i1785367619$u159491452; cross_esc_web-flow=%7B%2298caacb3-8aac-46cd-9f3e-7d3d831a5155%22%3A%7B%229853432764%22%3A%22dJioFmOgDLAMrRlUceF2ldxjnQ9VoHM%2Fpnb70cXDD5tCnw%3D%3D%22%7D%7D; __rtbh.uid=%7B%22eventType%22%3A%22uid%22%2C%22id%22%3A%22496692086%22%2C%22expiryDate%22%3A%222027-07-31T19%3A13%3A02.569Z%22%7D; __rtbh.lid=%7B%22eventType%22%3A%22lid%22%2C%22id%22%3A%22jXUAMkXY0kgtH5nifopM%22%2C%22expiryDate%22%3A%222027-07-31T19%3A13%3A02.569Z%22%7D; _uetvid=2badd900f55411f08f4adf659883352d; _derived_epik=dj0yJnU9RmI1OWlMdEprUHVxOFZJRlZWdUNOd2NvdUVINWdPU1Mmbj1FRFQ4SEtST0NyOUFSV3loWEN3OUhRJm09NCZ0PUFBQUFBR3BzODcwJnJtPTQmcnQ9QUFBQUFHcHM4NzAmc3A9Mg; ttcsid_C9SJ5SBC77UADFMAH8T0=1785525126357::1KMcoJd4Pyk1Mret8Xgm.25.1785525182837.1; c_2gohsX=1; sc-menu-hide-new-section_MY_DETAILS=MY_DETAILS; sc-menu-hide-new-section_CREDIT_MARKET=CREDIT_MARKET; c_ZvGDaU=1; c_1aKfTA=1; g_state={\"i_l\":0,\"i_ll\":1787105963814,\"i_b\":\"xunkWCjLWzOcS97K9bt+mol68654QPgyD12WZxsEfGU\",\"i_e\":{\"enable_itp_optimization\":24},\"i_et\":1787105963814}; orgnickp=G20260107233651; ssid=ghy-081822-IETtx7eSWdjaPd510R79h46bYZgf7B-__-3120588434-__-1881800418827--RRR_0-RRR_0; orguseridp=3120588434; cp=07150060; c_57eld=1; _gcl_aw=GCL.1787362738.CjwKCAjw7p_UBhBlEiwAhpIs7_0lP0O72Gu0fhKRTzmMeld-mlHHz-IotpL9QcCFXnpsDyWnBBDzTBoC7wAQAvD_BwE; _gcl_au=1.1.958602436.1785367622.1324992185.1787362740.1787362741.996363001.1787362739.1787362741; c_Z1J2Div=1; c_nomtd=1; p_edsid=32307584-310b-3381-927f-4ce3be51757b-1787934289848; _ga=GA1.3.322172623.1787972998; isExternalTraffic=true; QSI_SI_d4ikElJeWDP7fzo_intercept=true; c_22GkCt=1; nav_dab_closed=1; LAST_SEARCH=nootbok%20acer%20nitro%20; _csrf=PBNhMbEhVueGAIxibFRTt6qM; _mldataSessionId=a1f18663-abec-4ff3-a42a-63a2f51b84dc; ml_cart-quantity=1; _gid=GA1.3.1875522524.1788320774; orguserid=0H00Zdd977THT; rtid=7613c573-5252-4513-be63-57f01139bf28; hide-cookie-banner=3120588434-COOKIE_PREFERENCES_ALREADY_SET; nsa_rotok=eyJhbGciOiJSUzI1NiIsImtpZCI6IjMiLCJ0eXAiOiJKV1QifQ.eyJpZGVudGlmaWVyIjoiYTFhMjg1NGUtYjBiZC00NzAyLTkwMWYtY2I0ODA4M2RmZjUyIiwicm90YXRpb25faWQiOiJlZDQ4MjVkMC04YzA3LTQyNmYtYThmMy1jOGQxMWFlYmRlYTIiLCJwbGF0Zm9ybSI6Ik1MIiwicm90YXRpb25fZGF0ZSI6MTc4ODMyODIwOCwiZXhwIjoxNzkwOTE5NjA4LCJqdGkiOiI0NTU2MGIxNy03YzZiLTQyYzItOWQwYS1mODMwYmMzYjIxYWEiLCJpYXQiOjE3ODgzMjc2MDgsInN1YiI6ImExYTI4NTRlLWIwYmQtNDcwMi05MDFmLWNiNDgwODNkZmY1MiJ9.e6hGzpLOtjJ-zLHq8Ptwi8fdedEZ8S9MSQe-vjfaRTdr-eMg88zApBYpunc0msNgggKySMcYGjaO9PrUoQ09PSfHfCVB0ld6JBlSQBGwOFG5xtL4EiStAyziBt4NP_VF73Qtr-9WrozlDvHXzn0s7MWcDRiSDRh8hZBxqAGOUcQf4TGtmTu33NlkZZp5GUDDMBaZfsFHCTR2yQmqsdJxEQxJv5IdDdHKXFwKn-sOeT-4EqvjazQ_khskDexpe5eaKk-FDNLM_jFOfk3QAdKRyPko0nKDi8mgcYE9_O5qAXYwnEjkfVUEfNX-iTP9eSry34OJcqD65h7LA5CVCbXlDA; _ml_ar-browser-check=43e9f478-a855-49c5-9d60-15e2888c77db',
    meliAccessToken: process.env.ML_ACCESS_TOKEN || process.env.MELI_ACCESS_TOKEN || '',
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
          filters: { ...DEFAULT_CONFIG.filters, ...parsed.filters },
          affiliate: { ...DEFAULT_CONFIG.affiliate, ...parsed.affiliate }
        };
      } else {
        this.saveConfig(DEFAULT_CONFIG);
      }

      // Ensure fallback for cookies if not present or too short
      if (!this.config.affiliate.meliCookie || this.config.affiliate.meliCookie.trim().length < 50) {
        this.config.affiliate.meliCookie = DEFAULT_CONFIG.affiliate.meliCookie;
      }
      if (!this.config.affiliate.amazonCookie || this.config.affiliate.amazonCookie.trim().length < 50) {
        this.config.affiliate.amazonCookie = DEFAULT_CONFIG.affiliate.amazonCookie;
      }

      // Check if data/cookie.txt exists (Mercado Livre)
      const cookieFile = path.join(DATA_DIR, 'cookie.txt');
      if (fs.existsSync(cookieFile)) {
        const c = fs.readFileSync(cookieFile, 'utf-8').trim();
        if (c && c.length > 50) {
          this.config.affiliate.meliCookie = c;
        }
      }

      // Check if data/amazon_cookie.txt exists (Amazon SiteStripe)
      const amazonCookieFile = path.join(DATA_DIR, 'amazon_cookie.txt');
      if (fs.existsSync(amazonCookieFile)) {
        const ac = fs.readFileSync(amazonCookieFile, 'utf-8').trim();
        if (ac && ac.length > 50) {
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
      filters: { ...this.config.filters, ...(newConfig.filters || {}) },
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
