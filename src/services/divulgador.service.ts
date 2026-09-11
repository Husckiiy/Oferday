import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { affiliateService } from './affiliate.service.js';
import { whatsappService } from './whatsapp.service.js';
import { imageService } from './image.service.js';
import { templateService } from './template.service.js';
import { logger } from './logger.service.js';
import { configService } from '../config/config.service.js';

export interface DivulgadorOffer {
  id: string;
  store: 'AMAZON' | 'MERCADO_LIVRE' | 'SHOPEE' | 'MAGALU' | 'ALIEXPRESS';
  title: string;
  originalPrice?: number;
  promoPrice: number;
  discountPercent?: number;
  coupon?: string;
  imageUrl: string;
  productUrl: string;
  category: 'Tech' | 'Casa' | 'Beleza' | 'Moda' | 'Achadinhos' | 'Games' | 'Geral';
  postedAt: string;
  tags?: string[];
}

export interface GetOffersResult {
  offers: DivulgadorOffer[];
  total: number;
  page: number;
  totalPages: number;
  limit: number;
}

class DivulgadorService {
  private offersFile = path.resolve(process.cwd(), 'data', 'divulgador_offers.json');
  private offers: DivulgadorOffer[] = [];
  private isHarvesting: boolean = false;
  private harvestTimer: NodeJS.Timeout | null = null;
  private userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

  constructor() {
    this.loadOffers();
    // Executar garimpagem inicial e agendar a cada 15 minutos
    this.harvestAll().catch(() => {});
    this.harvestTimer = setInterval(() => {
      this.harvestAll().catch(() => {});
    }, 15 * 60 * 1000);
  }

  private loadOffers(): void {
    try {
      if (fs.existsSync(this.offersFile)) {
        const raw = fs.readFileSync(this.offersFile, 'utf-8');
        this.offers = JSON.parse(raw);
      }
      if (!this.offers || this.offers.length === 0) {
        this.offers = [];
      }
    } catch (err: any) {
      logger.error('SYSTEM', `[Divulgador] Erro ao carregar ofertas: ${err.message}`);
      this.offers = [];
    }
  }

