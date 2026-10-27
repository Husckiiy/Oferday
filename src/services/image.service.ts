import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import { logger } from './logger.service.js';
import { configService } from '../config/config.service.js';

const BANNERS_DIR = path.resolve(process.cwd(), 'data', 'banners');
const ASSETS_BANNERS_DIR = path.resolve(process.cwd(), 'assets', 'banners');

export interface CachedImageReference {
  path: string;
  sha256: string;
  md5: string;
  dHashBinary: string;
  dHashHex: string;
  pixelBuffer: Buffer | null;
}

export interface BannerRule {
  id: string;
  name: string;
  theme: 'YELLOW_ML' | 'BLUE_MAGALU' | 'ORANGE_SHOPEE' | 'BLACK_ORANGE_AMAZON' | 'OTHER';
  keywords: string[];
  cleanImagePath: string;
  referenceImages: string[];
  cachedRefs?: CachedImageReference[];
}

class ImageService {
  private rules: BannerRule[] = [];
  private initialized = false;

  constructor() {
    this.ensureBannersDir();
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.initDefaultRules();
  }

  public async reload(): Promise<void> {
    this.initialized = false;
    await this.initDefaultRules();
  }

  public getBannerStatus(): { ml: boolean; magalu: boolean; shopee: boolean; amazon: boolean; mlPreview?: string; magaluPreview?: string; shopeePreview?: string; amazonPreview?: string } {
    const mlPath = path.join(BANNERS_DIR, 'alerta_cupons_ml_limpo.jpg');
    const magaluPath = path.join(BANNERS_DIR, 'alerta_cupons_magalu_limpo.jpg');
    const shopeePath = path.join(BANNERS_DIR, 'alerta_cupons_shopee_limpo.jpg');
    const amazonPath = path.join(BANNERS_DIR, 'alerta_cupons_amazon_limpo.jpg');

    const mlFallback = path.join(ASSETS_BANNERS_DIR, 'alerta_cupons_ml_limpo.jpg');
    const magaluFallback = path.join(ASSETS_BANNERS_DIR, 'alerta_cupons_magalu_limpo.jpg');
    const shopeeFallback = path.join(ASSETS_BANNERS_DIR, 'alerta_cupons_shopee_limpo.jpg');
    const amazonFallback = path.join(ASSETS_BANNERS_DIR, 'alerta_cupons_amazon_limpo.jpg');

    let mlPreview: string | undefined;
    let magaluPreview: string | undefined;
    let shopeePreview: string | undefined;
    let amazonPreview: string | undefined;

    const actualMl = fs.existsSync(mlPath) ? mlPath : (fs.existsSync(mlFallback) ? mlFallback : null);
    const actualMagalu = fs.existsSync(magaluPath) ? magaluPath : (fs.existsSync(magaluFallback) ? magaluFallback : null);
    const actualShopee = fs.existsSync(shopeePath) ? shopeePath : (fs.existsSync(shopeeFallback) ? shopeeFallback : null);
    const actualAmazon = fs.existsSync(amazonPath) ? amazonPath : (fs.existsSync(amazonFallback) ? amazonFallback : null);

    if (actualMl) {
      try {
        mlPreview = `data:image/jpeg;base64,${fs.readFileSync(actualMl).toString('base64')}`;
      } catch {}
    }
    if (actualMagalu) {
      try {
        magaluPreview = `data:image/jpeg;base64,${fs.readFileSync(actualMagalu).toString('base64')}`;
      } catch {}
    }
    if (actualShopee) {
      try {
        shopeePreview = `data:image/jpeg;base64,${fs.readFileSync(actualShopee).toString('base64')}`;
      } catch {}
    }
    if (actualAmazon) {
      try {
        amazonPreview = `data:image/jpeg;base64,${fs.readFileSync(actualAmazon).toString('base64')}`;
      } catch {}
    }

    return {
      ml: !!actualMl,
      magalu: !!actualMagalu,
      shopee: !!actualShopee,
      amazon: !!actualAmazon,
      mlPreview,
      magaluPreview,
      shopeePreview,
      amazonPreview
    };
  }

  private ensureBannersDir(): void {
    if (!fs.existsSync(BANNERS_DIR)) {
      fs.mkdirSync(BANNERS_DIR, { recursive: true });
    }
    // Sincroniza banners padrão da pasta assets para data/banners (evita perda no volume do Railway)
    if (fs.existsSync(ASSETS_BANNERS_DIR)) {
      try {
        const files = fs.readdirSync(ASSETS_BANNERS_DIR);
        for (const file of files) {
          const target = path.join(BANNERS_DIR, file);
          if (!fs.existsSync(target)) {
            fs.copyFileSync(path.join(ASSETS_BANNERS_DIR, file), target);
            logger.info('IMAGE', `Banner padrão copiado para data/banners: ${file}`);
          }
        }
      } catch (err: any) {
        logger.warn('IMAGE', `Aviso ao sincronizar banners padrão: ${err.message}`);
      }
    }
  }

