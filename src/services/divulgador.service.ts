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

class DivulgadorService {
  private offersFile = path.resolve(process.cwd(), 'data', 'divulgador_offers.json');
  private offers: DivulgadorOffer[] = [];

  constructor() {
    this.loadOffers();
  }

  private loadOffers(): void {
    try {
      if (fs.existsSync(this.offersFile)) {
        const raw = fs.readFileSync(this.offersFile, 'utf-8');
        this.offers = JSON.parse(raw);
      } else {
        this.offers = this.getDefaultCuratedOffers();
        this.saveOffers();
      }
    } catch (err: any) {
      logger.error('DIVULGADOR', `Erro ao carregar ofertas: ${err.message}`);
      this.offers = this.getDefaultCuratedOffers();
    }
  }

  private saveOffers(): void {
    try {
      const dir = path.dirname(this.offersFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.offersFile, JSON.stringify(this.offers, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error('DIVULGADOR', `Erro ao salvar ofertas: ${err.message}`);
    }
  }

  public getOffers(filters?: { store?: string; category?: string; search?: string }): DivulgadorOffer[] {
    let result = [...this.offers];

    if (filters?.store && filters.store !== 'ALL') {
      result = result.filter(o => o.store.toUpperCase() === filters.store?.toUpperCase());
    }

    if (filters?.category && filters.category !== 'ALL') {
      result = result.filter(o => o.category.toLowerCase() === filters.category?.toLowerCase());
    }

    if (filters?.search && filters.search.trim().length > 0) {
      const q = filters.search.toLowerCase().trim();
      result = result.filter(o =>
        o.title.toLowerCase().includes(q) ||
        o.store.toLowerCase().includes(q) ||
        o.category.toLowerCase().includes(q) ||
        (o.coupon && o.coupon.toLowerCase().includes(q))
      );
    }

    return result;
  }

  public getOfferById(id: string): DivulgadorOffer | undefined {
    return this.offers.find(o => o.id === id);
  }

  public addOffer(offerData: Partial<DivulgadorOffer>): DivulgadorOffer {
    const newOffer: DivulgadorOffer = {
      id: offerData.id || crypto.randomUUID().slice(0, 8),
      store: (offerData.store as any) || 'AMAZON',
      title: offerData.title || 'Oferta Especial',
      originalPrice: offerData.originalPrice,
      promoPrice: offerData.promoPrice || 0,
      discountPercent: offerData.discountPercent || (offerData.originalPrice && offerData.promoPrice ? Math.round((1 - (offerData.promoPrice / offerData.originalPrice)) * 100) : undefined),
      coupon: offerData.coupon,
      imageUrl: offerData.imageUrl || 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=600&q=80',
      productUrl: offerData.productUrl || 'https://www.amazon.com.br',
      category: offerData.category || 'Geral',
      postedAt: offerData.postedAt || new Date().toISOString(),
      tags: offerData.tags || []
    };

    this.offers.unshift(newOffer);
    if (this.offers.length > 200) this.offers = this.offers.slice(0, 200);
    this.saveOffers();
    return newOffer;
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

    logger.info('DIVULGADOR', `Iniciando disparo da oferta: ${offer.title} (${offer.store})`);

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
        const response = await fetch(offer.imageUrl, { signal: AbortSignal.timeout(10000) });
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const rawBuffer = Buffer.from(arrayBuffer);
          finalMediaBuffer = await imageService.processImageReplacement(messageText, rawBuffer);
        }
      } catch (err: any) {
        logger.warn('DIVULGADOR', `Falha ao baixar imagem: ${err.message}. Enviando sem imagem.`);
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
        logger.success('DIVULGADOR', `Oferta enviada para o WhatsApp (${destinationJid}) com sucesso!`);
      } catch (err: any) {
        logger.error('DIVULGADOR', `Erro ao enviar para WhatsApp: ${err.message}`);
      }
    } else {
      logger.warn('DIVULGADOR', 'WhatsApp não está conectado ou destino não configurado.');
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
    return [
      {
        id: 'amz-echo-pop',
        store: 'AMAZON',
        title: 'Echo Pop Smart Speaker compacto com Alexa e som envolvente',
        originalPrice: 349.00,
        promoPrice: 197.10,
        discountPercent: 43,
        coupon: 'ALEXA10',
        imageUrl: 'https://m.media-amazon.com/images/I/61zC8C+tC0L._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B09ZX5967T',
        category: 'Tech',
        postedAt: new Date(Date.now() - 3 * 60000).toISOString(),
        tags: ['Alexa', 'Som', 'Smart Home']
      },
      {
        id: 'amz-kindle-11',
        store: 'AMAZON',
        title: 'Kindle 11ª Geração Tela de 6 polegadas alta resolução 300 ppi',
        originalPrice: 499.00,
        promoPrice: 399.00,
        discountPercent: 20,
        imageUrl: 'https://m.media-amazon.com/images/I/71B1wlw-O5L._AC_SX679_.jpg',
        productUrl: 'https://www.amazon.com.br/dp/B09SWW583J',
        category: 'Tech',
        postedAt: new Date(Date.now() - 12 * 60000).toISOString(),
        tags: ['Kindle', 'Livros', 'E-reader']
      },
      {
        id: 'ml-airfryer-mondial',
        store: 'MERCADO_LIVRE',
        title: 'Fritadeira Sem Óleo Air Fryer Mondial 4L Inox Prata 1500W',
        originalPrice: 389.90,
        promoPrice: 229.00,
        discountPercent: 41,
        coupon: 'CUPOMCASA20',
        imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_2X_897148-MLA74805727404_032024-F.webp',
        productUrl: 'https://www.mercadolivre.com.br/fritadeira-eletrica-sem-oleo-air-fryer-mondial-family-inox-4l-afn-40-ri-pretoinox-127v/p/MLB19688402',
        category: 'Casa',
        postedAt: new Date(Date.now() - 8 * 60000).toISOString(),
        tags: ['Cozinha', 'Airfryer', 'Mondial']
      },
      {
        id: 'ml-headset-gamer',
        store: 'MERCADO_LIVRE',
        title: 'Headset Gamer Redragon Zeus X RGB Som Surround 7.1 Almofadas Memory Foam',
        originalPrice: 359.00,
        promoPrice: 249.90,
        discountPercent: 30,
        imageUrl: 'https://http2.mlstatic.com/D_NQ_NP_2X_616904-MLA48485295240_122021-F.webp',
        productUrl: 'https://www.mercadolivre.com.br/headset-gamer-redragon-zeus-x-rgb-usb-71-preto-h510-rgb/p/MLB18596645',
        category: 'Games',
        postedAt: new Date(Date.now() - 25 * 60000).toISOString(),
        tags: ['Gamer', 'Headset', 'RGB']
      },
      {
        id: 'shopee-mini-compressor',
        store: 'SHOPEE',
        title: 'Mini Compressor de Ar Portátil Digital para Carro Moto e Bicicleta Bateria Recarregável',
        originalPrice: 129.90,
        promoPrice: 59.90,
        discountPercent: 54,
        coupon: 'ACHADINHOS',
        imageUrl: 'https://cf.shopee.com.br/file/br-11134207-7r98o-lnl5k8e7j6c11d',
        productUrl: 'https://shopee.com.br/product/389201940/23490219482',
        category: 'Achadinhos',
        postedAt: new Date(Date.now() - 5 * 60000).toISOString(),
        tags: ['Automotivo', 'Achadinhos', 'Ferramentas']
      },
      {
        id: 'shopee-ring-light',
        store: 'SHOPEE',
        title: 'Kit Ring Light LED 26cm com Tripé Profissional 2,10m e Suporte para Celular',
        originalPrice: 89.00,
        promoPrice: 34.99,
        discountPercent: 61,
        imageUrl: 'https://cf.shopee.com.br/file/br-11134207-7r98o-lm689j8r7o2m61',
        productUrl: 'https://shopee.com.br/product/428190382/10293848123',
        category: 'Achadinhos',
        postedAt: new Date(Date.now() - 40 * 60000).toISOString(),
        tags: ['Foto', 'TikTok', 'Iluminação']
      },
      {
        id: 'magalu-smart-tv',
        store: 'MAGALU',
        title: 'Smart TV 43 polegadas Full HD LED Wi-Fi HDR 2 HDMI 1 USB',
        originalPrice: 1899.00,
        promoPrice: 1299.00,
        discountPercent: 31,
        coupon: 'MAGALU100',
        imageUrl: 'https://a-static.mlcdn.com.br/800x560/smart-tv-43-full-hd-led-com-wi-fi-hdr/magazineluiza/235848200/4c44c53c07ea86d944c57c1cba579cb7.jpg',
        productUrl: 'https://www.magazinevoce.com.br/magazineoferday/smart-tv-43-full-hd-led/p/235848200/et/tved/',
        category: 'Tech',
        postedAt: new Date(Date.now() - 15 * 60000).toISOString(),
        tags: ['TV', 'Smart TV', 'Cinema']
      },
      {
        id: 'magalu-panela-pressao',
        store: 'MAGALU',
        title: 'Panela de Pressão Elétrica Digital 5L Timer e Trava de Segurança',
        originalPrice: 489.00,
        promoPrice: 299.90,
        discountPercent: 38,
        imageUrl: 'https://a-static.mlcdn.com.br/800x560/panela-de-pressao-eletrica-digital-5l/magazineluiza/225678400/22904b7b2571cb14b09b52a1ba363675.jpg',
        productUrl: 'https://www.magazinevoce.com.br/magazineoferday/panela-pressao-eletrica-5l/p/225678400/ed/pree/',
        category: 'Casa',
        postedAt: new Date(Date.now() - 55 * 60000).toISOString(),
        tags: ['Cozinha', 'Eletroportáteis']
      },
      {
        id: 'ali-fone-lenovo',
        store: 'ALIEXPRESS',
        title: 'Fone de Ouvido Bluetooth Lenovo LP40 Pro TWS Sem Fio Baixa Latência',
        originalPrice: 120.00,
        promoPrice: 42.50,
        discountPercent: 64,
        coupon: 'CHOICEBR',
        imageUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/S7e0f8c38faef4452a819b139b4b0e514w.jpg_640x640Q90.jpg',
        productUrl: 'https://pt.aliexpress.com/item/1005004561234567.html',
        category: 'Tech',
        postedAt: new Date(Date.now() - 10 * 60000).toISOString(),
        tags: ['Fone', 'Lenovo', 'Bluetooth']
      },
      {
        id: 'ali-relogio-smartwatch',
        store: 'ALIEXPRESS',
        title: 'Smartwatch Ultra 9 Tela AMOLED 2.1 Polegadas Monitor Cardíaco e Chamadas Bluetooth',
        originalPrice: 199.00,
        promoPrice: 78.90,
        discountPercent: 60,
        coupon: 'ALIEXTRA',
        imageUrl: 'https://ae-pic-a1.aliexpress-media.com/kf/S6dbb69c4fae141a39f606a2b53eb6ad1o.jpg_640x640Q90.jpg',
        productUrl: 'https://pt.aliexpress.com/item/1005005891234567.html',
        category: 'Tech',
        postedAt: new Date(Date.now() - 30 * 60000).toISOString(),
        tags: ['Smartwatch', 'Relógio', 'Fitness']
      }
    ];
  }
}

export const divulgadorService = new DivulgadorService();