  private saveOffers(): void {
    try {
      const dir = path.dirname(this.offersFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.offersFile, JSON.stringify(this.offers, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error('SYSTEM', `[Divulgador] Erro ao salvar ofertas: ${err.message}`);
    }
  }

  public getOffers(filters?: {
    store?: string;
    category?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): GetOffersResult {
    let list = [...this.offers];

    if (filters?.store && filters.store !== 'ALL') {
      list = list.filter(o => o.store.toUpperCase() === filters.store?.toUpperCase());
    }

    if (filters?.category && filters.category !== 'ALL') {
      list = list.filter(o => o.category.toLowerCase() === filters.category?.toLowerCase());
    }

    if (filters?.search && filters.search.trim().length > 0) {
      const q = filters.search.toLowerCase().trim();
      list = list.filter(o =>
        o.title.toLowerCase().includes(q) ||
        o.store.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        (o.coupon && o.coupon.toLowerCase().includes(q))
      );
    }

    const total = list.length;
    const page = Math.max(1, Number(filters?.page) || 1);
    const limit = Math.max(1, Number(filters?.limit) || 12);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const startIndex = (page - 1) * limit;
    const paginatedOffers = list.slice(startIndex, startIndex + limit);

    return {
      offers: paginatedOffers,
      total,
      page,
      totalPages,
      limit
    };
  }

  public getOfferById(id: string): DivulgadorOffer | undefined {
    return this.offers.find(o => o.id === id);
  }

  public addOffer(offerData: Partial<DivulgadorOffer>): DivulgadorOffer | null {
    if (!offerData.title || !offerData.productUrl) return null;

    // Normalizar URL para evitar duplicatas
    const cleanUrl = offerData.productUrl.split('?')[0].split('#')[0].toLowerCase();
    const existingIndex = this.offers.findIndex(o => o.productUrl && o.productUrl.split('?')[0].split('#')[0].toLowerCase() === cleanUrl);

    const newOffer: DivulgadorOffer = {
      id: offerData.id || crypto.randomUUID().slice(0, 8),
      store: (offerData.store as any) || 'MERCADO_LIVRE',
      title: offerData.title.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim(),
      originalPrice: offerData.originalPrice,
      promoPrice: Number(offerData.promoPrice) || 0,
      discountPercent: offerData.discountPercent || (offerData.originalPrice && offerData.promoPrice && offerData.originalPrice > offerData.promoPrice ? Math.round((1 - (offerData.promoPrice / offerData.originalPrice)) * 100) : undefined),
      coupon: offerData.coupon ? offerData.coupon.toUpperCase().trim() : undefined,
      imageUrl: offerData.imageUrl || '',
      productUrl: offerData.productUrl,
      category: offerData.category || 'Geral',
      postedAt: offerData.postedAt || new Date().toISOString(),
      tags: offerData.tags || []
    };

    if (existingIndex !== -1) {
      this.offers[existingIndex] = { ...this.offers[existingIndex], ...newOffer };
      return this.offers[existingIndex];
    }

    this.offers.unshift(newOffer);
    if (this.offers.length > 5000) this.offers = this.offers.slice(0, 5000);
    return newOffer;
  }

  public ingestFromTelegramMessage(text: string, mediaBuffer?: Buffer | null): void {
    // Método auxiliar mantido para compatibilidade com o forwarder
    if (!text || text.length < 15) return;
  }

  /**
   * Garimpagem direta oficial do Mercado Livre (todas as categorias e ofertas)
   */
  public async harvestMercadoLivre(): Promise<number> {
    const mlSources = [
      { url: 'https://www.mercadolivre.com.br/ofertas?page=1', cat: 'Geral' as const },
      { url: 'https://www.mercadolivre.com.br/ofertas?page=2', cat: 'Geral' as const },
      { url: 'https://www.mercadolivre.com.br/ofertas?page=3', cat: 'Geral' as const },
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1051&page=1', cat: 'Tech' as const }, // Celulares
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1648&page=1', cat: 'Tech' as const }, // Informática
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1000&page=1', cat: 'Tech' as const }, // Eletrônicos
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1144&page=1', cat: 'Games' as const }, // Games
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1574&page=1', cat: 'Casa' as const }, // Casa
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1039&page=1', cat: 'Casa' as const }, // Eletrodomésticos
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1276&page=1', cat: 'Beleza' as const }, // Beleza
      { url: 'https://www.mercadolivre.com.br/ofertas?category=MLB1430&page=1', cat: 'Moda' as const } // Moda
    ];

    let count = 0;
    for (const src of mlSources) {
      try {
        const res = await fetch(src.url, {
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9'
          },
          signal: AbortSignal.timeout(8000)
        });

        if (!res.ok) continue;
        const html = await res.text();
        const cards = html.split('class="poly-card__portada');

        for (let i = 1; i < cards.length; i++) {
          const card = cards[i];
          const titleM = card.match(/class="poly-component__title"[^>]*>([^<]+)<\/a>/i);
          const linkM = card.match(/href="([^"]+)"[^>]*class="poly-component__title"/i) || card.match(/class="poly-component__title"[^>]*href="([^"]+)"/i);
          const imgM = card.match(/<img[^>]*class="poly-component__picture"[^>]*src="([^"]+)"/i) || card.match(/https:\/\/http2\.mlstatic\.com\/D_[^"'\s\),]+/i);

          if (!titleM || !linkM) continue;

          const title = titleM[1].trim();
          let productUrl = linkM[1].split('#')[0].split('?')[0];
          if (!productUrl.startsWith('http')) productUrl = 'https://produto.mercadolivre.com.br' + productUrl;

          let imageUrl = imgM ? (typeof imgM === 'string' ? imgM : imgM[1] || imgM[0]) : '';
          if (imageUrl) imageUrl = imageUrl.replace(/D_Q_NP_[0-9X]+_/, 'D_Q_NP_2X_');

          // Preço original (<s>)
          let originalPrice: number | undefined;
          const sTagM = card.match(/<s[\s\S]*?<\/s>/i);
          if (sTagM) {
            const frac = sTagM[0].match(/class="andes-money-amount__fraction"[^>]*>([^<]+)<\/span>/i);
            const cent = sTagM[0].match(/class="andes-money-amount__cents[^"]*"[^>]*>([^<]+)<\/span>/i);
            if (frac) {
              const f = frac[1].replace(/\./g, '');
              const c = cent ? cent[1] : '00';
              originalPrice = parseFloat(`${f}.${c}`);
            }
          }

          // Preço promocional
          let promoPrice = 0;
          const currentPriceM = card.match(/class="poly-price__current"([\s\S]*?)<\/div>/i);
          if (currentPriceM) {
            const frac = currentPriceM[1].match(/class="andes-money-amount__fraction"[^>]*>([^<]+)<\/span>/i);
            const cent = currentPriceM[1].match(/class="andes-money-amount__cents[^"]*"[^>]*>([^<]+)<\/span>/i);
            if (frac) {
              const f = frac[1].replace(/\./g, '');
              const c = cent ? cent[1] : '00';
              promoPrice = parseFloat(`${f}.${c}`);
            }
          }

          if (!promoPrice) {
            const cleanForPromo = card.replace(/<s[\s\S]*?<\/s>/gi, '');
            const frac = cleanForPromo.match(/class="andes-money-amount__fraction"[^>]*>([^<]+)<\/span>/i);
            const cent = cleanForPromo.match(/class="andes-money-amount__cents[^"]*"[^>]*>([^<]+)<\/span>/i);
            if (frac) {
              const f = frac[1].replace(/\./g, '');
              const c = cent ? cent[1] : '00';
              promoPrice = parseFloat(`${f}.${c}`);
            }
          }

          if (!promoPrice) continue;

          let discountPercent: number | undefined;
          const discM = card.match(/([0-9]+)%\s*OFF/i);
          if (discM) {
            discountPercent = parseInt(discM[1], 10);
          } else if (originalPrice && promoPrice && originalPrice > promoPrice) {
            discountPercent = Math.round((1 - (promoPrice / originalPrice)) * 100);
          }

          const added = this.addOffer({
            store: 'MERCADO_LIVRE',
            title,
            productUrl,
            imageUrl,
            originalPrice,
            promoPrice,
            discountPercent,
            category: src.cat,
            postedAt: new Date().toISOString()
          });

          if (added) count++;
        }
      } catch (err: any) {
        logger.warn('SYSTEM', `[Divulgador] Aviso ao garimpar ML ${src.url}: ${err.message}`);
      }
    }
    return count;
  }

  /**
   * Garimpagem oficial via API GraphQL da Shopee
   */
  public async harvestShopee(): Promise<number> {
    const config = configService.getConfig();
    const appId = config.affiliate?.shopeeAppId || '18378190901';
    const secret = config.affiliate?.shopeeAppSecret || 'ITHJMNNGTV4JOSEZLT27UZ3TY7ICCC6L';

    let count = 0;
    const pages = [1, 2, 3, 4];

    for (const page of pages) {
      try {
        const query = `query {
          productOfferV2(page: ${page}, limit: 50) {
            nodes {
              itemId
              productName
              offerLink
              imageUrl
              price
              priceMin
              priceMax
              priceDiscountRate
              sales
              ratingStar
            }
          }
        }`;

        const timestamp = Math.floor(Date.now() / 1000);
        const bodyStr = JSON.stringify({ query });
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
          const nodes = data?.data?.productOfferV2?.nodes || [];

          for (const n of nodes) {
            const promo = parseFloat(n.price || n.priceMin || '0');
            if (!promo || !n.productName) continue;

            let category: DivulgadorOffer['category'] = 'Geral';
            const nameLower = n.productName.toLowerCase();
            if (nameLower.includes('fone') || nameLower.includes('celular') || nameLower.includes('carregador') || nameLower.includes('cabo') || nameLower.includes('smartwatch')) category = 'Tech';
            else if (nameLower.includes('gamer') || nameLower.includes('jogo') || nameLower.includes('mouse') || nameLower.includes('teclado')) category = 'Games';
            else if (nameLower.includes('cozinha') || nameLower.includes('casa') || nameLower.includes('almofada') || nameLower.includes('luminária') || nameLower.includes('panela')) category = 'Casa';
            else if (nameLower.includes('perfume') || nameLower.includes('creme') || nameLower.includes('shampoo') || nameLower.includes('maquiagem') || nameLower.includes('skincare')) category = 'Beleza';
            else if (nameLower.includes('vestido') || nameLower.includes('camisa') || nameLower.includes('calça') || nameLower.includes('tênis') || nameLower.includes('bolsa')) category = 'Moda';
            else category = 'Achadinhos';

            const disc = n.priceDiscountRate ? Number(n.priceDiscountRate) : undefined;
            let orig: number | undefined;
            if (disc && disc > 0) {
              orig = parseFloat((promo / (1 - (disc / 100))).toFixed(2));
            }

            const added = this.addOffer({
              store: 'SHOPEE',
              title: n.productName.replace(/[\r\n]+/g, ' ').trim(),
              productUrl: n.offerLink || `https://shopee.com.br/product/0/${n.itemId}`,
              imageUrl: n.imageUrl,
              originalPrice: orig,
              promoPrice: promo,
              discountPercent: disc && disc > 0 ? disc : undefined,
              category,
              postedAt: new Date().toISOString()
            });

            if (added) count++;
          }
        }
      } catch (err: any) {
        logger.warn('SYSTEM', `[Divulgador] Aviso ao garimpar Shopee (página ${page}): ${err.message}`);
      }
    }
    return count;
  }

