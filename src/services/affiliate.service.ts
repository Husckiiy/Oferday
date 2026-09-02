import { configService } from '../config/config.service.js';
import { logger } from './logger.service.js';
import { meliAuthService } from './meli-auth.service.js';
import { urlShortenerService } from './url-shortener.service.js';

export type SupportedStore = 'MERCADO_LIVRE' | 'SHOPEE' | 'MAGALU' | 'ALIEXPRESS' | 'UNKNOWN';

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
      store: 'MAGALU' as SupportedStore,
      pattern: /https?:\/\/(?:www\.)?(?:magazineluiza\.com\.br|magazinevoce\.com\.br|(?:[a-zA-Z0-9_-]+\.)?onelink\.me|magazinevoce\.com)\/[^\s<>"')]+/gi
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
      lower.includes('magazineluiza.com.br') ||
      lower.includes('magazinevoce.com.br') ||
      lower.includes('onelink.me')
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
   * Official Mercado Livre Affiliate Short Link Generator.
   * Converts ALL product and list links into short, elegant affiliate links.
   */
  public async gerarAfiliadoMercadoLivre(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.mlAffiliateTag || config.affiliate?.meliAffiliateTag || process.env.ML_AFFILIATE_TAG || process.env.MELI_AFFILIATE_TAG || '';
    const customListUrl = config.affiliate?.mlListShortUrl || process.env.ML_LIST_SHORT_URL || '';

    const isListOrSocial = finalUrl.toLowerCase().includes('/social/') || finalUrl.toLowerCase().includes('/lista/') || finalUrl.toLowerCase().includes('/lists');

    // 1. If it's a list/vitrine and the user has a custom short list URL configured, return it
    if (isListOrSocial && customListUrl) {
      logger.success('AFFILIATE', `Mercado Livre: Lista/Vitrine direcionada para sua URL curta oficial: ${customListUrl}`);
      return customListUrl;
    }

    // 2. Clean competitor tracking params (&ref=...) and attach user affiliate tag
    const cleanedTaggedUrl = this.cleanAndTagMercadoLivreUrl(finalUrl, tag);

    // If it's a list/social and no custom short URL was set, shorten the cleaned tagged URL
    if (isListOrSocial) {
      const shortList = await urlShortenerService.shorten(cleanedTaggedUrl);
      logger.success('AFFILIATE', `Mercado Livre: Link curto de lista gerado: ${shortList}`);
      return shortList;
    }

    // 3. For product URLs: try official Mercado Livre createLink API if token is available
    let token = await meliAuthService.getValidAccessToken();

    if (token) {
      const CREATE_LINK_URL = 'https://api.mercadolibre.com/affiliate-program/api/v2/affiliates/createLink';

      const callCreateLinkApi = async (accessToken: string) => {
        const cleanUrlForApi = this.cleanAndTagMercadoLivreUrl(finalUrl, '');
        logger.info('AFFILIATE', `Mercado Livre: Chamando createLink para: ${cleanUrlForApi}...`);
        
        let apiTag = tag;
        if (apiTag.includes('matt_word=')) {
          const match = apiTag.match(/matt_word=([^&]+)/);
          if (match) apiTag = match[1];
        }

        const payload: any = {
          urls: [cleanUrlForApi]
        };
        if (apiTag) {
          payload.tag = apiTag;
        }

        return await fetch(CREATE_LINK_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });
      };

      try {
        let response = await callCreateLinkApi(token);

        if (response.status === 401) {
          logger.warn('AFFILIATE', 'Mercado Livre: Token expirado (401). Renovando via refresh_token...');
          try {
            token = await meliAuthService.refreshAccessToken();
            if (token) {
              response = await callCreateLinkApi(token);
            }
          } catch (refreshErr: any) {
            logger.error('AFFILIATE', `Mercado Livre: Falha ao renovar token: ${refreshErr.message}`);
          }
        }

        const rawText = await response.text();
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          data = rawText;
        }

        if (response.ok && data) {
          let shortUrl: string | undefined;

          if (Array.isArray(data?.urls) && data.urls.length > 0) {
            const first = data.urls[0];
            shortUrl = typeof first === 'string' ? first : (first?.short_url || first?.url || first?.affiliate_url || first?.link);
          } else if (Array.isArray(data?.results) && data.results.length > 0) {
            const first = data.results[0];
            shortUrl = typeof first === 'string' ? first : (first?.short_url || first?.url || first?.affiliate_url);
          } else if (data?.short_url || data?.url || data?.affiliate_url) {
            shortUrl = data.short_url || data.url || data.affiliate_url;
          }

          if (shortUrl && (shortUrl.includes('meli.la') || shortUrl.includes('mercadolivre.com/sec'))) {
            logger.success('AFFILIATE', `Mercado Livre: Link curto oficial meli.la gerado com sucesso: ${shortUrl}`);
            return shortUrl;
          }
        }
      } catch (err: any) {
        logger.warn('AFFILIATE', `Mercado Livre: createLink indisponível: ${err.message}`);
      }
    }

    // 4. Guarantee 100% of product links are shortened
    const shortProductUrl = await urlShortenerService.shorten(cleanedTaggedUrl);
    logger.success('AFFILIATE', `Mercado Livre: Link curto de afiliado gerado com sucesso: ${shortProductUrl}`);
    return shortProductUrl;
  }

  /**
   * Shopee Affiliate Link Generator.
   */
  public async gerarAfiliadoShopee(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.shopeeAppId || 'an_18378190901';

    let cleanUrl = finalUrl;
    const match = finalUrl.match(/i\.(\d+)\.(\d+)/);
    if (match) {
      cleanUrl = `https://shopee.com.br/product/${match[1]}/${match[2]}?utm_source=${tag}&mmp_pid=${tag}`;
    } else {
      try {
        const parsed = new URL(finalUrl);
        parsed.searchParams.set('utm_source', tag);
        parsed.searchParams.set('mmp_pid', tag);
        cleanUrl = parsed.toString();
      } catch {
        cleanUrl = finalUrl;
      }
    }

    const shortShopee = await urlShortenerService.shorten(cleanUrl);
    logger.success('AFFILIATE', `Shopee: Link curto de afiliado gerado: ${shortShopee}`);
    return shortShopee;
  }

  /**
   * Magazine Luiza Affiliate Link Generator.
   */
  public async gerarAfiliadoMagalu(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const storeName = config.affiliate?.magaluTag || 'magazinevoce';

    let cleanUrl = finalUrl;
    const prodMatch = finalUrl.match(/\/(?:p|produto)\/([a-zA-Z0-9]+)/i);
    if (prodMatch) {
      cleanUrl = `https://www.magazinevoce.com.br/${storeName}/p/${prodMatch[1]}/`;
    }

    const shortMagalu = await urlShortenerService.shorten(cleanUrl);
    logger.success('AFFILIATE', `Magalu: Link curto de afiliado gerado: ${shortMagalu}`);
    return shortMagalu;
  }

  /**
   * AliExpress Affiliate Link Generator.
   */
  public async gerarAfiliadoAliexpress(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.aliexpressTrackingId || 'afiliado';

    let cleanUrl = finalUrl;
    const itemMatch = finalUrl.match(/\/item\/(\d+)\.html/i) || finalUrl.match(/item\/(\d+)/i);
    if (itemMatch) {
      cleanUrl = `https://pt.aliexpress.com/item/${itemMatch[1]}.html?aff_fcid=${tag}&tt=CPS_NORMAL`;
    }

    const shortAli = await urlShortenerService.shorten(cleanUrl);
    logger.success('AFFILIATE', `AliExpress: Link curto de afiliado gerado: ${shortAli}`);
    return shortAli;
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
      case 'MAGALU':
        return await this.gerarAfiliadoMagalu(finalUrl);
      case 'ALIEXPRESS':
        return await this.gerarAfiliadoAliexpress(finalUrl);
      default:
        return await urlShortenerService.shorten(finalUrl);
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
