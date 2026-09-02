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

    // 2. Se for produto -> Formata o link canônico oficial limpo com as suas tags de afiliado
    const cleanedProductUrl = this.cleanAndTagMercadoLivreUrl(finalUrl, tag);
    logger.success('AFFILIATE', `Mercado Livre: Link oficial de produto gerado: ${cleanedProductUrl}`);
    return cleanedProductUrl;
  }

  /**
   * Official Shopee Affiliate Link Generator.
   */
  public async gerarAfiliadoShopee(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const tag = config.affiliate?.shopeeAppId || process.env.SHOPEE_AFFILIATE_UNIVERSAL_URL || 'an_18378190901';

    let cleanTag = tag;
    if (cleanTag.includes('an_')) {
      const match = cleanTag.match(/(an_\d+)/);
      if (match) cleanTag = match[1];
    }

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
   * Official Magazine Luiza Affiliate Link Generator.
   */
  public async gerarAfiliadoMagalu(finalUrl: string): Promise<string> {
    const config = configService.getConfig();
    const storeName = config.affiliate?.magaluTag || process.env.MAGALU_TAG || 'magazineibanez01';

    const cleanStore = storeName.replace(/^https?:\/\//, '').replace(/magazinevoce\.com\.br\/?/, '').replace(/\//g, '') || 'magazineibanez01';

    const prodMatch = finalUrl.match(/\/(?:p|produto)\/([a-zA-Z0-9]+)/i);
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