  /**
   * Garimpagem oficial via API Open Platform do AliExpress
   */
  public async harvestAliExpress(): Promise<number> {
    const config = configService.getConfig();
    const appKey = config.affiliate?.aliexpressAppKey || '544386';
    const appSecret = config.affiliate?.aliexpressAppSecret || 'g7NPfxfXQIYYvCHFfTd7VTgRDKgBbYDz';
    const trackingId = config.affiliate?.aliexpressTrackingId || 'ibanez';

    let count = 0;
    const keywords = ['fone bluetooth', 'smartwatch', 'ferramentas', 'gamer teclado', 'relogio inteligente', 'acessorios celular'];

    for (const kw of keywords) {
      try {
        const d = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const timestamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

        const params: Record<string, string> = {
          app_key: appKey,
          timestamp: timestamp,
          format: 'json',
          method: 'aliexpress.affiliate.product.query',
          sign_method: 'sha256',
          v: '2.0',
          target_currency: 'BRL',
          target_language: 'PT',
          tracking_id: trackingId,
          keywords: kw,
          page_size: '20',
          page_no: '1',
          sort: 'LAST_VOLUME_DESC'
        };

        const sortedKeys = Object.keys(params).sort();
        let signString = '';
        for (const k of sortedKeys) {
          signString += `${k}${params[k]}`;
        }

        const signHmac = crypto.createHmac('sha256', appSecret).update(signString, 'utf8').digest('hex').toUpperCase();

        const url = new URL('https://api-sg.aliexpress.com/sync');
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        url.searchParams.set('sign', signHmac);

        const resp = await fetch(url.toString(), {
          method: 'POST',
          signal: AbortSignal.timeout(8000)
        });

        if (resp.ok) {
          const data: any = await resp.json();
          const products = data?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product || [];

          for (const p of products) {
            const promo = parseFloat(p.target_sale_price || p.target_app_sale_price || p.sale_price || '0');
            const orig = parseFloat(p.target_original_price || p.original_price || '0');
            if (!promo || !p.product_title) continue;

            let category: DivulgadorOffer['category'] = 'Geral';
            const nameLower = p.product_title.toLowerCase();
            if (nameLower.includes('fone') || nameLower.includes('smartwatch') || nameLower.includes('celular') || nameLower.includes('cabo')) category = 'Tech';
            else if (nameLower.includes('gamer') || nameLower.includes('jogo') || nameLower.includes('mouse') || nameLower.includes('teclado')) category = 'Games';
            else if (nameLower.includes('casa') || nameLower.includes('luminária') || nameLower.includes('ferramenta') || nameLower.includes('cozinha')) category = 'Casa';
            else if (nameLower.includes('beleza') || nameLower.includes('maquiagem') || nameLower.includes('cabelo')) category = 'Beleza';
            else if (nameLower.includes('roupa') || nameLower.includes('bolsa') || nameLower.includes('vestido') || nameLower.includes('jaqueta')) category = 'Moda';
            else category = 'Achadinhos';

            const disc = p.discount ? parseInt(p.discount.replace('%', ''), 10) : (orig > promo ? Math.round((1 - (promo / orig)) * 100) : undefined);

            const added = this.addOffer({
              store: 'ALIEXPRESS',
              title: p.product_title.replace(/[\r\n]+/g, ' ').trim(),
              productUrl: p.promotion_link || p.product_detail_url,
              imageUrl: p.product_main_image_url || p.product_small_image_urls?.string?.[0] || '',
              originalPrice: orig > promo ? orig : undefined,
              promoPrice: promo,
              discountPercent: disc,
              category,
              postedAt: new Date().toISOString()
            });

            if (added) count++;
          }
        }
      } catch (err: any) {
        logger.warn('SYSTEM', `[Divulgador] Aviso ao garimpar AliExpress (${kw}): ${err.message}`);
      }
    }
    return count;
  }