  /**
   * Detects the dominant background color theme from the banner image corners
   */
  public async detectColorTheme(buffer: Buffer): Promise<'YELLOW_ML' | 'BLUE_MAGALU' | 'ORANGE_SHOPEE' | 'UNKNOWN'> {
    try {
      const { data, info } = await sharp(buffer)
        .resize(50, 50, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const channels = info.channels || 3;
      let yellowVotes = 0;
      let blueVotes = 0;
      let orangeVotes = 0;

      // Sample 16 key background points (corners, top/bottom borders, inner margins)
      const samplePoints = [
        [5, 5], [25, 5], [45, 5],
        [5, 25], [45, 25],
        [5, 45], [25, 45], [45, 45],
        [2, 2], [48, 2], [2, 48], [48, 48],
        [10, 10], [40, 10], [10, 40], [40, 40]
      ];

      for (const [x, y] of samplePoints) {
        const idx = (y * 50 + x) * channels;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        // Yellow (Mercado Livre): High Red + Green, Low Blue
        if (r > 150 && g > 130 && b < 100) {
          yellowVotes++;
        }
        // Orange (Shopee): High Red, Medium Green, Low Blue
        else if (r > 170 && g >= 40 && g <= 140 && b < 90) {
          orangeVotes++;
        }
        // Blue (Magalu): High Blue, Low Red
        else if (b > 130 && r < 130) {
          blueVotes++;
        }
      }

      if (yellowVotes >= 4) {
        return 'YELLOW_ML';
      }
      if (orangeVotes >= 4) {
        return 'ORANGE_SHOPEE';
      }
      if (blueVotes >= 4) {
        return 'BLUE_MAGALU';
      }

      return 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  /**
   * Computes Perceptual Difference Hash (dHash) 64-bit binary and hex
   */
  public async computeDHash(buffer: Buffer): Promise<{ binary: string; hex: string } | null> {
    try {
      const raw = await sharp(buffer)
        .resize(9, 8, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();

      let binary = '';
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
          const left = raw[row * 9 + col];
          const right = raw[row * 9 + col + 1];
          binary += left > right ? '1' : '0';
        }
      }

      let hex = '';
      for (let i = 0; i < 64; i += 4) {
        hex += parseInt(binary.substring(i, i + 4), 2).toString(16);
      }

      return { binary, hex };
    } catch {
      return null;
    }
  }

  /**
   * Computes normalized 32x32 grayscale pixel buffer for structural comparison
   */
  public async getNormalizedPixels(buffer: Buffer): Promise<Buffer | null> {
    try {
      return await sharp(buffer)
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();
    } catch {
      return null;
    }
  }

  public calculateSimilarity(buf1: Buffer, buf2: Buffer): number {
    if (buf1.length !== buf2.length) return 0;
    let diff = 0;
    for (let i = 0; i < buf1.length; i++) {
      diff += Math.abs(buf1[i] - buf2[i]);
    }
    const maxDiff = 255 * buf1.length;
    return (1 - diff / maxDiff) * 100;
  }

  public hammingDistance(bin1: string, bin2: string): number {
    if (bin1.length !== bin2.length) return 64;
    let diff = 0;
    for (let i = 0; i < bin1.length; i++) {
      if (bin1[i] !== bin2[i]) diff++;
    }
    return diff;
  }

  private async processReferenceImage(filePath: string): Promise<CachedImageReference | null> {
    let resolvedPath = filePath;
    if (!fs.existsSync(resolvedPath)) {
      const fallback = path.join(ASSETS_BANNERS_DIR, path.basename(filePath));
      if (fs.existsSync(fallback)) {
        resolvedPath = fallback;
      } else {
        return null;
      }
    }
    try {
      const buf = fs.readFileSync(resolvedPath);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const md5 = crypto.createHash('md5').update(buf).digest('hex');
      const dHash = await this.computeDHash(buf);
      const pixelBuffer = await this.getNormalizedPixels(buf);

      if (!dHash) return null;

      return {
        path: resolvedPath,
        sha256,
        md5,
        dHashBinary: dHash.binary,
        dHashHex: dHash.hex,
        pixelBuffer
      };
    } catch (err: any) {
      logger.error('IMAGE', `Erro ao indexar imagem de referência (${resolvedPath}): ${err.message}`);
      return null;
    }
  }

  private async initDefaultRules(): Promise<void> {
    const mlClean = path.join(BANNERS_DIR, 'alerta_cupons_ml_limpo.jpg');
    const mlComp = path.join(BANNERS_DIR, 'alerta_cupons_ml_concorrente.png');
    const mlComp2 = path.join(BANNERS_DIR, 'ref_competitor_meli_ticket.png');

    const magaluClean = path.join(BANNERS_DIR, 'alerta_cupons_magalu_limpo.jpg');
    const magaluComp = path.join(BANNERS_DIR, 'alerta_cupons_magalu_concorrente.png');

    const shopeeClean = path.join(BANNERS_DIR, 'alerta_cupons_shopee_limpo.jpg');
    const shopeeComp = path.join(BANNERS_DIR, 'ref_competitor_shopee_dia_cupons.png');

    const amazonClean = path.join(BANNERS_DIR, 'alerta_cupons_amazon_limpo.jpg');
    const amazonComp = path.join(BANNERS_DIR, 'alerta_cupons_amazon_concorrente.png');
    const amazonComp2 = path.join(BANNERS_DIR, 'ref_competitor_amazon_blue.png');

    this.rules = [
      {
        id: 'ml_coupon_alert',
        name: 'Alerta de Cupons Mercado Livre',
        theme: 'YELLOW_ML',
        keywords: [
          'alerta de cupom',
          'alerta de cupons',
          'cupom mercado livre',
          'cupons mercado livre',
          'economizandocomjp',
          'alerta cupom',
          'novo cupom de desconto',
          'cupom de desconto no mercado livre',
          'desconto no mercado livre',
          'salve seu cupom',
          'novo cupom',
          'ativou',
          'resgatou na conta',
          'para quem resgatou na conta',
          'produtos full',
          'valido em produtos',
          'cupom ativo',
          'cupons ativos',
          'cupons full',
          'livrosejogos',
          'full1110'
        ],
        cleanImagePath: mlClean,
        referenceImages: [mlComp, mlComp2, mlClean]
      },
      {
        id: 'magalu_coupon_alert',
        name: 'Alerta de Cupons Magalu',
        theme: 'BLUE_MAGALU',
        keywords: [
          'alerta de cupons magalu',
          'cupons magalu',
          'cupom magalu',
          'alerta magalu',
          'magazine luiza cupom',
          'cupons magazine luiza',
          'cupom magazine',
          'desconto no magalu',
          'cupom de desconto no magalu',
          'novo cupom de desconto no magalu',
          'salve seu cupom magalu',
          'economizandocomjp',
          'resgate seu cupom magalu',
          'cupom ativo magalu'
        ],
        cleanImagePath: magaluClean,
        referenceImages: [magaluComp, magaluClean]
      },
      {
        id: 'shopee_coupon_alert',
        name: 'Alerta de Cupons Shopee',
        theme: 'ORANGE_SHOPEE',
        keywords: [
          'alerta de cupons shopee',
          'alerta de cupom shopee',
          'cupons shopee',
          'cupom shopee',
          'cupom de desconto na shopee',
          'cupom de desconto shopee',
          'cupons de desconto na shopee',
          'cupons de desconto shopee',
          'dia de cupons',
          'dia de cupons shopee',
          'evento dia de cupons',
          'evento de cupons',
          'alerta shopee',
          'cupons na shopee',
          'cupom na shopee',
          'desconto na shopee',
          'resgate seu cupom shopee',
          'cupom ativo shopee',
          'novo cupom shopee',
          'salve seu cupom shopee',
          'moedas shopee'
        ],
        cleanImagePath: shopeeClean,
        referenceImages: [shopeeComp, shopeeClean]
      },
      {
        id: 'amazon_coupon_alert',
        name: 'Alerta de Cupons Amazon',
        theme: 'BLACK_ORANGE_AMAZON',
        keywords: [
          'cupom amazon',
          'cupons amazon',
          'alerta amazon',
          'alerta de cupom amazon',
          'alerta de cupons amazon',
          'desconto na amazon',
          'desconto amazon',
          'cupom de desconto amazon',
          'cupom de desconto na amazon',
          'cupom de desconto: 20offamazon',
          'cupom de desconto: 10offamazon',
          'domingo10',
          'novo cupom amazon',
          'cupons ativos amazon',
          'cupom ativo amazon',
          'prime day',
          'mega oferta amazon',
          'válido no site quase todo',
          'valido no site quase todo',
          'válido no site todo',
          'valido no site todo'
        ],
        cleanImagePath: amazonClean,
        referenceImages: [amazonComp, amazonComp2, amazonClean]
      }
    ];

    for (const rule of this.rules) {
      rule.cachedRefs = [];
      for (const refPath of rule.referenceImages) {
        const refObj = await this.processReferenceImage(refPath);
        if (refObj) {
          rule.cachedRefs.push(refObj);
          logger.info('IMAGE', `Banner indexado [${rule.name}]: dHash=${refObj.dHashHex}, MD5=${refObj.md5}`);
        }
      }
    }

    this.initialized = true;
  }

  /**
   * Checks if text contains explicit general coupon alert headlines (e.g. "Alerta de Cupons", "Cupom Amazon")
   */
  public isCouponAlertText(lowerText: string): boolean {
    if (!lowerText) return false;
    const explicitAlertPhrases = [
      'alerta de cupom',
      'alerta de cupons',
      'alerta cupom',
      'alerta cupons',
      'cupom amazon',
      'cupons amazon',
      'alerta amazon',
      'cupom de desconto amazon',
      'cupom de desconto na amazon',
      'cupom mercado livre',
      'cupons mercado livre',
      'cupom de desconto no mercado livre',
      'cupom de desconto mercado livre',
      'cupons no mercado livre',
      'cupom magalu',
      'cupons magalu',
      'cupom magazine luiza',
      'cupom de desconto no magalu',
      'cupom de desconto magalu',
      'cupom shopee',
      'cupons shopee',
      'cupons na shopee',
      'cupom na shopee',
      'cupom de desconto na shopee',
      'cupom de desconto shopee',
      'cupons de desconto na shopee',
      'cupons de desconto shopee',
      'lista de cupons',
      'central de cupons',
      'cupons disponíveis',
      'cupons ativos',
      'novos cupons liberados',
      'novo cupom liberado',
      'válido no site quase todo',
      'valido no site quase todo',
      'válido no site todo',
      'valido no site todo',
      'para quem resgatou na conta',
      'resgatou na conta',
      'dia de cupons',
      'dia de cupom',
      'evento dia de cupons',
      'evento de cupons',
      'evento de cupom',
      'festival de cupons',
      'semana de cupons',
      'maratona de cupons',
      'chuva de cupons'
    ];

    if (explicitAlertPhrases.some(kw => lowerText.includes(kw))) {
      return true;
    }

    // Any store coupon alert headline e.g. "CUPOM DE DESCONTO NA SHOPEE", "CUPOM DE DESCONTO NO MERCADO LIVRE"
    if (/\bcupo[mn]s?\s+(?:de\s+desconto\s+)?(?:na|no|para\s+a?)?\s*(?:shopee|amazon|mercado\s*livre|magalu|aliexpress)\b/i.test(lowerText)) {
      return true;
    }

    // Pattern matching e.g. "R$30 OFF em R$299" or "R$90 OFF em R$899"
    if (/\br\$\s*\d+\s*off\s+(?:em|acima|a\s+partir)\b/i.test(lowerText) && (lowerText.includes('cupom') || lowerText.includes('cupon') || lowerText.includes('shopee') || lowerText.includes('resgate') || lowerText.includes('amazon') || lowerText.includes('mercado'))) {
      return true;
    }

    // Pattern matching e.g. "15% OFF...: LIVROSEJOGOS" or "10% OFF a partir de R$ 30, Limite de R$ 15 OFF: DOMINGO10"
    if (/\b\d+%\s*off\b.*:\s*[a-z0-9_]+/i.test(lowerText) && (lowerText.includes('cupom') || lowerText.includes('limite') || lowerText.includes('válido') || lowerText.includes('valido'))) {
      return true;
    }

    return false;
  }

  /**
   * Identifies if a message is a specific product offer (e.g. has product link, price, specs)
   * so that product photos are NEVER replaced by coupon alert banners.
   */
  public isSpecificProductOffer(text: string, affResults?: any[]): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();

    const productRegex = /(?:MLB-?\d+|\/p\/[a-zA-Z0-9]+|\/up\/[a-zA-Z0-9]+|\/dp\/[a-zA-Z0-9]{10}|-i\.\d+\.\d+|\/product\/\d+\/\d+|\/opaanlp\/\d+\/\d+|\/universal-link\/\d+\/\d+|\/item\/\d+|\/produto\/\d+|sku=\d+|codigo_produto=\d+)/i;
    const hasProductMarker = /link\s*(?:do\s*produto)?\s*:\s*https?:\/\//i.test(text);

    const isCouponTierLine = /\br\$\s*\d+\s*off\s+(?:em|acima|a\s+partir)/i.test(lower);
    const hasDirectProductSalePrice = (
      /(?:por\s+apenas|de\s*:?\s*r\$\s*\d+.*por\s*:?\s*r\$\s*\d+|por\s*:?\s*r\$\s*\d+)/i.test(lower) ||
      (/(?:^|\n)\s*(?:🔥|⚡|💥|💰|💸)?\s*(?:por\s*:?\s*)?r\$\s*\d+(?:[.,]\d+)?\s*(?:no\s+pix|no\s+boleto|no\s+cart[aã]o|à\s+vista)?\s*(?:$|\n)/im.test(text) && !isCouponTierLine)
    );

    // 0. If it is detected as a coupon announcement:
    // It can ONLY be a product offer if it has an explicit canonical product URL (MLB, ASIN, Shopee item ID, etc.)
    // OR direct product sale price ("Por apenas R$...", "🔥 R$ 3757", etc.)
    if (this.isCouponAlertText(lower)) {
      const hasProductLink = affResults?.some(r => {
        const u = r.canonicalProductUrl || r.finalResolvedUrl || r.originalUrl;
        return u && !this.isGenericNonProductUrl(u) && productRegex.test(u);
      }) || (hasProductMarker && productRegex.test(text));

      if (!hasProductLink && !hasDirectProductSalePrice && !hasProductMarker) {
        return false;
      }
    }

    // 1. If any affiliate result has a canonical product ID (MLB, ASIN, SKU, Shopee product ID)
    if (affResults && affResults.length > 0) {
      const hasSpecificProduct = affResults.some(r => {
        const url = r.canonicalProductUrl || r.finalResolvedUrl || r.originalUrl;
        if (!url) return false;
        if (this.isGenericNonProductUrl(url)) return false;
        return productRegex.test(url);
      });
      if (hasSpecificProduct) return true;
    }

    // 2. Check price indicators (e.g. "POR: 699", "POR R$", "R$ 1.754", "A PARTIR DE R$", "699 REAIS", "1754 REAIS", "10x de R$")
    const hasPrice = hasDirectProductSalePrice || (/(?:por\s*:?\s*(?:r\$\s*)?\d+|\br\$\s*\d+(?:[.,]\d+)?|\b\d+\s*reais\b|\bem\s*at[eé]\s*\d+x|\b\d+x\s*de\s*(?:r\$\s*)?\d+)/i.test(lower) && !isCouponTierLine);

    // 3. Check product link patterns (e.g. /p/, /dp/, /item/, -i., /produto/, sku=)
    const hasProductUrl = productRegex.test(text);

    // 4. If it has a price or product URL or explicit product link marker
    if (hasPrice || hasProductUrl || hasProductMarker) {
      const isPureCouponHeadline = /^(?:🚨|⚡️|💥|🔥)?\s*(?:alerta\s+de\s+cupom|alerta\s+de\s+cupons|novos?\s+cupons?|central\s+de\s+cupons|lista\s+de\s+cupons|cupom\s+de\s+desconto|cupons\s+de\s+desconto)/i.test(lower.trim());
      const hasCouponConditionOnly = /em\s+compras\s+a\s+partir\s+de\s+r\$|limite\s+de\s+r\$/i.test(lower);

      if (isPureCouponHeadline && !hasProductUrl && !hasProductMarker && (hasCouponConditionOnly || isCouponTierLine)) {
        return false;
      }
      return true;
    }

    return false;
  }

  public detectStoreFromCouponText(lowerText: string, storeHint?: string): 'MERCADO_LIVRE' | 'MAGALU' | 'SHOPEE' | 'AMAZON' {
    if (storeHint === 'AMAZON' || lowerText.includes('amazon') || lowerText.includes('amzn.to') || lowerText.includes('link.amazon') || lowerText.includes('prime')) {
      return 'AMAZON';
    }
    if (storeHint === 'SHOPEE' || lowerText.includes('shopee') || lowerText.includes('shp.ee')) {
      return 'SHOPEE';
    }
    if (storeHint === 'MAGALU' || lowerText.includes('magalu') || lowerText.includes('magazine luiza') || lowerText.includes('magazinevoce')) {
      return 'MAGALU';
    }
    return 'MERCADO_LIVRE';
  }

  public readCleanBannerFile(cleanPath: string): Buffer | null {
    if (fs.existsSync(cleanPath)) {
      return fs.readFileSync(cleanPath);
    }
    const fallback = path.join(ASSETS_BANNERS_DIR, path.basename(cleanPath));
    if (fs.existsSync(fallback)) {
      return fs.readFileSync(fallback);
    }
    return null;
  }

  public async getCleanBannerForStore(store: 'MERCADO_LIVRE' | 'MAGALU' | 'SHOPEE' | 'AMAZON' | string): Promise<Buffer | null> {
    let filename = 'alerta_cupons_ml_limpo.jpg';
    if (store === 'AMAZON' || store.includes('amazon')) {
      filename = 'alerta_cupons_amazon_limpo.jpg';
    } else if (store === 'MAGALU' || store.includes('magalu')) {
      filename = 'alerta_cupons_magalu_limpo.jpg';
    } else if (store === 'SHOPEE' || store.includes('shopee')) {
      filename = 'alerta_cupons_shopee_limpo.jpg';
    }
    return this.readCleanBannerFile(path.join(BANNERS_DIR, filename));
  }

  /**
   * Checks if a URL is a generic landing page, coupon hub, or showcase rather than a single specific product.
   */
  public isGenericNonProductUrl(url: string): boolean {
    if (!url) return true;
    const lower = url.toLowerCase();
    return (
      lower.includes('/cupons') ||
      lower.includes('/cupom') ||
      lower.includes('/selecao/') ||
      lower.includes('/campanha/') ||
      lower.includes('/hotsite/') ||
      lower.includes('/ofertas') ||
      lower.includes('/landing/') ||
      lower.includes('/gz/promocoes') ||
      lower.includes('amazon.com.br/b?') ||
      lower.includes('amazon.com.br/b/') ||
      lower.includes('amazon.com.br/deals') ||
      lower.includes('amazon.com.br/gp/coupons') ||
      lower.includes('shopee.com.br/m/') ||
      lower.includes('shopee.com.br/events') ||
      lower.includes('/m/cupom') ||
      lower.includes('best.aliexpress.com')
    );
  }

  /**
   * Process image replacement strictly for coupon alerts (Perceptual dHash, Exact Hash, Theme, and Keywords).
   * Replaces competitor coupon banners (or text-only coupon alerts) with clean official banners.
   * NEVER replaces specific product offer photos with a coupon banner.
   */
  public async processImageReplacement(
    text: string,
    originalBuffer: Buffer | null,
    storeHint?: string,
    affResults?: any[]
  ): Promise<Buffer | null> {
    if (!this.initialized) {
      await this.initDefaultRules();
    }

    const lowerText = (text || '').toLowerCase();
    const isProduct = this.isSpecificProductOffer(text, affResults);
    const isCouponAlert = this.isCouponAlertText(lowerText);

    // 1. If this is a specific product offer, NEVER replace with a coupon banner unless
    // the incoming buffer has a strict exact match with a competitor coupon banner graphic.
    if (isProduct) {
      if (originalBuffer && originalBuffer.length > 0) {
        const inSha256 = crypto.createHash('sha256').update(originalBuffer).digest('hex');
        const inMd5 = crypto.createHash('md5').update(originalBuffer).digest('hex');
        const inDHash = await this.computeDHash(originalBuffer);

        if (inDHash) {
          for (const rule of this.rules) {
            if (rule.cachedRefs && rule.cachedRefs.length > 0) {
              for (const ref of rule.cachedRefs) {
                // Strict match only (Exact hash or dHash distance <= 8)
                if (inSha256 === ref.sha256 || inMd5 === ref.md5) {
                  const cleanBuffer = this.readCleanBannerFile(rule.cleanImagePath);
                  if (cleanBuffer) return cleanBuffer;
                }
                if (ref.dHashBinary && this.hammingDistance(inDHash.binary, ref.dHashBinary) <= 8) {
                  const cleanBuffer = this.readCleanBannerFile(rule.cleanImagePath);
                  if (cleanBuffer) return cleanBuffer;
                }
              }
            }
          }
        }
      }
      // Keep product image
      return originalBuffer;
    }

    // 2. If it's a generic announcement (NOT a specific product):
    if (originalBuffer && originalBuffer.length > 0) {
      const inSha256 = crypto.createHash('sha256').update(originalBuffer).digest('hex');
      const inMd5 = crypto.createHash('md5').update(originalBuffer).digest('hex');
      const inDHash = await this.computeDHash(originalBuffer);
      const colorTheme = await this.detectColorTheme(originalBuffer);
      const detectedStore = this.detectStoreFromCouponText(lowerText, storeHint);

      for (const rule of this.rules) {
        let isMatch = false;
        let matchReason = '';

        const isRuleForDetectedStore = (rule.id === 'amazon_coupon_alert' && detectedStore === 'AMAZON') ||
                                       (rule.id === 'ml_coupon_alert' && detectedStore === 'MERCADO_LIVRE') ||
                                       (rule.id === 'magalu_coupon_alert' && detectedStore === 'MAGALU') ||
                                       (rule.id === 'shopee_coupon_alert' && detectedStore === 'SHOPEE');

        // Check reference images (hashes and perceptual dHash)
        if (rule.cachedRefs && rule.cachedRefs.length > 0 && inDHash) {
          for (const ref of rule.cachedRefs) {
            if (inSha256 === ref.sha256 || inMd5 === ref.md5) {
              isMatch = true;
              matchReason = `Hash exato idêntico (MD5: ${inMd5})`;
              break;
            }

            const dist = this.hammingDistance(inDHash.binary, ref.dHashBinary);
            if (dist <= 16) {
              const hashMatchPct = (((64 - dist) / 64) * 100).toFixed(1);
              isMatch = true;
              matchReason = `Perceptual dHash (${hashMatchPct}% precisão, dist ${dist}/64)`;
              break;
            }
          }
        }

        // Match coupon announcement
        if (!isMatch && isCouponAlert) {
          if (isRuleForDetectedStore) {
            isMatch = true;
            matchReason = `Alerta geral de cupom para loja [${detectedStore}]`;
          } else if (colorTheme === rule.theme && (!storeHint || storeHint === 'UNKNOWN') && !lowerText.includes('amazon') && !lowerText.includes('shopee') && !lowerText.includes('magalu')) {
            isMatch = true;
            matchReason = `Alerta de cupom + tema de cores ${colorTheme}`;
          }
        }

        if (isMatch) {
          const cleanBuffer = this.readCleanBannerFile(rule.cleanImagePath);
          if (cleanBuffer) {
            logger.success('IMAGE', `🎯 Regra de banner acionada [${rule.name}] via ${matchReason}! Imagem substituída pelo banner oficial limpo.`);
            return cleanBuffer;
          }
        }
      }
    }

    // 3. Text-only coupon announcement (without any media)
    if (isCouponAlert && (!originalBuffer || originalBuffer.length === 0)) {
      const detectedStore = this.detectStoreFromCouponText(lowerText, storeHint);
      const cleanBuffer = await this.getCleanBannerForStore(detectedStore);
      if (cleanBuffer) {
        logger.success('IMAGE', `🎯 Alerta geral de cupom detectado para [${detectedStore}]! Banner oficial limpo carregado.`);
        return cleanBuffer;
      }
    }

    return originalBuffer;
  }

  /**
   * Extracts a clean product title from post text for catalog / store search
   */
  public extractProductTitleFromText(text?: string): string {
    if (!text) return '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      const lower = line.toLowerCase();
      // Skip greetings, urls, prices, coupons (singular cupom or plural cupons), announcements, events
      if (
        line.startsWith('http') ||
        lower.includes('cupom') ||
        lower.includes('cupon') ||
        lower.includes('resgate') ||
        lower.includes('corre') ||
        lower.includes('evento') ||
        lower.includes('alerta') ||
        lower.includes('aviso') ||
        lower.includes('desconto') ||
        lower.includes('anuncio') ||
        lower.includes('anúncio') ||
        lower.includes('dia de') ||
        lower.includes('semana de') ||
        lower.includes('compre aqui') ||
        lower.includes('link') ||
        /\b(?:off|off\s+em|em\s+r\$|acima\s+de)\b/i.test(lower) ||
        line.includes('🎟️') ||
        line.includes('🎫')
      ) {
        continue;
      }
      const cleaned = line
        .replace(/^[🚨🔥💥⚡️📦⭐🛒📢🎟️🎫\s\-_*]+/, '')
        .replace(/[🚨🔥💥⚡️📦⭐🛒📢🎟️🎫\s\-_*]+$/, '')
        .replace(/R\$\s*\d+(?:[.,]\d+)?/gi, '')
        .replace(/\b\d+%\s*off\b/gi, '')
        .replace(/\b\d+\s*off\b/gi, '')
        .replace(/\boff\b/gi, '')
        .replace(/por\s+apenas/gi, '')
        .replace(/de:\s*/gi, '')
        .replace(/por:\s*/gi, '')
        .trim();

      if (cleaned.length >= 8 && !cleaned.startsWith('http') && /[a-zA-Z]{3,}/.test(cleaned)) {
        if (cleaned.length <= 70) return cleaned;
        const truncated = cleaned.substring(0, 70);
        const lastSpace = truncated.lastIndexOf(' ');
        return lastSpace > 20 ? truncated.substring(0, lastSpace).trim() : truncated.trim();
      }
    }
    return '';
  }

