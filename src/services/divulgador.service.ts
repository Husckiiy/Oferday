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

  // Lista dos maiores canais públicos de garimpo de ofertas do Brasil
  private promoChannels = [
    'Promos_tech1',
    'EconomizandocomJP',
    'jptechofertasgerais',
    'PortalDOSsachadinhos',
    'achadoshopeeoficial',
    'gatry',
    'promosdashopee',
    'canaldescontos'
  ];

  constructor() {
    this.loadOffers();
    // Executar garimpo inicial e agendar a cada 15 minutos
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

    // Evitar duplicidade por URL
    const cleanUrl = offerData.productUrl.split('?')[0].toLowerCase();
    const existingIndex = this.offers.findIndex(o => o.productUrl && o.productUrl.split('?')[0].toLowerCase() === cleanUrl);
    
    const newOffer: DivulgadorOffer = {
      id: offerData.id || crypto.randomUUID().slice(0, 8),
      store: (offerData.store as any) || 'AMAZON',
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
    this.saveOffers();
    return newOffer;
  }

  public ingestFromTelegramMessage(text: string, mediaBuffer?: Buffer | null): void {
    if (!text || text.length < 15) return;
    try {
      const urlMatches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
      if (urlMatches.length === 0) return;

      let store: DivulgadorOffer['store'] | null = null;
      let targetUrl = '';
      for (const link of urlMatches) {
        const lower = link.toLowerCase();
        if (lower.includes('mercadolivre.com') || lower.includes('meli.la')) { store = 'MERCADO_LIVRE'; targetUrl = link; break; }
        else if (lower.includes('amazon.com') || lower.includes('amzn.to') || lower.includes('a.co')) { store = 'AMAZON'; targetUrl = link; break; }
        else if (lower.includes('shopee.com') || lower.includes('s.shopee.com') || lower.includes('shp.ee')) { store = 'SHOPEE'; targetUrl = link; break; }
        else if (lower.includes('magazineluiza.com') || lower.includes('magazinevoce.com') || lower.includes('magalu')) { store = 'MAGALU'; targetUrl = link; break; }
        else if (lower.includes('aliexpress.com') || lower.includes('s.click.aliexpress.com')) { store = 'ALIEXPRESS'; targetUrl = link; break; }
      }

      if (!store || !targetUrl) return;

      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
      let title = lines[0] || 'Promoção Exclusiva';
      for (const l of lines) {
        if (!l.startsWith('http') && !l.includes('⚡') && !l.includes('🛒') && !l.toLowerCase().includes('compre aqui')) {
          title = l.replace(/[*_~`]/g, '').trim();
          break;
        }
      }

      let promoPrice = 0;
      let originalPrice: number | undefined;
      const porMatch = text.match(/(?:por|apenas|sai por|agora)\s*:?\s*r?\$?\s*([0-9]+[.,][0-9]{2})/i);
      if (porMatch) promoPrice = parseFloat(porMatch[1].replace('.', '').replace(',', '.'));
      const deMatch = text.match(/(?:de|era|custava)\s*:?\s*r?\$?\s*([0-9]+[.,][0-9]{2})/i);
      if (deMatch) originalPrice = parseFloat(deMatch[1].replace('.', '').replace(',', '.'));

      this.addOffer({
        store,
        title: title.slice(0, 140),
        originalPrice,
        promoPrice: promoPrice || 49.90,
        productUrl: targetUrl,
        category: 'Geral',
        postedAt: new Date().toISOString()
      });
    } catch {}
  }

  /**
   * Garimpador em Tempo Real de Todos os Canais Públicos de Ofertas
   */
  public async harvestAll(): Promise<number> {
    if (this.isHarvesting) return 0;
    this.isHarvesting = true;
    logger.info('SYSTEM', `[Divulgador] Iniciando garimpagem em tempo real de ${this.promoChannels.length} fontes de promoções...`);

    let totalHarvested = 0;

    for (const channel of this.promoChannels) {
      try {
        const added = await this.harvestTelegramChannel(channel);
        totalHarvested += added;
      } catch (err: any) {
        logger.warn('SYSTEM', `[Divulgador] Erro ao garimpar canal ${channel}: ${err.message}`);
      }
    }

    this.saveOffers();
    logger.success('SYSTEM', `[Divulgador] Garimpagem concluída! ${totalHarvested} novas ofertas adicionadas. Catálogo total: ${this.offers.length} promoções ativas.`);
    this.isHarvesting = false;
    return totalHarvested;
  }

  /**
   * Extrai ofertas completas com foto HD, preços, cupons e links oficiais do feed público do Telegram
   */
  private async harvestTelegramChannel(channelName: string): Promise<number> {
    const url = `https://t.me/s/${channelName}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return 0;
    const html = await response.text();

    // Regex para capturar cada widget de mensagem individual
    const messageBlocks = html.split('<div class="tgme_widget_message_wrap');
    let addedCount = 0;

    for (let i = 1; i < messageBlocks.length; i++) {
      const block = messageBlocks[i];

      // 1. Extrair texto
      const textMatch = block.match(/<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/);
      if (!textMatch) continue;
      
      let rawText = textMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$1 $2')
        .replace(/<[^>]+>/g, '')
        .trim();

      if (rawText.length < 20) continue;

      // 2. Extrair URLs
      const urlMatches = rawText.match(/https?:\/\/[^\s"'<>]+/gi) || [];
      if (urlMatches.length === 0) continue;

      // Identificar loja suportada
      let store: DivulgadorOffer['store'] | null = null;
      let targetProductUrl = '';

      for (const link of urlMatches) {
        const lower = link.toLowerCase();
        if (lower.includes('mercadolivre.com') || lower.includes('meli.la')) {
          store = 'MERCADO_LIVRE';
          targetProductUrl = link;
          break;
        } else if (lower.includes('amazon.com') || lower.includes('amzn.to') || lower.includes('a.co')) {
          store = 'AMAZON';
          targetProductUrl = link;
          break;
        } else if (lower.includes('shopee.com') || lower.includes('s.shopee.com') || lower.includes('shp.ee')) {
          store = 'SHOPEE';
          targetProductUrl = link;
          break;
        } else if (lower.includes('magazineluiza.com') || lower.includes('magazinevoce.com') || lower.includes('magalu')) {
          store = 'MAGALU';
          targetProductUrl = link;
          break;
        } else if (lower.includes('aliexpress.com') || lower.includes('s.click.aliexpress.com')) {
          store = 'ALIEXPRESS';
          targetProductUrl = link;
          break;
        }
      }

      if (!store || !targetProductUrl) continue;

      // 3. Extrair imagem HD pública do Telegram
      let imageUrl = '';
      const photoMatch = block.match(/background-image:url\('([^']+)'\)/i);
      if (photoMatch && photoMatch[1] && photoMatch[1].startsWith('http')) {
        imageUrl = photoMatch[1];
      }

      // 4. Extrair título
      const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 3);
      let title = lines[0] || 'Promoção Exclusiva';
      for (const l of lines) {
        if (!l.startsWith('http') && !l.includes('⚡') && !l.includes('🛒') && !l.toLowerCase().includes('compre aqui') && !l.toLowerCase().includes('link')) {
          title = l.replace(/[*_~`]/g, '').trim();
          break;
        }
      }

      // 5. Extrair preços (De / Por)
      let promoPrice = 0;
      let originalPrice: number | undefined;

      const porMatch = rawText.match(/(?:por|apenas|sai por|agora|valor|preço)\s*:?\s*r?\$?\s*([0-9]+[.,][0-9]{2})/i);
      if (porMatch) {
        promoPrice = parseFloat(porMatch[1].replace('.', '').replace(',', '.'));
      }

      const deMatch = rawText.match(/(?:de|era|custava)\s*:?\s*r?\$?\s*([0-9]+[.,][0-9]{2})/i);
      if (deMatch) {
        originalPrice = parseFloat(deMatch[1].replace('.', '').replace(',', '.'));
      }

      if (!promoPrice) {
        const anyMoney = rawText.match(/r\$\s*([0-9]+[.,][0-9]{2})/i);
        if (anyMoney) promoPrice = parseFloat(anyMoney[1].replace('.', '').replace(',', '.'));
      }

      // 6. Extrair Cupom
      let coupon: string | undefined;
      const couponMatch = rawText.match(/(?:cupom|c[oó]digo|use)\s*[:：\-–—]?\s*([A-Za-z0-9_\-]{4,20})/i);
      if (couponMatch) {
        const potential = couponMatch[1].toUpperCase().trim();
        if (!['HTTPS', 'HTTP', 'MERCADO', 'SHOPEE', 'AMAZON', 'MAGALU', 'PRODUTO'].includes(potential)) {
          coupon = potential;
        }
      }

      // 7. Categoria
      let category: DivulgadorOffer['category'] = 'Geral';
      const textLower = rawText.toLowerCase();
      if (textLower.includes('gamer') || textLower.includes('headset') || textLower.includes('teclado') || textLower.includes('mouse') || textLower.includes('ps5') || textLower.includes('xbox')) category = 'Games';
      else if (textLower.includes('celular') || textLower.includes('fone') || textLower.includes('alexa') || textLower.includes('tv') || textLower.includes('smartwatch') || textLower.includes('notebook') || textLower.includes('monitor')) category = 'Tech';
      else if (textLower.includes('air fryer') || textLower.includes('panela') || textLower.includes('aspirador') || textLower.includes('cafeteira') || textLower.includes('ferro')) category = 'Casa';
      else if (textLower.includes('shampoo') || textLower.includes('perfume') || textLower.includes('creme') || textLower.includes('protetor') || textLower.includes('skincare')) category = 'Beleza';
      else if (textLower.includes('tênis') || textLower.includes('tenis') || textLower.includes('camisa') || textLower.includes('chinelo') || textLower.includes('calça')) category = 'Moda';
      else if (store === 'SHOPEE' || textLower.includes('achadinho') || textLower.includes('portátil') || textLower.includes('mini')) category = 'Achadinhos';

      const created = this.addOffer({
        store,
        title: title.slice(0, 150),
        originalPrice: originalPrice && originalPrice > promoPrice ? originalPrice : undefined,
        promoPrice: promoPrice || 49.90,
        coupon,
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&q=80',
        productUrl: targetProductUrl,
        category,
        postedAt: new Date().toISOString()
      });

      if (created) addedCount++;
    }

    return addedCount;
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

    // 3. Processar e baixar imagem diretamente da fonte
    let finalMediaBuffer: Buffer | null = null;
    if (offer.imageUrl && !offer.imageUrl.includes('photo-1526170375885-4d8ecf77b99f')) {
      try {
        const response = await fetch(offer.imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
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