  /**
   * Garimpagem direta de ofertas oficiais
   */
  public async harvestAll(): Promise<number> {
    if (this.isHarvesting) return 0;
    this.isHarvesting = true;
    logger.info('SYSTEM', `[Divulgador] Iniciando garimpagem 100% DIRETA das plataformas oficiais (Mercado Livre, Shopee, AliExpress)...`);

    let totalHarvested = 0;

    try {
      const mlCount = await this.harvestMercadoLivre();
      totalHarvested += mlCount;
      logger.info('SYSTEM', `[Divulgador] Mercado Livre: ${mlCount} ofertas garimpadas diretamente.`);

      const shopeeCount = await this.harvestShopee();
      totalHarvested += shopeeCount;
      logger.info('SYSTEM', `[Divulgador] Shopee (API Oficial): ${shopeeCount} ofertas garimpadas diretamente.`);

      const aliCount = await this.harvestAliExpress();
      totalHarvested += aliCount;
      logger.info('SYSTEM', `[Divulgador] AliExpress (API Oficial): ${aliCount} ofertas garimpadas diretamente.`);
    } catch (err: any) {
      logger.error('SYSTEM', `[Divulgador] Erro durante garimpagem: ${err.message}`);
    }

    this.saveOffers();
    logger.success('SYSTEM', `[Divulgador] Garimpagem concluída! ${totalHarvested} novas ofertas sincronizadas. Catálogo total: ${this.offers.length} promoções ativas.`);
    this.isHarvesting = false;
    return totalHarvested;
  }

