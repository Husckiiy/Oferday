import crypto from 'crypto';
import { configService } from '../config/config.service.js';
import { logger } from './logger.service.js';
import { meliAuthService } from './meli-auth.service.js';
import { urlShortenerService } from './url-shortener.service.js';

export type SupportedStore = 'MERCADO_LIVRE' | 'SHOPEE' | 'AMAZON' | 'MAGALU' | 'ALIEXPRESS' | 'UNKNOWN';

export interface AffiliateResult {
  originalUrl: string;
  store: SupportedStore;
  finalResolvedUrl: string;
  affiliateUrl: string;
  replaced: boolean;
}

export class AffiliateService {
  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  // Store Regex Patterns
  private readonly STORE_PATTERNS = [
    {
      store: 'MERCADO_LIVRE' as SupportedStore,
      pattern: /https?:\/\/(?:www\.)?(?:meli\.la|mercadolivre\.com(?:\.br)?(?:\/sec)?|produto\.mercadolivre\.com\.br|mercadolibre\.com(?:\.[a-z]{2})?)\/[^\s<>"')]+/gi
    },
    {
      store: 'SHOPEE' as SupportedStore,
      pattern: /https?:\/\/(?:www\.)?(?:s\.shopee\.com\.br|shopee\.com\.br|shopee\.com)\/[^\s<>"')]+/gi
    },
    {
      store: 'AMAZON' as SupportedStore,
      pattern: /https?:\/\/(?:www\.)?(?:amzn\.to|amazon\.com(?:\.br)?|a\.co)\/[^\s<>"')]+/gi
    },
    {
      store: 'MAGALU' as SupportedStore,
      pattern: /https?:\/\/(?:www\.)?(?:magazineluiza\.com\.br|magazinevoce\.com\.br|(?:[a-zA-Z0-9_-]+\.)?onelink\.me|magalu\.me|magazinevoce\.com)\/[^\s<>"')]+/gi
    },
    {
      store: 'ALIEXPRESS' as SupportedStore,
      pattern: /https?:\/\/(?:www\.)?(?:s\.click\.aliexpress\.com|aliexpress\.com|pt\.aliexpress\.com|best\.aliexpress\.com)\/[^\s<>"')]+/gi
    }
  ];

  /**
   * Identifies which store a given URL belongs to.
   */
  public identifyStore(url: string): SupportedStore {
    const lower = url.toLowerCase();
    if (
      lower.includes('meli.la') ||
      lower.includes('mercadolivre.com') ||
      lower.includes('mercadolibre.com') ||
      lower.includes('mercadolivre.com.br') ||
      lower.includes('ml.app.link')
    ) {
      return 'MERCADO_LIVRE';
    }
    if (
      lower.includes('shopee.com') ||
      lower.includes('shopee.com.br') ||
      lower.includes('shp.ee') ||
      lower.includes('shope.ee')
    ) {
      return 'SHOPEE';
    }
    if (
      lower.includes('amazon.com') ||
      lower.includes('amazon.com.br') ||
      lower.includes('amzn.to') ||
      lower.includes('a.co/') ||
      lower.includes('//a.co')
    ) {
      return 'AMAZON';
    }
    if (
      lower.includes('magazineluiza.com.br') ||
      lower.includes('magazineluiza.com') ||
      lower.includes('magazinevoce.com.br') ||
      lower.includes('magazinevoce.com') ||
      lower.includes('parceiromagalu.com.br') ||
      lower.includes('parceiromagalu.com') ||
      lower.includes('divulgador.magalu.com') ||
      lower.includes('onelink.me') ||
      lower.includes('magalu.me')
    ) {
      return 'MAGALU';
    }
    if (
      lower.includes('aliexpress.com') ||
      lower.includes('s.click.aliexpress.com') ||
      lower.includes('a.aliexpress.com')
    ) {
      return 'ALIEXPRESS';
    }
    return 'UNKNOWN';
  }

  /**
   * Resolves URL redirects up to 10 hops to find the canonical product destination.
   */
  public async resolveFinalUrl(url: string, maxHops: number = 10): Promise<string> {
    let currentUrl = url.trim();

    // Clean trailing punctuation accidentally captured by regex
    currentUrl = currentUrl.replace(/[.,;!?]+$/, '');

    logger.info('AFFILIATE', `Resolvendo redirecionamentos para: ${currentUrl}`);

    for (let hop = 0; hop < maxHops; hop++) {
      try {
        const response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });

        const status = response.status;
        const locationHeader = response.headers.get('location');

        if ([301, 302, 303, 307, 308].includes(status) && locationHeader) {
          const nextUrl = new URL(locationHeader, currentUrl).toString();
          currentUrl = nextUrl;
          continue;
        }

        // If status is 200, check if there is HTML meta refresh or canonical tag
        if (status === 200) {
          try {
            const html = await response.text();
            // Check meta refresh
            const metaRefresh = html.match(/<meta\s+http-equiv=["']refresh["']\s+content=["']\d+;\s*url=([^"']+)["']/i);
            if (metaRefresh && metaRefresh[1]) {
              const metaUrl = new URL(metaRefresh[1], currentUrl).toString();
              if (metaUrl !== currentUrl) {
                currentUrl = metaUrl;
                continue;
              }
            }
          } catch {
            // ignore HTML parse error
          }
        }

        break;
      } catch (err: any) {
        logger.warn('AFFILIATE', `Aviso ao seguir redirecionamento (${currentUrl}): ${err.message}`);
        break;
      }
    }

    // Unwrap intermediate redirect wrappers (e.g. /gz/account-verification?go=... or ?go=...)
    try {
      while (currentUrl.includes('go=http') || currentUrl.includes('url=http') || currentUrl.includes('target=http')) {
        const parsed = new URL(currentUrl);
        const goParam = parsed.searchParams.get('go') || parsed.searchParams.get('url') || parsed.searchParams.get('target');
        if (goParam && (goParam.startsWith('http://') || goParam.startsWith('https://'))) {
          currentUrl = goParam;
        } else {
          break;
        }
      }

      // Remove device verification tracking artifacts if present
      if (currentUrl.includes('tid=') || currentUrl.includes('noscript=')) {
        const parsed = new URL(currentUrl);
        parsed.searchParams.delete('tid');
        parsed.searchParams.delete('noscript');
        currentUrl = parsed.toString();
      }
    } catch {
      // ignore
    }

    return currentUrl;
  }

  /**
   * Cleans competitor tracking junk (&ref=..., old matt_tool, long slugs) and shortens to canonical format.
   */
  public cleanAndTagMercadoLivreUrl(url: string, tag: string): string {
    try {
      const parsed = new URL(url);

      // 1. Shorten product URLs by removing long title slugs and keeping only /p/MLB... or /MLB...
      const pMatch = parsed.pathname.match(/\/p\/(MLB\d+)/i);
      if (pMatch) {
        parsed.pathname = `/p/${pMatch[1]}`;
      } else {
        const mlbMatch = parsed.pathname.match(/\/(MLB-?\d+)/i);
        if (mlbMatch && parsed.hostname.includes('produto.mercadolivre.com.br')) {
          parsed.pathname = `/${mlbMatch[1]}`;
        }
      }

      // 2. List of junk / tracking / competitor parameters to strip completely
      const junkParams = [
        'ref',
        'forceInApp',
        'tracking_id',
        'applied_filter',
        'variation',
        'pdp_filters',
        'searchVariation',
        'c_id',
        'c_element_order',
        'wid',
        'sid',
        'vip_meta',
        'fe_id',
        'attributes',
        'context',
        'matt_event_ts',
        'matt_event_source',
        'matt_event_name',
        'matt_tool',
        'matt_word',
        'matt_source',
        'matt_campaign',
        'matt_keyword',
        'matt_seller',
        'matt_product'
      ];

      junkParams.forEach((param) => parsed.searchParams.delete(param));

      // 3. Attach your affiliate tag
      if (tag) {
        if (tag.includes('=')) {
          const tagParams = new URLSearchParams(tag);
          for (const [k, v] of tagParams.entries()) {
            parsed.searchParams.set(k, v);
          }
        } else {
          parsed.searchParams.set('matt_word', tag);
          parsed.searchParams.set('matt_tool', '3120588434');
        }
      }

      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Generates official https://meli.la/xxxx link using Mercado Livre's Linkbuilder API if cookie is provided.
   */
  public async generateOfficialMeliShortLink(productUrl: string, tag: string): Promise<string | null> {
    const config = configService.getConfig();
    const cookie = config.affiliate?.meliCookie || process.env.ML_COOKIE || process.env.MELI_COOKIE || process.env.MERCADOLIVRE_COOKIE || '';

    if (!cookie) {
      return null;
    }

    try {
      // 1. Get dynamic CSRF Token from Linkbuilder page
      logger.info('AFFILIATE', 'Mercado Livre: Obtendo token CSRF do Linkbuilder oficial...');
      const pageResp = await fetch('https://www.mercadolivre.com.br/afiliados/linkbuilder', {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Cookie': cookie
        },
        signal: AbortSignal.timeout(6000)
      });

      if (!pageResp.ok) {
        logger.warn('AFFILIATE', `Mercado Livre: Falha ao acessar Linkbuilder (HTTP ${pageResp.status})`);
        return null;
      }

      const html = await pageResp.text();
      let csrfToken = '';
      const m = html.match(/(?:csrfToken|_csrf|csrf)[\"':\s]+[\"']([^\"']+)[\"']/i);
      if (m && m[1]) {
        csrfToken = m[1];
      } else {
        const cookieMatch = cookie.match(/_csrf=([^;]+)/);
        if (cookieMatch) {
          csrfToken = cookieMatch[1];
        }
      }

      if (!csrfToken) {
        logger.warn('AFFILIATE', 'Mercado Livre: CSRF token não encontrado na página.');
        return null;
      }

      let apiTag = tag;
      if (apiTag.includes('matt_word=')) {
        const match = apiTag.match(/matt_word=([^&]+)/);
        if (match) apiTag = match[1];
      }
      if (!apiTag || apiTag === '6282693331910478') {
        apiTag = 'G20260107233651';
      }

      logger.info('AFFILIATE', `Mercado Livre: Chamando Linkbuilder com tag ${apiTag}...`);

      // 2. Call official Linkbuilder createLink endpoint
      const postResp = await fetch('https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink', {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Origin': 'https://www.mercadolivre.com.br',
          'Referer': 'https://www.mercadolivre.com.br/afiliados/linkbuilder',
          'User-Agent': this.userAgent,
          'x-csrf-token': csrfToken,
          'Cookie': cookie
        },
        body: JSON.stringify({
          urls: [productUrl],
          tag: apiTag
        }),
        signal: AbortSignal.timeout(8000)
      });

      logger.info('AFFILIATE', `Mercado Livre: Linkbuilder POST status HTTP ${postResp.status}`);

      if (postResp.ok) {
        const data: any = await postResp.json();
        if (Array.isArray(data?.urls) && data.urls.length > 0) {
          const shortUrl = data.urls[0]?.short_url || data.urls[0]?.url;
          if (shortUrl && (shortUrl.includes('meli.la') || shortUrl.includes('mercadolivre.com/sec'))) {
            return shortUrl;
          }
        }
      }
    } catch (err: any) {
      logger.warn('AFFILIATE', `Aviso ao gerar meli.la oficial via Linkbuilder: ${err.message}`);
    }

    return null;
  }

  /**
   * Official Mercado Livre Affiliate Link Generator.
   * Generates clean, official Mercado Livre canonical links or official meli.la showcase links.
   */
  public async gerarAfiliadoMercadoLivre(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.mlAffiliateTag || config.affiliate?.meliAffiliateTag || process.env.ML_AFFILIATE_TAG || process.env.MELI_AFFILIATE_TAG || '';
    const customListUrl = config.affiliate?.mlListShortUrl || process.env.ML_LIST_SHORT_URL || 'https://meli.la/2H1hvz6';

    const isListOrSocial = finalUrl.toLowerCase().includes('/social/') || finalUrl.toLowerCase().includes('/lista/') || finalUrl.toLowerCase().includes('/lists');

    // 1. Se for lista ou vitrine social -> direciona para o link oficial da sua lista/vitrine meli.la
    if (isListOrSocial) {
      if (customListUrl) {
        logger.success('AFFILIATE', `Mercado Livre: Lista/Vitrine convertida para sua vitrine oficial: ${customListUrl}`);
        return customListUrl;
      }
      const cleanList = this.cleanAndTagMercadoLivreUrl(finalUrl, tag);
      logger.success('AFFILIATE', `Mercado Livre: Link oficial de lista gerado: ${cleanList}`);
      return cleanList;
    }

    // 2. Se for produto -> Tenta gerar meli.la oficial usando a URL canônica limpa
    const rawCleanUrl = this.cleanAndTagMercadoLivreUrl(finalUrl, '');
    const officialMeliLa = await this.generateOfficialMeliShortLink(rawCleanUrl, tag);
    if (officialMeliLa) {
      logger.success('AFFILIATE', `Mercado Livre: Link curto oficial meli.la gerado com sucesso: ${officialMeliLa}`);
      return officialMeliLa;
    }

    const cleanedProductUrl = this.cleanAndTagMercadoLivreUrl(finalUrl, tag);
    logger.success('AFFILIATE', `Mercado Livre: Link oficial de produto gerado: ${cleanedProductUrl}`);
    return cleanedProductUrl;
  }

  /**
   * Official Shopee Affiliate Link Generator (uses official GraphQL API for s.shopee.com.br).
   */
  public async gerarAfiliadoShopee(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const appId = config.affiliate?.shopeeAppId || process.env.SHOPEE_APP_ID || '18378190901';
    const secret = config.affiliate?.shopeeAppSecret || process.env.SHOPEE_APP_SECRET || 'ITHJMNNGTV4JOSEZLT27UZ3TY7ICCC6L';

    // 1. Tenta gerar link curto oficial s.shopee.com.br via GraphQL API
    if (appId && secret) {
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const bodyStr = JSON.stringify({
          query: `mutation {
            generateShortLink(input: { originUrl: "${finalUrl}" }) {
              shortLink
            }
          }`
        });

        const factor = `${appId}${timestamp}${bodyStr}${secret}`;
        const signature = crypto.createHash('sha256').update(factor, 'utf8').digest('hex');

        const resp = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`
          },
          body: bodyStr,
          signal: AbortSignal.timeout(8000)
        });

        if (resp.ok) {
          const data: any = await resp.json();
          const shortLink = data?.data?.generateShortLink?.shortLink;
          if (shortLink && (shortLink.includes('s.shopee') || shortLink.includes('shope.ee') || shortLink.includes('shopee.com'))) {
            logger.success('AFFILIATE', `Shopee: Link curto oficial gerado via API: ${shortLink}`);
            return shortLink;
          }
        }
      } catch (err: any) {
        logger.warn('AFFILIATE', `Aviso ao gerar link curto da Shopee via API: ${err.message}`);
      }
    }

    // 2. Fallback de parâmetros oficiais
    const cleanTag = appId.includes('an_') ? (appId.match(/(an_\d+)/)?.[1] || 'an_18378190901') : `an_${appId}`;
    const match = finalUrl.match(/i\.(\d+)\.(\d+)/);
    if (match) {
      const shopeeUrl = `https://shopee.com.br/product/${match[1]}/${match[2]}?utm_source=${cleanTag}&mmp_pid=${cleanTag}`;
      logger.success('AFFILIATE', `Shopee: Link oficial gerado: ${shopeeUrl}`);
      return shopeeUrl;
    }

    try {
      const parsed = new URL(finalUrl);
      parsed.searchParams.set('utm_source', cleanTag);
      parsed.searchParams.set('mmp_pid', cleanTag);
      const shopeeUrl = parsed.toString();
      logger.success('AFFILIATE', `Shopee: Link oficial gerado: ${shopeeUrl}`);
      return shopeeUrl;
    } catch {
      return finalUrl;
    }
  }

  /**
   * Generates official Amazon short link (link.amazon / amzn.to) via SiteStripe API.
   * Works for all Amazon URLs (products, /prime, /deals, categories, etc.).
   */
  public async generateOfficialAmazonShortLink(longUrl: string, tag: string): Promise<string | null> {
    const config = configService.getConfig();
    const cookie = config.affiliate?.amazonCookie || process.env.AMAZON_COOKIE || '';

    if (!cookie) {
      return null;
    }

    try {
      const apiUrl = `https://www.amazon.com.br/associates/sitestripe/getShortUrl?longUrl=${encodeURIComponent(longUrl)}&marketplaceId=526970&storeId=${tag}`;

      const res = await fetch(apiUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': longUrl,
          'X-Requested-With': 'XMLHttpRequest',
          'Cookie': cookie
        },
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
        const data: any = await res.json();
        const shortUrl = data.shortUrl || data.url;
        if (shortUrl && (shortUrl.includes('amazon') || shortUrl.includes('amzn.to'))) {
          return shortUrl;
        }
      }
    } catch (err: any) {
      logger.warn('AFFILIATE', `Aviso ao gerar link curto da Amazon via SiteStripe: ${err.message}`);
    }

    return null;
  }

  /**
   * Official Amazon Affiliate Link Generator.
   */
  public async gerarAfiliadoAmazon(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.amazonTag || process.env.AMAZON_TAG || process.env.AMAZON_AFFILIATE_TAG || 'ibanez08-20';

    let targetLongUrl = '';
    const asinMatch = finalUrl.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})/i) || finalUrl.match(/\/([A-Z0-9]{10})(?:[/?]|$)/i);

    if (asinMatch) {
      const asin = asinMatch[1];
      targetLongUrl = `https://www.amazon.com.br/dp/${asin}?tag=${tag}&linkCode=sl2`;
    } else {
      try {
        const parsed = new URL(finalUrl);
        parsed.searchParams.set('tag', tag);
        parsed.searchParams.set('linkCode', 'sl2');
        targetLongUrl = parsed.toString();
      } catch {
        targetLongUrl = finalUrl;
      }
    }

    // 1. Tenta gerar o link curto oficial via SiteStripe API
    const officialShort = await this.generateOfficialAmazonShortLink(targetLongUrl, tag);
    if (officialShort) {
      logger.success('AFFILIATE', `Amazon: Link curto oficial SiteStripe gerado: ${officialShort}`);
      return officialShort;
    }

    logger.success('AFFILIATE', `Amazon: Link oficial gerado: ${targetLongUrl}`);
    return targetLongUrl;
  }

  /**
   * Official Magazine Luiza Affiliate Link Generator.
   */
  public async gerarAfiliadoMagalu(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const storeName = config.affiliate?.magaluTag || process.env.MAGALU_TAG || 'magazineibanez01';

    const cleanStore = storeName.replace(/^https?:\/\//, '').replace(/magazinevoce\.com\.br\/?/, '').replace(/\//g, '') || 'magazineibanez01';

    const prodMatch = finalUrl.match(/\/(?:p|produto)\/([a-zA-Z0-9]+)/i) || finalUrl.match(/sku=([a-zA-Z0-9]+)/i) || finalUrl.match(/codigo_produto=([a-zA-Z0-9]+)/i);
    if (prodMatch) {
      const magaluUrl = `https://www.magazinevoce.com.br/${cleanStore}/p/${prodMatch[1]}/`;
      logger.success('AFFILIATE', `Magalu: Link oficial gerado: ${magaluUrl}`);
      return magaluUrl;
    }

    try {
      const parsed = new URL(finalUrl);
      const magaluUrl = `https://www.magazinevoce.com.br/${cleanStore}${parsed.pathname}`;
      logger.success('AFFILIATE', `Magalu: Link oficial gerado: ${magaluUrl}`);
      return magaluUrl;
    } catch {
      return finalUrl;
    }
  }

  /**
   * Generates official AliExpress short link (s.click.aliexpress.com) via Open Platform API.
   */
  public async generateOfficialAliexpressShortLink(targetUrl: string, trackingId: string): Promise<string | null> {
    const config = configService.getConfig();
    const appKey = config.affiliate?.aliexpressAppKey || process.env.ALIEXPRESS_APP_KEY || '544386';
    const appSecret = config.affiliate?.aliexpressAppSecret || process.env.ALIEXPRESS_APP_SECRET || 'g7NPfxfXQIYYvCHFfTd7VTgRDKgBbYDz';

    if (!appKey || !appSecret) {
      return null;
    }

    try {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

      const params: Record<string, string> = {
        app_key: appKey,
        timestamp: timestamp,
        format: 'json',
        method: 'aliexpress.affiliate.link.generate',
        sign_method: 'sha256',
        v: '2.0',
        promotion_link_type: '0',
        source_values: targetUrl,
        tracking_id: trackingId || 'ibanez'
      };

      const sortedKeys = Object.keys(params).sort();
      let signString = '';
      for (const k of sortedKeys) {
        signString += `${k}${params[k]}`;
      }

      const signHmac = crypto.createHmac('sha256', appSecret).update(signString, 'utf8').digest('hex').toUpperCase();

      const urlHmac = new URL('https://api-sg.aliexpress.com/sync');
      Object.entries(params).forEach(([k, v]) => urlHmac.searchParams.set(k, v));
      urlHmac.searchParams.set('sign', signHmac);

      const resp = await fetch(urlHmac.toString(), {
        method: 'POST',
        signal: AbortSignal.timeout(8000)
      });

      if (resp.ok) {
        const data: any = await resp.json();
        const links = data?.aliexpress_affiliate_link_generate_response?.resp_result?.result?.promotion_links?.promotion_link;
        if (Array.isArray(links) && links.length > 0) {
          const shortUrl = links[0]?.promotion_link;
          if (shortUrl && (shortUrl.includes('s.click.aliexpress.com') || shortUrl.includes('aliexpress.com'))) {
            return shortUrl;
          }
        }
      }
    } catch (err: any) {
      logger.warn('AFFILIATE', `Aviso ao gerar link curto do AliExpress via API: ${err.message}`);
    }

    return null;
  }

  /**
   * Official AliExpress Affiliate Link Generator.
   */
  public async gerarAfiliadoAliexpress(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.aliexpressTrackingId || process.env.ALIEXPRESS_AFFILIATE_TAG || 'ibanez';

    // 1. Tenta gerar link oficial s.click via API
    const officialShort = await this.generateOfficialAliexpressShortLink(finalUrl, tag);
    if (officialShort) {
      logger.success('AFFILIATE', `AliExpress: Link curto oficial gerado via API: ${officialShort}`);
      return officialShort;
    }

    // 2. Fallback de link canônico oficial
    const itemMatch = finalUrl.match(/\/item\/(\d+)\.html/i) || finalUrl.match(/item\/(\d+)/i);
    if (itemMatch) {
      const aliUrl = `https://pt.aliexpress.com/item/${itemMatch[1]}.html?aff_fcid=${tag}&tt=CPS_NORMAL`;
      logger.success('AFFILIATE', `AliExpress: Link oficial gerado: ${aliUrl}`);
      return aliUrl;
    }

    try {
      const parsed = new URL(finalUrl);
      parsed.searchParams.set('aff_fcid', tag);
      parsed.searchParams.set('tt', 'CPS_NORMAL');
      const aliUrl = parsed.toString();
      logger.success('AFFILIATE', `AliExpress: Link oficial gerado: ${aliUrl}`);
      return aliUrl;
    } catch {
      return finalUrl;
    }
  }

  /**
   * Dispatches generation to the appropriate store method.
   */
  public async generateAffiliateUrl(store: SupportedStore, finalUrl: string): Promise<string> {
    switch (store) {
      case 'MERCADO_LIVRE':
        return await this.gerarAfiliadoMercadoLivre(finalUrl);
      case 'SHOPEE':
        return await this.gerarAfiliadoShopee(finalUrl);
      case 'AMAZON':
        return await this.gerarAfiliadoAmazon(finalUrl);
      case 'MAGALU':
        return await this.gerarAfiliadoMagalu(finalUrl);
      case 'ALIEXPRESS':
        return await this.gerarAfiliadoAliexpress(finalUrl);
      default:
        return finalUrl;
    }
  }

  /**
   * Finds all monitored store URLs in text, resolves redirects,
   * converts to affiliate links, and replaces them preserving original text.
   */
  public async processMessageText(text: string): Promise<{ text: string; results: AffiliateResult[] }> {
    if (!text || !text.trim()) {
      return { text: text || '', results: [] };
    }

    const results: AffiliateResult[] = [];
    let updatedText = text;

    // Extract ALL HTTP/HTTPS URLs from the text
    const urlRegex = /(https?:\/\/[^\s<>"')]+)/gi;
    const allMatches = text.match(urlRegex) || [];
    const uniqueUrls = Array.from(new Set(allMatches.map((u) => u.trim().replace(/[.,;!?]+$/, ''))));

    if (uniqueUrls.length === 0) {
      return { text, results: [] };
    }

    logger.info('AFFILIATE', `Detectado(s) ${uniqueUrls.length} link(s) na mensagem.`);

    for (const originalUrl of uniqueUrls) {
      try {
        logger.info('AFFILIATE', `Processando link original: ${originalUrl}`);
        const finalResolvedUrl = await this.resolveFinalUrl(originalUrl);
        logger.info('AFFILIATE', `Link final resolvido: ${finalResolvedUrl}`);

        // Identify store from BOTH the final expanded destination URL and the original URL
        let store = this.identifyStore(finalResolvedUrl);
        if (store === 'UNKNOWN') {
          store = this.identifyStore(originalUrl);
        }

        if (store === 'UNKNOWN') {
          logger.info('AFFILIATE', `Link ${originalUrl} não pertence a nenhuma das 5 lojas suportadas. Mantendo original.`);
          continue;
        }

        logger.info('AFFILIATE', `Loja identificada: ${store}`);
        const affiliateUrl = await this.generateAffiliateUrl(store, finalResolvedUrl);

        if (affiliateUrl && affiliateUrl !== originalUrl) {
          logger.success('AFFILIATE', `Substituindo [${store}]: ${originalUrl} -> ${affiliateUrl}`);
          // Replace all instances of originalUrl with affiliateUrl
          updatedText = updatedText.split(originalUrl).join(affiliateUrl);
        }

        results.push({
          originalUrl,
          store,
          finalResolvedUrl,
          affiliateUrl: affiliateUrl || originalUrl,
          replaced: !!affiliateUrl && affiliateUrl !== originalUrl
        });
      } catch (err: any) {
        logger.error('AFFILIATE', `Erro ao processar link ${originalUrl}: ${err.message}`);
        results.push({
          originalUrl,
          store: 'UNKNOWN',
          finalResolvedUrl: originalUrl,
          affiliateUrl: originalUrl,
          replaced: false
        });
      }
    }

    return { text: updatedText, results };
  }

  /**
   * Extracts canonical unique product identifier for deduplication (Anti-Duplicate filter)
   */
  public extractProductFingerprint(url: string): string | null {
    if (!url) return null;
    const lower = url.toLowerCase();

    // Mercado Livre (MLB12345678 or /p/MLBxxxx)
    if (lower.includes('mercadolivre') || lower.includes('meli.la')) {
      const mlbMatch = url.match(/(MLB-?\d+)/i) || url.match(/\/p\/([a-zA-Z0-9]+)/i);
      if (mlbMatch) {
        return `ml_${mlbMatch[1].replace('-', '').toUpperCase()}`;
      }
    }

    // Amazon (ASIN B0xxxxxxxxx)
    if (lower.includes('amazon') || lower.includes('amzn.to')) {
      const asinMatch = url.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})/i) || url.match(/\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (asinMatch) {
        return `amz_${asinMatch[1].toUpperCase()}`;
      }
    }

    // Magalu (/p/237981200/)
    if (lower.includes('magazinevoce') || lower.includes('magazineluiza') || lower.includes('parceiromagalu')) {
      const magaluMatch = url.match(/\/(?:p|produto)\/([a-zA-Z0-9]+)/i) || url.match(/sku=([a-zA-Z0-9]+)/i);
      if (magaluMatch) {
        return `magalu_${magaluMatch[1].toLowerCase()}`;
      }
    }

    // Shopee (item id & shop id)
    if (lower.includes('shopee') || lower.includes('shp.ee') || lower.includes('shope.ee')) {
      const shopeeMatch = url.match(/-i\.(\d+)\.(\d+)/) || url.match(/\/product\/(\d+)\/(\d+)/);
      if (shopeeMatch) {
        return `shopee_${shopeeMatch[1]}_${shopeeMatch[2]}`;
      }
      try {
        const parsed = new URL(url);
        if (parsed.pathname.length > 3) {
          return `shopee_${parsed.pathname.replace(/\/+$/, '')}`;
        }
      } catch {}
    }

    // AliExpress
    if (lower.includes('aliexpress')) {
      const aliMatch = url.match(/\/(?:item|i)\/(\d+)\.html/i) || url.match(/itemId=(\d+)/i);
      if (aliMatch) {
        return `ali_${aliMatch[1]}`;
      }
    }

    return null;
  }
}

export const affiliateService = new AffiliateService();