  /**
   * Fetches official product image directly from Shopee Affiliate GraphQL API by keyword/title
   */
  public async fetchShopeeImageViaGraphQL(keyword: string): Promise<Buffer | null> {
    if (!keyword || keyword.length < 3) return null;
    const config = configService.getConfig();
    const appId = config.affiliate?.shopeeAppId || process.env.SHOPEE_APP_ID || '18378190901';
    const secret = config.affiliate?.shopeeAppSecret || process.env.SHOPEE_APP_SECRET || 'ITHJMNNGTV4JOSEZLT27UZ3TY7ICCC6L';

    if (!appId || !secret) return null;

    const executeGraphqlQuery = async (queryKeyword: string): Promise<Buffer | null> => {
      try {
        const cleanKeyword = queryKeyword.replace(/[\\"\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!cleanKeyword || cleanKeyword.length < 3) return null;

        const timestamp = Math.floor(Date.now() / 1000);
        const bodyStr = JSON.stringify({
          query: `{
            productOfferV2(keyword: "${cleanKeyword}", page: 1, limit: 1) {
              nodes {
                imageUrl
                productName
              }
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
          signal: AbortSignal.timeout(7000)
        });

        if (resp.ok) {
          const data: any = await resp.json();
          const firstNode = data?.data?.productOfferV2?.nodes?.[0];
          const imageUrl = firstNode?.imageUrl;
          if (imageUrl && imageUrl.startsWith('http')) {
            const imgResp = await fetch(imageUrl, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              signal: AbortSignal.timeout(6000)
            });
            if (imgResp.ok) {
              const buf = Buffer.from(await imgResp.arrayBuffer());
              if (buf.length > 3000) {
                const jpegBuf = await sharp(buf).jpeg({ quality: 95 }).toBuffer();
                logger.success('IMAGE', `✨ Imagem oficial HD extraída da API Shopee GraphQL ("${firstNode?.productName?.substring(0, 40) || cleanKeyword}") - 100% limpa sem marcas!`);
                return jpegBuf;
              }
            }
          }
        }
      } catch (err: any) {
        logger.warn('IMAGE', `Aviso ao buscar imagem Shopee via GraphQL ("${queryKeyword}"): ${err.message}`);
      }
      return null;
    };

    // 1. Try full extracted title
    const directResult = await executeGraphqlQuery(keyword);
    if (directResult) return directResult;

    // 2. Fallback: split words and try the first 5 core words (e.g. "Jogo De Panelas 10 Peças")
    const words = keyword.replace(/[^\w\s\u00C0-\u017F]/gi, ' ').split(/\s+/).filter(w => w.length > 1);
    if (words.length > 4) {
      const shortKw = words.slice(0, 5).join(' ');
      const shortResult = await executeGraphqlQuery(shortKw);
      if (shortResult) return shortResult;
    }

    // 3. Fallback: try first 3 core words if words > 3
    if (words.length > 3) {
      const miniKw = words.slice(0, 3).join(' ');
      const miniResult = await executeGraphqlQuery(miniKw);
      if (miniResult) return miniResult;
    }

    return null;
  }

  /**
   * Fetches official, high-resolution, watermark-free product image directly from the store.
   * Prioritizes canonical product URLs and filters out generic campaign / coupon pages.
   */
  public async fetchOfficialStoreImage(affResults: any[], postText?: string): Promise<Buffer | null> {
    if (!affResults || affResults.length === 0) return null;

    for (const res of affResults) {
      if (!res || !res.store || res.store === 'UNKNOWN') continue;

      // Candidate URLs to inspect: canonical product URL FIRST, then resolved, then original
      const candidateUrls: string[] = Array.from(new Set([
        res.canonicalProductUrl,
        res.finalResolvedUrl,
        res.originalUrl
      ].filter(Boolean)));

      for (const targetUrl of candidateUrls) {
        // Skip generic coupon/landing/campaign pages so we don't grab random items
        if (this.isGenericNonProductUrl(targetUrl)) {
          continue;
        }

        try {
          // 1. Mercado Livre
          if (res.store === 'MERCADO_LIVRE') {
            const mlbMatch = targetUrl.match(/(MLB-?\d+)/i);
            if (mlbMatch) {
              const mlbId = mlbMatch[1].replace('-', '').toUpperCase();
              try {
                const apiRes = await fetch(`https://api.mercadolibre.com/items/${mlbId}`, {
                  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                  signal: AbortSignal.timeout(4000)
                });
                if (apiRes.ok) {
                  const data: any = await apiRes.json();
                  const picUrl = data.pictures?.[0]?.secure_url || data.pictures?.[0]?.url || data.thumbnail;
                  if (picUrl) {
                    const hdUrl = picUrl.replace(/-[I|V|O]\.(jpg|jpeg|png|webp)/i, '-F.$1').replace(/-[I|V]\.(jpg|jpeg|png|webp)/i, '-O.$1');
                    const imgRes = await fetch(hdUrl || picUrl, { signal: AbortSignal.timeout(6000) });
                    if (imgRes.ok) {
                      const buf = Buffer.from(await imgRes.arrayBuffer());
                      if (buf.length > 3000) {
                        const jpegBuf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
                        logger.success('IMAGE', `✨ Imagem oficial HD extraída da API do Mercado Livre (${mlbId}) - 100% limpa sem marcas!`);
                        return jpegBuf;
                      }
                    }
                  }
                }
              } catch {}
            }

            const scraped = await this.scrapeOgImageFromUrl(targetUrl);
            if (scraped) {
              logger.success('IMAGE', `✨ Imagem oficial extraída do Mercado Livre (${targetUrl}) - 100% limpa sem marcas!`);
              return scraped;
            }
          }

          // 2. Amazon
          if (res.store === 'AMAZON') {
            const asinMatch = targetUrl.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})/i) ||
                              targetUrl.match(/\/([A-Z0-9]{10})(?:[/?]|$)/i);
            if (asinMatch) {
              const asin = asinMatch[1].toUpperCase();
              try {
                const cdnUrls = [
                  `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX1500_.jpg`,
                  `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX1000_.jpg`,
                  `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX800_.jpg`,
                  `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`
                ];
                for (const cdnUrl of cdnUrls) {
                  const imgRes = await fetch(cdnUrl, { signal: AbortSignal.timeout(5000) });
                  if (imgRes.ok) {
                    const buf = Buffer.from(await imgRes.arrayBuffer());
                    if (buf.length > 3000) {
                      const jpegBuf = await sharp(buf).jpeg({ quality: 95 }).toBuffer();
                      logger.success('IMAGE', `✨ Imagem oficial HD extraída da Amazon CDN (${asin}) - 100% limpa sem marcas!`);
                      return jpegBuf;
                    }
                  }
                }
              } catch {}
            }