  public async dispatchOffer(offerIdOrData: string | Partial<DivulgadorOffer>): Promise<{
    success: boolean;
    affiliateUrl: string;
    messageText: string;
    whatsappSent: boolean;
    telegramSent: boolean;
    error?: string;
  }> {
    let offer: DivulgadorOffer | undefined;

    if (typeof offerIdOrData === 'string') {
      offer = this.getOfferById(offerIdOrData);
    } else if (offerIdOrData && offerIdOrData.productUrl) {
      offer = offerIdOrData as DivulgadorOffer;
    }

    if (!offer) {
      throw new Error('Oferta não encontrada no catálogo.');
    }

    logger.info('SYSTEM', `[Divulgador] Disparando oferta: ${offer.title} (${offer.store})`);

    // 1. Converter link do produto para o Afiliado Oficial
    const affiliateProcessed = await affiliateService.processMessageText(offer.productUrl);
    const finalAffiliateUrl = affiliateProcessed.text || offer.productUrl;
    const config = configService.getConfig();

    // 2. Montar texto promocional (se tiver customMessageText vindo do Disparo Manual, usa ele diretamente)
    let messageText = '';
    const customText = (offer as any)?.customMessageText || (offerIdOrData as any)?.customMessageText;
    if (customText && typeof customText === 'string' && customText.trim().length > 0) {
      messageText = customText.trim();
    } else {
      messageText = templateService.render(config.template?.customTemplate, {
        title: offer.title,
        store: offer.store,
        originalPrice: offer.originalPrice,
        promoPrice: offer.promoPrice,
        discountPercent: offer.discountPercent,
        coupon: offer.coupon,
        affiliateUrl: finalAffiliateUrl,
        category: offer.category
      });
    }

    // 3. Processar e baixar imagem diretamente da fonte
    let finalMediaBuffer: Buffer | null = null;
    if (offer.imageUrl) {
      try {
        const response = await fetch(offer.imageUrl, {
          headers: {
            'User-Agent': this.userAgent,
            'Referer': 'https://www.google.com/'
          },
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          finalMediaBuffer = Buffer.from(arrayBuffer);
        }
      } catch (err: any) {
        logger.warn('SYSTEM', `[Divulgador] Falha ao baixar imagem: ${err.message}`);
      }
    }

    let whatsappSent = false;
    let telegramSent = false;

    // 4. Enviar para WhatsApp
    const destinationJid = config.whatsapp?.destinationJid;
    if (destinationJid && whatsappService.getStatus().status === 'connected') {
      try {
        await whatsappService.sendMessage(destinationJid, messageText, finalMediaBuffer);
        whatsappSent = true;
        logger.success('SYSTEM', `[Divulgador] Oferta enviada para o WhatsApp (${destinationJid}) com sucesso!`);
      } catch (err: any) {
        logger.error('SYSTEM', `[Divulgador] Erro ao enviar para WhatsApp: ${err.message}`);
      }
    } else {
      logger.warn('SYSTEM', '[Divulgador] WhatsApp não está conectado ou destino não configurado.');
    }

    return {
      success: whatsappSent || true,
      affiliateUrl: finalAffiliateUrl,
      messageText,
      whatsappSent,
      telegramSent
    };
  }
}

export const divulgadorService = new DivulgadorService();
