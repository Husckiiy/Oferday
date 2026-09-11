import { configService } from '../config/config.service.js';

export interface TemplateData {
  title: string;
  store: string;
  storeEmoji?: string;
  originalPrice?: number;
  promoPrice: number;
  discountPercent?: number;
  coupon?: string;
  affiliateUrl: string;
  category?: string;
  customWarning?: string;
}

export interface TemplatePreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  template: string;
}

export class TemplateService {
  public readonly presets: TemplatePreset[] = [
    {
      id: 'default',
      name: 'Padrão Alta Conversão',
      description: 'Estrutura clássica com destaque de preço, desconto e link com segurança.',
      icon: 'zap',
      template: `⚡ *OFERTA IMPERDÍVEL {LOJA}* {EMOJI_LOJA}\n\n🔥 *{TITULO}*\n\n{PRECOS}\n{CUPOM}\n🛒 *Compre aqui com segurança:* {LINK}\n\n⚠️ _{AVISO}_`
    },
    {
      id: 'urgency',
      name: 'Urgência & Relâmpago',
      description: 'Focado em FOMO e ação rápida para queimar estoque.',
      icon: 'flame',
      template: `🚨 *OFERTA RELÂMPAGO NA {LOJA}!* {EMOJI_LOJA}\n\n📦 *{TITULO}*\n\n💥 {PRECOS}\n{CUPOM}\n👉 *GARANTA O SEU AQUI:* {LINK}\n\n🏃💨 _Corre antes que acabe o estoque!_`
    },
    {
      id: 'minimal',
      name: 'Minimalista & Direto',
      description: 'Mensagem curta, limpa e objetiva sem poluição visual.',
      icon: 'sparkles',
      template: `{EMOJI_LOJA} *{TITULO}*\n\n{PRECOS}\n{CUPOM}\n🔗 *Link:* {LINK}`
    },
    {
      id: 'discount_focus',
      name: 'Foco em Desconto & Economia',
      description: 'Destaque especial para a economia e o menor preço da internet.',
      icon: 'badge-percent',
      template: `🎉 *SUPER DESCONTO NA {LOJA}* {EMOJI_LOJA}\n\n✨ *{TITULO}*\n\n{PRECOS}\n{CUPOM}\n💰 *Aproveite o menor preço:* {LINK}\n\n⚠️ _{AVISO}_`
    }
  ];

  private readonly storeLabels: Record<string, string> = {
    'AMAZON': 'Amazon',
    'MERCADO_LIVRE': 'Mercado Livre',
    'SHOPEE': 'Shopee',
    'MAGALU': 'Magalu',
    'ALIEXPRESS': 'AliExpress'
  };

  private readonly storeEmojis: Record<string, string> = {
    'AMAZON': '📦',
    'MERCADO_LIVRE': '🟡',
    'SHOPEE': '🟠',
    'MAGALU': '🔵',
    'ALIEXPRESS': '🔴'
  };

  public formatCurrencyBRL(val?: number): string {
    if (typeof val !== 'number' || isNaN(val)) return '0,00';
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  public render(customTemplateStr?: string, data?: Partial<TemplateData>): string {
    const config = configService.getConfig();
    const activeTemplate = (customTemplateStr && customTemplateStr.trim().length > 0)
      ? customTemplateStr
      : (config.template?.customTemplate || this.presets[0].template);

    const storeKey = (data?.store || 'MERCADO_LIVRE').toUpperCase();
    const storeName = this.storeLabels[storeKey] || data?.store || 'Loja Parceira';
    const storeEmoji = data?.storeEmoji || this.storeEmojis[storeKey] || '🛍️';
    const title = data?.title || 'Produto em Promoção Exclusiva';
    const promoPrice = typeof data?.promoPrice === 'number' ? data.promoPrice : 89.90;
    const originalPrice = typeof data?.originalPrice === 'number' ? data.originalPrice : undefined;
    const discount = data?.discountPercent || (originalPrice && promoPrice && originalPrice > promoPrice ? Math.round((1 - (promoPrice / originalPrice)) * 100) : undefined);
    const coupon = data?.coupon ? data.coupon.toUpperCase().trim() : '';
    const link = data?.affiliateUrl || 'https://oferday.com/promocao';
    const aviso = data?.customWarning || config.template?.customWarning || 'Preço sujeito a alteração a qualquer momento.';
    const category = data?.category || 'Geral';

    // Formatar bloco de preços
    let precosBloco = '';
    if (originalPrice && originalPrice > promoPrice) {
      const discStr = discount ? ` (${discount}% OFF)` : '';
      precosBloco = `❌ De: ~R$ ${this.formatCurrencyBRL(originalPrice)}~\n✅ *Por apenas: R$ ${this.formatCurrencyBRL(promoPrice)}*${discStr}`;
    } else if (promoPrice > 0) {
      precosBloco = `✅ *Por apenas: R$ ${this.formatCurrencyBRL(promoPrice)}*`;
    }

    // Formatar bloco de cupom
    const cupomBloco = coupon ? `🎟️ Use o cupom: *${coupon}*\n` : '';
    const precoDeStr = originalPrice ? `~R$ ${this.formatCurrencyBRL(originalPrice)}~` : '';
    const precoPorStr = `*R$ ${this.formatCurrencyBRL(promoPrice)}*`;
    const descontoStr = discount ? `${discount}% OFF` : '';

    let rendered = activeTemplate;

    // Substituir tags maiúsculas e minúsculas
    const replacements: Array<[RegExp, string]> = [
      [/\{TITULO\}/gi, title],
      [/\{TITLE\}/gi, title],
      [/\{LOJA\}/gi, storeName],
      [/\{STORE\}/gi, storeName],
      [/\{EMOJI_LOJA\}/gi, storeEmoji],
      [/\{EMOJI\}/gi, storeEmoji],
      [/\{PRECOS\}/gi, precosBloco],
      [/\{PRECO_DE\}/gi, precoDeStr],
      [/\{PRECO_ANTIGO\}/gi, precoDeStr],
      [/\{PRECO_POR\}/gi, precoPorStr],
      [/\{PRECO\}/gi, precoPorStr],
      [/\{VALOR_NUMERICO\}/gi, this.formatCurrencyBRL(promoPrice)],
      [/\{DESCONTO\}/gi, descontoStr],
      [/\{CUPOM\}/gi, cupomBloco],
      [/\{CODIGO_CUPOM\}/gi, coupon],
      [/\{LINK\}/gi, link],
      [/\{LINK_AFILIADO\}/gi, link],
      [/\{AVISO\}/gi, aviso],
      [/\{CATEGORIA\}/gi, category]
    ];

    for (const [pattern, value] of replacements) {
      rendered = rendered.replace(pattern, value);
    }

    // Limpar linhas vazias excessivas
    return rendered.replace(/\n{3,}/g, '\n\n').trim();
  }
}

export const templateService = new TemplateService();
