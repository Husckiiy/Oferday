export interface AppConfig {
  telegram: {
    apiId: number | null;
    apiHash: string;
    phoneNumber: string;
    sourceChannel: string; // e.g. "@promocoes" or "promocoes"
    sourceChannels?: Array<{ id: string; name: string; url: string; members?: string; type?: string }>;
    enabled: boolean;
  };
  whatsapp: {
    destinationJid: string; // e.g. "12036302XXXXXXXXXX@g.us" or "5511999999999@s.whatsapp.net" or "xxx@newsletter"
    destinationName?: string; // Custom display name for the channel
    enabled: boolean;
  };
  forwarder: {
    active: boolean;
  };
  filters: {
    blacklist: string[]; // Termos que BLOQUEIAM a mensagem inteira (descarte de spam)
    removeTerms?: string[]; // Termos/linhas que são REMOVIDOS do texto mantendo a oferta
    removeWatermarks: boolean;
    dedupHours: number;
  };
  affiliate: {
    mlAppId: string;
    mlSecretKey: string;
    mlAffiliateTag: string; // e.g. "matt_tool=XXXXXXXX&matt_word=XXXXXXXXX"
    mlRedirectUri?: string;
    mlListShortUrl?: string; // Optional custom short URL for showcase / lists (e.g. "https://meli.la/...")
    meliCookie?: string; // Mercado Livre session cookie to generate official meli.la shortlinks
    meliAccessToken?: string;
    meliAffiliateTag?: string;
    shopeeAppId?: string;
    shopeeAppSecret?: string;
    amazonTag?: string;
    amazonCookie?: string;
    magaluTag?: string;
    aliexpressAppKey?: string;
    aliexpressAppSecret?: string;
    aliexpressTrackingId?: string;
  };
  template?: {
    mode?: 'default' | 'custom';
    customTemplate?: string;
    customWarning?: string;
  };
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'waiting_code' | 'waiting_2fa' | 'connected' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  module: 'TELEGRAM' | 'WHATSAPP' | 'FORWARDER' | 'AFFILIATE' | 'IMAGE' | 'SYSTEM' | 'DIVULGADOR';
  message: string;
  data?: any;
}

export interface ForwardedMessageItem {
  id: string;
  telegramMessageId: number;
  channel: string;
  text: string;
  hasMedia: boolean;
  mediaBase64?: string | null;
  destinationJid: string;
  timestamp: string;
  status: 'success' | 'failed' | 'pending';
  error?: string;
}