            const lookupUrl = asinMatch ? `https://www.amazon.com.br/dp/${asinMatch[1]}` : targetUrl;
            const scraped = await this.scrapeOgImageFromUrl(lookupUrl);
            if (scraped) {
              logger.success('IMAGE', `✨ Imagem oficial extraída da Amazon (${targetUrl}) - 100% limpa sem marcas!`);
              return scraped;
            }
          }

          // 3. Shopee
          if (res.store === 'SHOPEE') {
            const scraped = await this.scrapeOgImageFromUrl(targetUrl);
            if (scraped) {
              logger.success('IMAGE', `✨ Imagem oficial extraída da Shopee (${targetUrl}) - 100% limpa sem marcas!`);
              return scraped;
            }

            if (postText) {
              const prodTitle = this.extractProductTitleFromText(postText);
              if (prodTitle) {
                const graphqlImg = await this.fetchShopeeImageViaGraphQL(prodTitle);
                if (graphqlImg) {
                  return graphqlImg;
                }
              }
            }
          }

          // 4. Magalu
          if (res.store === 'MAGALU') {
            const scraped = await this.scrapeOgImageFromUrl(targetUrl);
            if (scraped) {
              logger.success('IMAGE', `✨ Imagem oficial extraída do Magalu (${targetUrl}) - 100% limpa sem marcas!`);
              return scraped;
            }
          }

          // 5. AliExpress / KaBuM / Awin / Outras
          const scraped = await this.scrapeOgImageFromUrl(targetUrl);
          if (scraped) {
            logger.success('IMAGE', `✨ Imagem oficial extraída da loja (${res.store}) - 100% limpa sem marcas!`);
            return scraped;
          }
        } catch (err: any) {
          logger.warn('IMAGE', `Aviso ao buscar imagem da loja (${res.store} / ${targetUrl}): ${err.message}`);
        }
      }
    }

    return null;
  }

  /**
   * Scrapes Open Graph og:image or high-res product image from HTML and converts to JPEG
   */
  private async scrapeOgImageFromUrl(url: string): Promise<Buffer | null> {
    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
      };

      if (url.includes('amazon')) {
        const config = configService.getConfig();
        const cookie = config.affiliate?.amazonCookie || '';
        if (cookie) {
          headers['Cookie'] = cookie.replace(/x-amz-captcha-[12]=[^;]+;?\s*/gi, '').trim();
        }
      }

      const resp = await fetch(url, {
        redirect: 'follow',
        headers,
        signal: AbortSignal.timeout(7000)
      });
      if (!resp.ok) return null;

      const html = await resp.text();
      let imageUrl: string | null = null;
      const ogMatch = html.match(/<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)[\"']/i) ||
                      html.match(/<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:image[\"']/i) ||
                      html.match(/<meta[^>]+name=[\"']twitter:image[\"'][^>]+content=[\"']([^\"']+)[\"']/i);

      if (ogMatch && ogMatch[1] && !ogMatch[1].includes('default-avatar') && !ogMatch[1].includes('amazon_logo')) {
        imageUrl = ogMatch[1].trim();
      }

      if (!imageUrl && (url.includes('amazon') || html.includes('amazon'))) {
        const dynamicMatch = html.match(/data-a-dynamic-image=[\"']\{&quot;([^&]+)&quot;/i) ||
                             html.match(/\"hiRes\"\s*:\s*\"([^\"]+)\"/i) ||
                             html.match(/\"large\"\s*:\s*\"([^\"]+)\"/i) ||
                             html.match(/data-old-hires=[\"']([^\"']+)[\"']/i) ||
                             html.match(/https:\/\/m\.media-amazon\.com\/images\/I\/[A-Za-z0-9%_\-+]+\.(?:jpg|jpeg|png)/i);
        if (dynamicMatch && dynamicMatch[1]) {
          imageUrl = dynamicMatch[1].replace(/\\/g, '');
        } else if (dynamicMatch && dynamicMatch[0]) {
          imageUrl = dynamicMatch[0];
        }
      }

      if (!imageUrl && (url.includes('kabum.com.br') || html.includes('kabum.com.br'))) {
        const kabumMatch = html.match(/https:\/\/images\d*\.kabum\.com\.br\/produtos\/fotos\/[^\s"']+/i);
        if (kabumMatch && kabumMatch[0]) {
          imageUrl = kabumMatch[0];
        }
      }

      if (imageUrl && imageUrl.startsWith('http')) {
        // 1. Mercado Livre HD
        if (imageUrl.includes('mlstatic.com')) {
          imageUrl = imageUrl.replace(/-[I|V|O]\.(jpg|jpeg|png|webp)/i, '-O.$1');
        }
        // 2. Magalu HD (replace thumbnail dimensions like 470x352 with 1000x1000)
        if (imageUrl.includes('mlcdn.com.br')) {
          imageUrl = imageUrl.replace(/\/\d+x\d+\//, '/1000x1000/');
        }
        // 3. Shopee HD
        if (imageUrl.includes('shopee') || imageUrl.includes('shp.ee')) {
          imageUrl = imageUrl.replace(/_tn(\.[a-z0-9]+)$/i, '$1').replace(/_\d+x\d+(\.[a-z0-9]+)$/i, '$1');
        }
        // 4. AliExpress HD
        if (imageUrl.includes('alicdn.com')) {
          imageUrl = imageUrl.replace(/_\d+x\d+\.(jpg|jpeg|png|webp)/i, '');
        }
        // 5. Amazon media-amazon HD (upgrade to 1500px resolution)
        if (imageUrl.includes('media-amazon.com')) {
          imageUrl = imageUrl.replace(/\._[A-Z0-9_,]+_\./i, '._AC_SL1500_.');
        }
        // 6. KaBuM HD (search HTML for _gg.jpg or _g.jpg high-res photo)
        if (imageUrl.includes('kabum.com.br')) {
          const ggMatch = html.match(/https:\/\/images\d*\.kabum\.com\.br\/produtos\/fotos\/[^\s"']+?_gg\.jpg/i) ||
                          html.match(/https:\/\/images\d*\.kabum\.com\.br\/produtos\/fotos\/[^\s"']+?_g\.jpg/i);
          if (ggMatch && ggMatch[0]) {
            imageUrl = ggMatch[0];
          }
        }

        let imgResp = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Referer': resp.url || url
          },
          signal: AbortSignal.timeout(6000)
        }).catch(() => null);

        // Fallback to original og:image if upgraded CDN URL returned 404
        if ((!imgResp || !imgResp.ok) && ogMatch && ogMatch[1] && ogMatch[1] !== imageUrl) {
          imageUrl = ogMatch[1].trim();
          imgResp = await fetch(imageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
              'Referer': resp.url || url
            },
            signal: AbortSignal.timeout(6000)
          }).catch(() => null);
        }

        if (imgResp && imgResp.ok) {
          const rawBuf = Buffer.from(await imgResp.arrayBuffer());
          if (rawBuf.length > 3000) {
            const jpegBuf = await sharp(rawBuf).jpeg({ quality: 95 }).toBuffer();
            return jpegBuf;
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Normalizes an image to a standard 1:1 square canvas (1000x1000) with clean white background.
   * Prevents WhatsApp mobile from zooming in, cropping edges, or distorting landscape/portrait product photos.
   */
  public async normalizeToSquareCanvas(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const meta = await sharp(imageBuffer).metadata();
      const w = meta.width || 800;
      const h = meta.height || 800;
      const aspectRatio = w / h;

      // If it's already approximately square (0.95 to 1.05) and high resolution, return intact
      if (aspectRatio >= 0.95 && aspectRatio <= 1.05 && w >= 800) {
        return imageBuffer;
      }

      const targetDim = Math.max(1000, Math.max(w, h));

      return await sharp(imageBuffer)
        .resize(targetDim, targetDim, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .jpeg({ quality: 95 })
        .toBuffer();
    } catch (err: any) {
      logger.warn('IMAGE', `Aviso ao normalizar canvas da imagem para 1:1: ${err.message}`);
      return imageBuffer;
    }
  }

  /**
   * Intelligently detects and erases competitor watermark tags, stickers, and badges
   * (e.g. "PROMOS TECH", "JP TECH", "ECONOMIZANDO COM JP", price tags) in corners of product photos.
   * Uses connected-component spatial analysis and fills the watermark region seamlessly with surrounding background.
   */
  public async removeCompetitorWatermarks(imageBuffer: Buffer): Promise<Buffer> {
    try {
      const { data, info } = await sharp(imageBuffer).raw().toBuffer({ resolveWithObject: true });
      const width = info.width, height = info.height, channels = info.channels || 3;

      // 1. Detect background color by sampling margins
      let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
      for (let x = 12; x < width - 12; x += 6) {
        for (const y of [12, 24, height - 24, height - 12]) {
          const idx = (y * width + x) * channels;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          if (r > 195 && g > 195 && b > 195) {
            bgR += r; bgG += g; bgB += b; bgCount++;
          }
        }
      }

      if (bgCount < 20) {
        bgR = 255; bgG = 255; bgB = 255;
      } else {
        bgR = Math.round(bgR / bgCount);
        bgG = Math.round(bgG / bgCount);
        bgB = Math.round(bgB / bgCount);
      }

      const isBg = (r: number, g: number, b: number) => {
        const diff = Math.sqrt(Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2));
        return diff < 30 || (r > 235 && g > 235 && b > 235);
      };

      // 2. Downsample for ultra-fast connected-component labeling
      const scale = 2;
      const sw = Math.floor(width / scale);
      const sh = Math.floor(height / scale);

      const grid = new Uint8Array(sw * sh);
      for (let sy = 0; sy < sh; sy++) {
        for (let sx = 0; sx < sw; sx++) {
          const origX = sx * scale;
          const origY = sy * scale;
          const idx = (origY * width + origX) * channels;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          if (!isBg(r, g, b)) {
            grid[sy * sw + sx] = 1;
          }
        }
      }

      const visited = new Uint8Array(sw * sh);
      const components: Array<{ size: number; minX: number; maxX: number; minY: number; maxY: number; width: number; height: number }> = [];

      for (let sy = 0; sy < sh; sy++) {
        for (let sx = 0; sx < sw; sx++) {
          const idx = sy * sw + sx;
          if (grid[idx] === 1 && visited[idx] === 0) {
            let minX = sx, maxX = sx, minY = sy, maxY = sy, size = 0;
            const queue = [idx];
            visited[idx] = 1;

            while (queue.length > 0) {
              const curr = queue.pop()!;
              size++;
              const cy = Math.floor(curr / sw);
              const cx = curr % sw;

              if (cx < minX) minX = cx;
              if (cx > maxX) maxX = cx;
              if (cy < minY) minY = cy;
              if (cy > maxY) maxY = cy;

              const neighbors = [
                cy > 0 ? (cy - 1) * sw + cx : -1,
                cy < sh - 1 ? (cy + 1) * sw + cx : -1,
                cx > 0 ? cy * sw + (cx - 1) : -1,
                cx < sw - 1 ? cy * sw + (cx + 1) : -1
              ];

              for (const n of neighbors) {
                if (n >= 0 && grid[n] === 1 && visited[n] === 0) {
                  visited[n] = 1;
                  queue.push(n);
                }
              }
            }

            components.push({
              size,
              minX: minX * scale,
              maxX: Math.min(width - 1, (maxX + 1) * scale),
              minY: minY * scale,
              maxY: Math.min(height - 1, (maxY + 1) * scale),
              width: (maxX - minX + 1) * scale,
              height: (maxY - minY + 1) * scale
            });
          }
        }
      }

      // Sort components descending by size
      components.sort((a, b) => b.size - a.size);
      if (components.length <= 1) return imageBuffer;

      const outData = Buffer.from(data);
      let erasedCount = 0;

      for (const c of components) {
        if (c.size > 4000 || c.size < 40) continue; // Skip large product body or tiny single specks
        if (c.width > width * 0.45 || c.height > height * 0.45) continue; // Skip main elements

        const centerX = (c.minX + c.maxX) / 2;
        const centerY = (c.minY + c.maxY) / 2;

        const isCornerX = centerX < width * 0.40 || centerX > width * 0.60;
        const isCornerY = centerY < height * 0.40 || centerY > height * 0.60;

        if (isCornerX && isCornerY) {
          logger.info('IMAGE', `🧹 Marca d'água concorrente detectada: [X:${c.minX}..${c.maxX}, Y:${c.minY}..${c.maxY}] (${c.width}x${c.height}px). Removendo...`);

          // Sample local background surrounding this watermark tag
          let localBgR = bgR, localBgG = bgG, localBgB = bgB;
          let lCount = 0;
          const pad = 6;
          const sampleBoxMinX = Math.max(0, c.minX - pad - 8);
          const sampleBoxMaxX = Math.min(width - 1, c.maxX + pad + 8);
          const sampleBoxMinY = Math.max(0, c.minY - pad - 8);
          const sampleBoxMaxY = Math.min(height - 1, c.maxY + pad + 8);

          for (let y = sampleBoxMinY; y <= sampleBoxMaxY; y += 2) {
            for (let x = sampleBoxMinX; x <= sampleBoxMaxX; x += 2) {
              if (x < c.minX - pad || x > c.maxX + pad || y < c.minY - pad || y > c.maxY + pad) {
                const idx = (y * width + x) * channels;
                const r = data[idx], g = data[idx + 1], b = data[idx + 2];
                if (r > 195 && g > 195 && b > 195) {
                  localBgR += r; localBgG += g; localBgB += b; lCount++;
                }
              }
            }
          }
          if (lCount > 0) {
            localBgR = Math.round(localBgR / lCount);
            localBgG = Math.round(localBgG / lCount);
            localBgB = Math.round(localBgB / lCount);
          }

          // Erase the competitor watermark badge with the local background color
          const fillMinX = Math.max(0, c.minX - pad);
          const fillMaxX = Math.min(width - 1, c.maxX + pad);
          const fillMinY = Math.max(0, c.minY - pad);
          const fillMaxY = Math.min(height - 1, c.maxY + pad);

          for (let y = fillMinY; y <= fillMaxY; y++) {
            for (let x = fillMinX; x <= fillMaxX; x++) {
              const idx = (y * width + x) * channels;
              outData[idx] = localBgR;
              outData[idx + 1] = localBgG;
              outData[idx + 2] = localBgB;
            }
          }
          erasedCount++;
        }
      }

      if (erasedCount > 0) {
        logger.success('IMAGE', `✨ ${erasedCount} marca(s) d'água concorrente(s) removida(s) com sucesso da imagem!`);
        return await sharp(outData, { raw: { width, height, channels } }).jpeg({ quality: 95 }).toBuffer();
      }
      return imageBuffer;
    } catch (err: any) {
      logger.warn('IMAGE', `Aviso ao remover marca d'água concorrente: ${err.message}`);
      return imageBuffer;
    }
  }

  /**
   * Detects which corner contains a competitor watermark or tag.
   * Analyzes corner variance and non-background pixel density against the baseline background.
   */
  public async detectWatermarkCorner(buffer: Buffer): Promise<'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'> {
    try {
      const { data, info } = await sharp(buffer)
        .resize(100, 100, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const channels = info.channels || 3;

      // Sample background around center borders
      const bgSamples = [[50, 10], [50, 90], [10, 50], [90, 50], [30, 50], [70, 50]];
      let bgR = 0, bgG = 0, bgB = 0;
      for (const [x, y] of bgSamples) {
        const idx = (y * 100 + x) * channels;
        bgR += data[idx];
        bgG += data[idx + 1];
        bgB += data[idx + 2];
      }
      bgR /= bgSamples.length;
      bgG /= bgSamples.length;
      bgB /= bgSamples.length;

      const cornerZones = {
        'bottom-right': { minX: 65, maxX: 96, minY: 65, maxY: 96 },
        'bottom-left': { minX: 4, maxX: 35, minY: 65, maxY: 96 },
        'top-right': { minX: 65, maxX: 96, minY: 6, maxY: 35 },
        'top-left': { minX: 4, maxX: 35, minY: 6, maxY: 35 }
      };

      const cornerScores: Record<string, number> = {
        'bottom-right': 0,
        'bottom-left': 0,
        'top-right': 0,
        'top-left': 0
      };

      for (const [cornerKey, zone] of Object.entries(cornerZones)) {
        let score = 0;
        let totalSampled = 0;

        for (let y = zone.minY; y <= zone.maxY; y += 2) {
          for (let x = zone.minX; x <= zone.maxX; x += 2) {
            totalSampled++;
            const idx = (y * 100 + x) * channels;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            const dist = Math.sqrt(
              Math.pow(r - bgR, 2) + Math.pow(g - bgG, 2) + Math.pow(b - bgB, 2)
            );
            const saturation = Math.max(r, g, b) - Math.min(r, g, b);

            if (dist > 30) {
              score += 1 + (saturation > 25 ? 1.5 : 0);
            }
          }
        }

        cornerScores[cornerKey] = score / totalSampled;
      }

      let maxCorner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' = 'bottom-right';
      let maxScore = -1;

      for (const [corner, score] of Object.entries(cornerScores)) {
        if (score > maxScore) {
          maxScore = score;
          maxCorner = corner as any;
        }
      }

      logger.info('IMAGE', `🎯 Detecção de marca d'água nos cantos: BR=${(cornerScores['bottom-right']*100).toFixed(0)}%, BL=${(cornerScores['bottom-left']*100).toFixed(0)}%, TR=${(cornerScores['top-right']*100).toFixed(0)}%, TL=${(cornerScores['top-left']*100).toFixed(0)}% -> Canto Selecionado: ${maxCorner}`);
      return maxCorner;
    } catch (err: any) {
      logger.warn('IMAGE', `Aviso ao detectar canto da marca d'água: ${err.message}`);
      return 'bottom-right';
    }
  }

  /**
   * Overlays custom watermark / logo on the detected or specified corner
   */
  public async applyCustomWatermark(imageBuffer: Buffer): Promise<Buffer> {
    const config = configService.getConfig();
    const isWatermarkEnabled = config.watermark?.enabled !== false && (config.watermark?.enabled === true || config.filters?.removeWatermarks !== false);
    if (!isWatermarkEnabled) {
      return imageBuffer;
    }

    try {
      const customFile = path.join(BANNERS_DIR, 'custom_watermark.png');
      const assetCustomFile = path.join(ASSETS_BANNERS_DIR, 'custom_watermark.png');
      let watermarkBuffer: Buffer | null = null;
      let isCustomLogo = false;

      if (fs.existsSync(customFile)) {
        watermarkBuffer = fs.readFileSync(customFile);
        isCustomLogo = true;
      } else if (fs.existsSync(assetCustomFile)) {
        watermarkBuffer = fs.readFileSync(assetCustomFile);
        isCustomLogo = true;
      } else if (config.watermark?.customLogoBase64) {
        const cleanBase64 = config.watermark.customLogoBase64.replace(/^data:image\/[a-z0-9]+;base64,/i, '');
        watermarkBuffer = Buffer.from(cleanBase64, 'base64');
        isCustomLogo = true;
      } else {
        watermarkBuffer = await this.getDefaultWatermarkBuffer();
      }

      if (!watermarkBuffer || watermarkBuffer.length === 0) {
        return imageBuffer;
      }

      const imgMetadata = await sharp(imageBuffer).metadata();
      const imgWidth = imgMetadata.width || 800;
      const imgHeight = imgMetadata.height || 800;

      let targetCorner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' = 'bottom-right';
      const posMode = config.watermark?.positionMode || 'AUTO_DETECT';
      if (posMode === 'AUTO_DETECT') {
        targetCorner = await this.detectWatermarkCorner(imageBuffer);
      } else if (posMode === 'BOTTOM_LEFT') {
        targetCorner = 'bottom-left';
      } else if (posMode === 'TOP_RIGHT') {
        targetCorner = 'top-right';
      } else if (posMode === 'TOP_LEFT') {
        targetCorner = 'top-left';
      } else {
        targetCorner = 'bottom-right';
      }

      const scale = Math.max(0.18, Math.min(0.40, config.watermark?.sizeScale || 0.26));
      const targetWidth = Math.max(120, Math.round(imgWidth * scale));

      let finalBadgeBuffer: Buffer;
      if (isCustomLogo) {
        // Overlay custom logo on a solid modern white rounded card backing to guarantee 100% masking of competitor watermark
        const logoResized = await sharp(watermarkBuffer)
          .resize({ width: Math.round(targetWidth * 0.88), height: Math.round(targetWidth * 0.40), fit: 'inside' })
          .toBuffer();
        const logoMeta = await sharp(logoResized).metadata();
        const cardW = Math.round((logoMeta.width || targetWidth * 0.88) + targetWidth * 0.12);
        const cardH = Math.round((logoMeta.height || targetWidth * 0.35) + targetWidth * 0.08);

        const cardSvg = `
          <svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <filter id="cshadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.25"/>
              </filter>
            </defs>
            <rect x="2" y="2" width="${cardW - 4}" height="${cardH - 4}" rx="14" fill="#ffffff" stroke="#e2e8f0" stroke-width="1.5" filter="url(#cshadow)"/>
          </svg>
        `;
        const cardBg = await sharp(Buffer.from(cardSvg)).png().toBuffer();
        finalBadgeBuffer = await sharp(cardBg)
          .composite([{ input: logoResized, gravity: 'center' }])
          .png()
          .toBuffer();
      } else {
        finalBadgeBuffer = await sharp(watermarkBuffer)
          .resize({ width: targetWidth, withoutEnlargement: false, fit: 'inside' })
          .toBuffer();
      }

      const wmMetadata = await sharp(finalBadgeBuffer).metadata();
      const wmWidth = wmMetadata.width || targetWidth;
      const wmHeight = wmMetadata.height || Math.round(targetWidth * 0.38);

      const margin = Math.max(10, Math.round(imgWidth * 0.02));

      let left = 0;
      let top = 0;

      if (targetCorner === 'bottom-right') {
        left = imgWidth - wmWidth - margin;
        top = imgHeight - wmHeight - margin;
      } else if (targetCorner === 'bottom-left') {
        left = margin;
        top = imgHeight - wmHeight - margin;
      } else if (targetCorner === 'top-right') {
        left = imgWidth - wmWidth - margin;
        top = margin;
      } else if (targetCorner === 'top-left') {
        left = margin;
        top = margin;
      }

      left = Math.max(0, left);
      top = Math.max(0, top);

      const result = await sharp(imageBuffer)
        .composite([
          {
            input: finalBadgeBuffer,
            top,
            left
          }
        ])
        .jpeg({ quality: 95 })
        .toBuffer();

      logger.success('IMAGE', `🏷️ Selo/Marca oficial aplicada no canto [${targetCorner}] cobrindo 100% da marca anterior!`);
      return result;
    } catch (err: any) {
      logger.error('IMAGE', `Erro ao aplicar marca d'água: ${err.message}`);
      return imageBuffer;
    }
  }

  /**
   * Generates a modern SVG badge for Oferday if no custom logo is uploaded
   */
  public async getDefaultWatermarkBuffer(): Promise<Buffer> {
    const svg = `
      <svg width="340" height="108" viewBox="0 0 340 108" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#f97316;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#ea580c;stop-opacity:1" />
          </linearGradient>
          <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000000" flood-opacity="0.38"/>
          </filter>
        </defs>
        <rect x="6" y="8" width="328" height="92" rx="22" fill="url(#grad1)" stroke="#ffffff" stroke-width="2.5" filter="url(#shadow)"/>
        <path d="M 46 56 L 62 26 L 57 48 L 76 48 L 42 82 L 50 56 Z" fill="#ffffff"/>
        <text x="88" y="64" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="900" fill="#ffffff" letter-spacing="2">OFERDAY</text>
      </svg>
    `;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  public getWatermarkInfo(): { enabled: boolean; positionMode: string; sizeScale: number; customExists: boolean; previewBase64?: string } {
    const config = configService.getConfig();
    const customFile = path.join(BANNERS_DIR, 'custom_watermark.png');
    const assetCustomFile = path.join(ASSETS_BANNERS_DIR, 'custom_watermark.png');
    const customExists = fs.existsSync(customFile) || fs.existsSync(assetCustomFile) || !!config.watermark?.customLogoBase64;

    let previewBase64: string | undefined;
    try {
      if (fs.existsSync(customFile)) {
        previewBase64 = `data:image/png;base64,${fs.readFileSync(customFile).toString('base64')}`;
      } else if (fs.existsSync(assetCustomFile)) {
        previewBase64 = `data:image/png;base64,${fs.readFileSync(assetCustomFile).toString('base64')}`;
      } else if (config.watermark?.customLogoBase64) {
        previewBase64 = config.watermark.customLogoBase64;
      }
    } catch {}

    return {
      enabled: !!config.watermark?.enabled,
      positionMode: config.watermark?.positionMode || 'AUTO_DETECT',
      sizeScale: config.watermark?.sizeScale || 0.25,
      customExists,
      previewBase64
    };
  }
}

export const imageService = new ImageService();
