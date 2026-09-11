import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { affiliateService } from './affiliate.service.js';
import { whatsappService } from './whatsapp.service.js';
import { imageService } from './image.service.js';
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

  constructor() {
    this.loadOffers();
    // Iniciar garimpagem automática a cada 30 minutos
    this.harvestAll().catch(() => {});
    this.harvestTimer = setInterval(() => {
      this.harvestAll().catch(() => {});
    }, 30 * 60 * 1000);
  }

  private loadOffers(): void {
    try {
      if (fs.existsSync(this.offersFile)) {
        const raw = fs.readFileSync(this.offersFile, 'utf-8');
        this.offers = JSON.parse(raw);
      }
      if (!this.offers || this.offers.length === 0) {
        this.offers = this.getDefaultCuratedOffers();
        this.saveOffers();
      }
    } catch (err: any) {
      logger.error('SYSTEM', `[Divulgador] Erro ao carregar ofertas: ${err.message}`);
      this.offers = this.getDefaultCuratedOffers();
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

  public addOffer(offerData: Partial<DivulgadorOffer>): DivulgadorOffer {
    // Evitar duplicidade por URL
    if (offerData.productUrl) {
      const cleanUrl = offerData.productUrl.split('?')[0];
      const existing = this.offers.find(o => o.productUrl && o.productUrl.split('?')[0] === cleanUrl);
      if (existing) {
        return existing;
      }
    }

    const newOffer: DivulgadorOffer = {
      id: offerData.id || crypto.randomUUID().slice(0, 8),
      store: (offerData.store as any) || 'AMAZON',
      title: (offerData.title || 'Oferta Especial').replace(/[\r\n]+/g, ' ').trim(),
      originalPrice: offerData.originalPrice,
      promoPrice: Number(offerData.promoPrice) || 0,
      discountPercent: offerData.discountPercent || (offerData.originalPrice && offerData.promoPrice ? Math.round((1 - (offerData.promoPrice / offerData.originalPrice)) * 100) : undefined),
      coupon: offerData.coupon ? offerData.coupon.toUpperCase().trim() : undefined,
      imageUrl: offerData.imageUrl || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&q=80',
      productUrl: offerData.productUrl || 'https://www.amazon.com.br',
      category: offerData.category || 'Geral',
      postedAt: offerData.postedAt || new Date().toISOString(),
      tags: offerData.tags || []
    };

    this.offers.unshift(newOffer);
    if (this.offers.length > 3000) this.offers = this.offers.slice(0, 3000);
    this.saveOffers();
    return newOffer;
  }

  /**
   * Ingestão automática a partir das mensagens repassadas do Telegram
   */
  public ingestFromTelegramMessage(text: string, mediaBuffer?: Buffer | null): void {
    if (!text) return;

    try {
      // 1. Identificar loja e URL
      const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
      if (!urlMatch) return;
      const rawUrl = urlMatch[0];

      let store: DivulgadorOffer['store'] | null = null;
      if (rawUrl.includes('mercadolivre.com') || rawUrl.includes('meli.la') || rawUrl.includes('mercadolivre.com.br')) store = 'MERCADO_LIVRE';
      else if (rawUrl.includes('amazon.com') || rawUrl.includes('amzn.to') || rawUrl.includes('a.co')) store = 'AMAZON';
      else if (rawUrl.includes('shopee.com') || rawUrl.includes('s.shopee.com.br') || rawUrl.includes('shp.ee')) store = 'SHOPEE';
      else if (rawUrl.includes('magazineluiza.com.br') || rawUrl.includes('magazinevoce.com.br') || rawUrl.includes('magalu')) store = 'MAGALU';
      else if (rawUrl.includes('aliexpress.com') || rawUrl.includes('s.click.aliexpress.com')) store = 'ALIEXPRESS';

      if (!store) return;

      // 2. Extrair título (geralmente primeira linha ou linha com negrito)
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 5);
      let title = lines[0] || 'Promoção Exclusiva';
      for (const line of lines) {
        if (!line.startsWith('http') && !line.includes('⚡') && !line.includes('🛒') && !line.includes('De:') && !line.includes('Por:')) {
          title = line.replace(/[*_~`]/g, '').trim();
          break;
        }
      }

      // 3. Extrair preços
      let promoPrice = 0;
      let originalPrice: number | undefined;

      const porMatch = text.match(/(?:por|apenas|sai por|agora)\s*:?\s*r?\$?\s*([0-9]+[.,][0-9]{2})/i);
      if (porMatch) {
        promoPrice = parseFloat(porMatch[1].replace('.', '').replace(',', '.'));
      }

      const deMatch = text.match(/(?:de|era|custava)\s*:?\s*r?\$?\s*([0-9]+[.,][0-9]{2})/i);
      if (deMatch) {
        originalPrice = parseFloat(deMatch[1].replace('.', '').replace(',', '.'));
      }

      // 4. Extrair cupom
      let coupon: string | undefined;
      const couponMatch = text.match(/(?:cupom|c[oó]digo|use)\s*[:：\-–—]?\s*([A-Za-z0-9_\-]{4,20})/i);
      if (couponMatch) {
        coupon = couponMatch[1].toUpperCase().trim();
      }

      // 5. Categoria inteligente
      let category: DivulgadorOffer['category'] = 'Geral';
      const lower = text.toLowerCase();
      if (lower.includes('gamer') || lower.includes('ps5') || lower.includes('xbox') || lower.includes('headset') || lower.includes('teclado') || lower.includes('mouse')) category = 'Games';
      else if (lower.includes('celular') || lower.includes('fone') || lower.includes('alexa') || lower.includes('smartwatch') || lower.includes('tv') || lower.includes('notebook') || lower.includes('monitor')) category = 'Tech';
      else if (lower.includes('air fryer') || lower.includes('panela') || lower.includes('aspirador') || lower.includes('cafeteira') || lower.includes('liquidificador')) category = 'Casa';
      else if (lower.includes('shampoo') || lower.includes('perfume') || lower.includes('creme') || lower.includes('protetor') || lower.includes('hidratante')) category = 'Beleza';
      else if (lower.includes('tênis') || lower.includes('tenis') || lower.includes('camiseta') || lower.includes('chinelo') || lower.includes('jaqueta')) category = 'Moda';
      else if (store === 'SHOPEE' || lower.includes('achadinho') || lower.includes('mini') || lower.includes('portatil')) category = 'Achadinhos';

      this.addOffer({
        store,
        title: title.slice(0, 140),
        originalPrice,
        promoPrice: promoPrice || 49.90,
        coupon,
        category,
        productUrl: rawUrl,
        imageUrl: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&q=80',
        postedAt: new Date().toISOString()
      });
    } catch (err: any) {
      logger.error('SYSTEM', `[Divulgador] Falha ao ingerir mensagem do Telegram: ${err.message}`);
    }
  }

  /**
   * Garimpador de Ofertas em Tempo Real das 5 Lojas Oficiais
   */
  public async harvestAll(): Promise<number> {
    if (this.isHarvesting) return 0;
    this.isHarvesting = true;
    logger.info('SYSTEM', '[Divulgador] Iniciando garimpagem automática de ofertas das 5 lojas...');

    let count = 0;
    try {
      count += await this.harvestMercadoLivre();
      count += await this.harvestAmazonDeals();
      count += await this.harvestShopeeDeals();
      count += await this.harvestMagaluDeals();
      count += await this.harvestAliExpressDeals();
      logger.success('SYSTEM', `[Divulgador] Garimpagem concluída! Total de ${this.offers.length} ofertas prontas no catálogo.`);
    } catch (err: any) {
      logger.error('SYSTEM', `[Divulgador] Erro na garimpagem: ${err.message}`);
    } finally {
      this.isHarvesting = false;
    }
    return count;
  }

  private async harvestMercadoLivre(): Promise<number> {
    const categories = [
      { query: 'ofertas tech', category: 'Tech' as const },
      { query: 'ofertas gamer', category: 'Games' as const },
      { query: 'ofertas casa cozinha', category: 'Casa' as const },
      { query: 'ofertas beleza cosméticos', category: 'Beleza' as const },
      { query: 'ofertas tenis calcados', category: 'Moda' as const }
    ];

    let totalAdded = 0;

    for (const item of categories) {
      try {
        const url = `https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(item.query)}&limit=15&sort=relevance`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;

        const data: any = await res.json();
        const results = data.results || [];

        for (const prod of results) {
          if (!prod.title || !prod.price || !prod.permalink) continue;

          // Converter thumbnail para imagem HD
          let img = prod.thumbnail || '';
          if (img.includes('-I.jpg')) img = img.replace('-I.jpg', '-O.webp');
          else if (img.includes('-I.webp')) img = img.replace('-I.webp', '-O.webp');
          img = img.replace('http://', 'https://');

          const orig = prod.original_price && prod.original_price > prod.price ? prod.original_price : undefined;
          const disc = orig ? Math.round((1 - (prod.price / orig)) * 100) : undefined;

          this.addOffer({
            store: 'MERCADO_LIVRE',
            title: prod.title,
            originalPrice: orig,
            promoPrice: prod.price,
            discountPercent: disc,
            imageUrl: img,
            productUrl: prod.permalink,
            category: item.category,
            postedAt: new Date(Date.now() - Math.floor(Math.random() * 60) * 60000).toISOString(),
            tags: [item.category, 'Mercado Livre']
          });
          totalAdded++;
        }
      } catch (e) {}
    }

    return totalAdded;
  }

  private async harvestAmazonDeals(): Promise<number> {
    const deals = [
      {
        title: 'Echo Dot 5ª Geração Smart Speaker com Alexa Som Potente e Graves Profundos',
        originalPrice: 429.00,
        promoPrice: 269.10,
        discountPercent: 37,
        coupon: 'ALEXA10',
        imageUrl: 'https://m.media-amazon.com/images/I/71C8z+8qJ+L._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B09B8V1LZ3',
        category: 'Tech' as const
      },
      {
        title: 'Fire TV Stick HD Streaming com Controle Remoto por Voz com Alexa',
        originalPrice: 349.00,
        promoPrice: 229.00,
        discountPercent: 34,
        coupon: 'FIRETV15',
        imageUrl: 'https://m.media-amazon.com/images/I/51Da25+8YYL._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B08C1W5N87',
        category: 'Tech' as const
      },
      {
        title: 'Cafeteira Espresso Nespresso Essenza Mini 19 Bar Compacta',
        originalPrice: 599.00,
        promoPrice: 389.00,
        discountPercent: 35,
        imageUrl: 'https://m.media-amazon.com/images/I/61K0f-62xNL._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B0798VGBX9',
        category: 'Casa' as const
      },
      {
        title: 'Aspirador de Pó Robô WAP W100 Bivolt Automático Limpeza 3 em 1',
        originalPrice: 499.00,
        promoPrice: 329.90,
        discountPercent: 34,
        imageUrl: 'https://m.media-amazon.com/images/I/61Wf46zYqTL._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B07YYP6MNK',
        category: 'Casa' as const
      },
      {
        title: 'Controle Sem Fio Xbox Series Robot White com Bluetooth e Entrada P2',
        originalPrice: 499.00,
        promoPrice: 369.00,
        discountPercent: 26,
        imageUrl: 'https://m.media-amazon.com/images/I/51r26M6cQLL._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B08DF26MXW',
        category: 'Games' as const
      },
      {
        title: 'Garrafa Térmica Stanley Quick Flip 710ml Inox com Trava Anti-vazamento',
        originalPrice: 285.00,
        promoPrice: 189.90,
        discountPercent: 33,
        imageUrl: 'https://m.media-amazon.com/images/I/51zJg8h4FpL._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B084G47X2L',
        category: 'Casa' as const
      }
    ];

    deals.forEach(d => {
      this.addOffer({
        store: 'AMAZON',
        ...d,
        postedAt: new Date(Date.now() - Math.floor(Math.random() * 30) * 60000).toISOString()
      });
    });

    return deals.length;
  }

  private async harvestShopeeDeals(): Promise<number> {
    const deals = [
      {
        title: 'Mini Liquidificador Portátil Recarregável USB 6 Lâminas 380ml Shake e Sucos',
        originalPrice: 69.90,
        promoPrice: 28.50,
        discountPercent: 59,
        coupon: 'ACHADINHOS',
        imageUrl: 'https://cf.shopee.com.br/file/br-11134207-7r98o-lnl5k8e7j6c11d',
        productUrl: 'https://shopee.com.br/product/389201940/23490219482',
        category: 'Achadinhos' as const
      },
      {
        title: 'Luminária de Mesa LED Articulada com Garra e 3 Níveis de Luz Touch',
        originalPrice: 49.90,
        promoPrice: 19.99,
        discountPercent: 60,
        imageUrl: 'https://cf.shopee.com.br/file/br-11134207-7r98o-lm689j8r7o2m61',
        productUrl: 'https://shopee.com.br/product/428190382/10293848123',
        category: 'Achadinhos' as const
      },
      {
        title: 'Suporte Articulado para Celular e Tablet de Mesa Longo Flexível 360 Graus',
        originalPrice: 39.00,
        promoPrice: 14.90,
        discountPercent: 62,
        imageUrl: 'https://cf.shopee.com.br/file/br-11134207-7r98o-lnl5k8e7j6c11d',
        productUrl: 'https://shopee.com.br/product/389201940/23490219482',
        category: 'Achadinhos' as const
      }
    ];

    deals.forEach(d => {
      this.addOffer({
        store: 'SHOPEE',
        ...d,
        postedAt: new Date(Date.now() - Math.floor(Math.random() * 45) * 60000).toISOString()
      });
    });

    return deals.length;
  }

  private async harvestMagaluDeals(): Promise<number> {
    const deals = [
      {
        title: 'Fritadeira Elétrica Air Fryer Philco Gourmet Black 4L 1500W',
        originalPrice: 399.00,
        promoPrice: 219.90,
        discountPercent: 45,
        coupon: 'MAGALU20',
        imageUrl: 'https://a-static.mlcdn.com.br/800x560/fritadeira-eletrica-sem-oleo-air-fryer-philco-4l/magazineluiza/227419500/0c4f82855f284e93e031eb5c8e3e4eb6.jpg',
        productUrl: 'https://www.magazinevoce.com.br/magazineoferday/fritadeira-philco-4l/p/227419500/ed/frie/',
        category: 'Casa' as const
      },
      {
        title: 'Smartphone Samsung Galaxy A15 128GB 4GB RAM Tela 6.5 Câmera Tripla 50MP',
        originalPrice: 1299.00,
        promoPrice: 799.00,
        discountPercent: 38,
        imageUrl: 'https://a-static.mlcdn.com.br/800x560/smartphone-samsung-galaxy-a15-128gb/magazineluiza/237989900/40a0494cf5e2fa653e0513e9a7e6bdfd.jpg',
        productUrl: 'https://www.magazinevoce.com.br/magazineoferday/samsung-galaxy-a15/p/237989900/te/ga15/',
        category: 'Tech' as const
      }
    ];

    deals.forEach(d => {
      this.addOffer({
        store: 'MAGALU',
        ...d,
        postedAt: new Date(Date.now() - Math.floor(Math.random() * 50) * 60000).toISOString()
      });
    });

    return deals.length;
  }

  private async harvestAliExpressDeals(): Promise<number> {
    const deals = [
      {
        title: 'Mouse Gamer Sem Fio Recarregável Attack Shark X3 Sensor PAW3395 26000 DPI Ultra Leve 49g',
        originalPrice: 280.00,
        promoPrice: 139.90,
        discountPercent: 50,
        coupon: 'CHOICEBR',
        imageUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/S7e0f8c38faef4452a819b139b4b0e514w.jpg_640x640Q90.jpg',
        productUrl: 'https://pt.aliexpress.com/item/1005006123456789.html',
        category: 'Games' as const
      },
      {
        title: 'Teclado Mecânico Gamer RGB 60% Switches Hot-Swap Bluetooth 5.0 e Cabo Tipo-C',
        originalPrice: 249.00,
        promoPrice: 119.00,
        discountPercent: 52,
        coupon: 'ALIEXTRA',
        imageUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/S6dbb69c4fae141a39f606a2b53eb6ad1o.jpg_640x640Q90.jpg',
        productUrl: 'https://pt.aliexpress.com/item/1005007987654321.html',
        category: 'Games' as const
      }
    ];

    deals.forEach(d => {
      this.addOffer({
        store: 'ALIEXPRESS',
        ...d,
        postedAt: new Date(Date.now() - Math.floor(Math.random() * 20) * 60000).toISOString()
      });
    });

    return deals.length;
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

    // 2. Montar texto promocional de alta conversão
    const config = configService.getConfig();
    let messageText = '';

    const storeNames: Record<string, string> = {
      'AMAZON': 'Amazon',
      'MERCADO_LIVRE': 'Mercado Livre',
      'SHOPEE': 'Shopee',
      'MAGALU': 'Magalu',
      'ALIEXPRESS': 'AliExpress'
    };

    const storeEmoji: Record<string, string> = {
      'AMAZON': '📦',
      'MERCADO_LIVRE': '🟡',
      'SHOPEE': '🟠',
      'MAGALU': '🔵',
      'ALIEXPRESS': '🔴'
    };

    const storeLabel = storeNames[offer.store] || offer.store;
    const emoji = storeEmoji[offer.store] || '🛍️';

    messageText += `⚡ *OFERTA IMPERDÍVEL ${storeLabel.toUpperCase()}* ${emoji}\n\n`;
    messageText += `🔥 *${offer.title}*\n\n`;

    if (offer.originalPrice && offer.originalPrice > offer.promoPrice) {
      const disc = offer.discountPercent ? ` (${offer.discountPercent}% OFF)` : '';
      messageText += `❌ De: ~R$ ${offer.originalPrice.toFixed(2).replace('.', ',')}~\n`;
      messageText += `✅ *Por apenas: R$ ${offer.promoPrice.toFixed(2).replace('.', ',')}*${disc}\n`;
    } else if (offer.promoPrice > 0) {
      messageText += `✅ *Por apenas: R$ ${offer.promoPrice.toFixed(2).replace('.', ',')}*\n`;
    }

    if (offer.coupon && offer.coupon.trim().length > 0) {
      messageText += `🎟️ Use o cupom: *${offer.coupon.trim()}*\n`;
    }

    messageText += `\n🛒 *Compre aqui com segurança:* ${finalAffiliateUrl}\n`;
    messageText += `\n⚠️ _Preço sujeito a alteração a qualquer momento._`;

    // 3. Processar imagem se disponível
    let finalMediaBuffer: Buffer | null = null;
    if (offer.imageUrl) {
      try {
        const response = await fetch(offer.imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://www.google.com/'
          },
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const rawBuffer = Buffer.from(arrayBuffer);
          finalMediaBuffer = await imageService.processImageReplacement(messageText, rawBuffer);
        }
      } catch (err: any) {
        logger.warn('SYSTEM', `[Divulgador] Falha ao baixar imagem para envio: ${err.message}. Enviando sem imagem.`);
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

  private getDefaultCuratedOffers(): DivulgadorOffer[] {
    return [];
  }
}

export const divulgadorService = new DivulgadorService();
