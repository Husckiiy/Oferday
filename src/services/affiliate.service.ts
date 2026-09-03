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
      lower.includes('mercadolivre.com.br')
    ) {
      return 'MERCADO_LIVRE';
    }
    if (lower.includes('shopee.com') || lower.includes('shopee.com.br')) {
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
      lower.includes('magazinevoce.com.br') ||
      lower.includes('parceiromagalu.com.br') ||
      lower.includes('onelink.me') ||
      lower.includes('magalu.me')
    ) {
      return 'MAGALU';
    }
    if (lower.includes('aliexpress.com')) {
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
          parsed.searchParams.set('matt_tool', tag);
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

    // 2. Se for produto -> Tenta gerar meli.la oficial ou link canônico limpo
    const cleanedProductUrl = this.cleanAndTagMercadoLivreUrl(finalUrl, tag);

    const officialMeliLa = await this.generateOfficialMeliShortLink(cleanedProductUrl, tag);
    if (officialMeliLa) {
      logger.success('AFFILIATE', `Mercado Livre: Link curto oficial meli.la gerado com sucesso: ${officialMeliLa}`);
      return officialMeliLa;
    }

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
   * Official Amazon Affiliate Link Generator.
   */
  public async gerarAfiliadoAmazon(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.amazonTag || process.env.AMAZON_TAG || process.env.AMAZON_AFFILIATE_TAG || 'ibanez08-20';

    let amazonUrl = finalUrl;
    const asinMatch = finalUrl.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})/i) || finalUrl.match(/\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (asinMatch) {
      const asin = asinMatch[1];
      amazonUrl = `https://www.amazon.com.br/dp/${asin}?tag=${tag}`;
    } else {
      try {
        const parsed = new URL(finalUrl);
        parsed.searchParams.set('tag', tag);
        amazonUrl = parsed.toString();
      } catch {
        amazonUrl = finalUrl;
      }
    }

    const short = await urlShortenerService.shorten(amazonUrl);
    logger.success('AFFILIATE', `Amazon: Link de afiliado encurtado gerado: ${short}`);
    return short;
  }

  /**
   * Official Magazine Luiza Affiliate Link Generator.
   */
  public async gerarAfiliadoMagalu(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const storeName = config.affiliate?.magaluTag || process.env.MAGALU_TAG || 'magazineibanez01';

    const cleanStore = storeName.replace(/^https?:\/\//, '').replace(/magazinevoce\.com\.br\/?/, '').replace(/\//g, '') || 'magazineibanez01';

    let magaluUrl = finalUrl;
    const prodMatch = finalUrl.match(/\/(?:p|produto)\/([a-zA-Z0-9]+)/i) || finalUrl.match(/sku=([a-zA-Z0-9]+)/i) || finalUrl.match(/codigo_produto=([a-zA-Z0-9]+)/i);
    if (prodMatch) {
      magaluUrl = `https://www.magazinevoce.com.br/${cleanStore}/p/${prodMatch[1]}/`;
    } else {
      try {
        const parsed = new URL(finalUrl);
        magaluUrl = `https://www.magazinevoce.com.br/${cleanStore}${parsed.pathname}`;
      } catch {
        magaluUrl = finalUrl;
      }
    }

    const short = await urlShortenerService.shorten(magaluUrl);
    logger.success('AFFILIATE', `Magalu: Link de afiliado encurtado gerado: ${short}`);
    return short;
  }

  /**
   * Official AliExpress Affiliate Link Generator.
   */
  public async gerarAfiliadoAliexpress(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.aliexpressTrackingId || process.env.ALIEXPRESS_AFFILIATE_TAG || 'ibanez';

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

    // Extract all URLs matching any store pattern
    const matchedUrls = new Set<string>();

    for (const { pattern } of this.STORE_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((m) => matchedUrls.add(m.trim().replace(/[.,;!?]+$/, '')));
      }
    }

    if (matchedUrls.size === 0) {
      return { text, results: [] };
    }

    logger.info('AFFILIATE', `Detectado(s) ${matchedUrls.size} link(s) de loja(s) na mensagem.`);

    for (const originalUrl of matchedUrls) {
      const store = this.identifyStore(originalUrl);
      logger.info('AFFILIATE', `Link original encontrado: ${originalUrl}`);
      logger.info('AFFILIATE', `Loja identificada: ${store}`);

      try {
        const finalResolvedUrl = await this.resolveFinalUrl(originalUrl);
        logger.info('AFFILIATE', `Link final resolvido: ${finalResolvedUrl}`);

        const affiliateUrl = await this.generateAffiliateUrl(store, finalResolvedUrl);

        if (affiliateUrl && affiliateUrl !== originalUrl) {
          logger.success('AFFILIATE', `Substituindo link original pelo link de afiliado: ${affiliateUrl}`);
          // Replace only the specific instance of originalUrl in updatedText
          updatedText = updatedText.split(originalUrl).join(affiliateUrl);
        }

        results.push({
          originalUrl,
          store,
          finalResolvedUrl,
          affiliateUrl,
          replaced: affiliateUrl !== originalUrl
        });
      } catch (err: any) {
        logger.error('AFFILIATE', `Erro ao processar link ${originalUrl}: ${err.message}`);
        results.push({
          originalUrl,
          store,
          finalResolvedUrl: originalUrl,
          affiliateUrl: originalUrl,
          replaced: false
        });
      }
    }

    return { text: updatedText, results };
  }
}

export const affiliateService = new AffiliateService();
