import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { logger } from './logger.service.js';

const BANNERS_DIR = path.resolve(process.cwd(), 'data', 'banners');

export interface BannerRule {
  id: string;
  name: string;
  keywords: string[];
  cleanImagePath: string;
  referenceImages: string[];
  cachedFingerprints?: Buffer[];
}

class ImageService {
  private rules: BannerRule[] = [];
  private initialized = false;

  constructor() {
    this.ensureBannersDir();
    this.initDefaultRules();
  }

  private ensureBannersDir(): void {
    if (!fs.existsSync(BANNERS_DIR)) {
      fs.mkdirSync(BANNERS_DIR, { recursive: true });
    }
  }

  private async getNormalizedPixels(buffer: Buffer): Promise<Buffer | null> {
    try {
      return await sharp(buffer)
        .resize(32, 32, { fit: 'fill' })
        .grayscale()
        .raw()
        .toBuffer();
    } catch (err: any) {
      return null;
    }
  }

  private calculateSimilarity(buf1: Buffer, buf2: Buffer): number {
    if (buf1.length !== buf2.length) return 0;
    let diff = 0;
    for (let i = 0; i < buf1.length; i++) {
      diff += Math.abs(buf1[i] - buf2[i]);
    }
    const maxDiff = 255 * buf1.length;
    return (1 - diff / maxDiff) * 100;
  }

  private async initDefaultRules(): Promise<void> {
    const mlClean = path.join(BANNERS_DIR, 'alerta_cupons_ml_limpo.jpg');
    const mlComp = path.join(BANNERS_DIR, 'alerta_cupons_ml_concorrente.png');

    const magaluClean = path.join(BANNERS_DIR, 'alerta_cupons_magalu_limpo.jpg');
    const magaluComp = path.join(BANNERS_DIR, 'alerta_cupons_magalu_concorrente.png');

    this.rules = [
      {
        id: 'magalu_coupon_alert',
        name: 'Alerta de Cupons Magalu',
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
          'novo cupom de desconto no magalu'
        ],
        cleanImagePath: magaluClean,
        referenceImages: [magaluComp, magaluClean]
      },
      {
        id: 'ml_coupon_alert',
        name: 'Alerta de Cupons Mercado Livre',
        keywords: [
          'alerta de cupom',
          'alerta de cupons',
          'cupons mercado livre',
          'cupom mercado livre',
          'economizandocomjp',
          'alerta cupom',
          'novo cupom de desconto',
          'cupom de desconto no mercado livre',
          'desconto no mercado livre',
          'salve seu cupom',
          'novo cupom'
        ],
        cleanImagePath: mlClean,
        referenceImages: [mlComp, mlClean]
      }
    ];

    // Pre-cache fingerprints
    for (const rule of this.rules) {
      rule.cachedFingerprints = [];
      for (const refPath of rule.referenceImages) {
        if (fs.existsSync(refPath)) {
          const buf = fs.readFileSync(refPath);
          const fp = await this.getNormalizedPixels(buf);
          if (fp) rule.cachedFingerprints.push(fp);
        }
      }
    }

    this.initialized = true;
  }

  /**
   * Checks if incoming message text or image matches a banner replacement rule.
   * Compares both visual image fingerprint AND text keywords.
   */
  public async processImageReplacement(text: string, originalBuffer: Buffer | null): Promise<Buffer | null> {
    if (!originalBuffer && !text) {
      return originalBuffer;
    }

    if (!this.initialized) {
      await this.initDefaultRules();
    }

    const lowerText = (text || '').toLowerCase();
    let incomingFingerprint: Buffer | null = null;

    if (originalBuffer && originalBuffer.length > 0) {
      incomingFingerprint = await this.getNormalizedPixels(originalBuffer);
    }

    for (const rule of this.rules) {
      let isMatch = false;
      let matchReason = '';

      // 1. Visual Comparison by Image Pixel Fingerprint (sharp)
      if (incomingFingerprint && rule.cachedFingerprints && rule.cachedFingerprints.length > 0) {
        for (const refFp of rule.cachedFingerprints) {
          const similarity = this.calculateSimilarity(incomingFingerprint, refFp);
          if (similarity >= 75.0) {
            isMatch = true;
            matchReason = `Similaridade visual de ${similarity.toFixed(1)}% com o banner ${rule.name}`;
            break;
          }
        }
      }

      // 2. Keyword fallback in text
      if (!isMatch && lowerText) {
        const matchedKeyword = rule.keywords.some((kw) => lowerText.includes(kw));
        if (matchedKeyword) {
          isMatch = true;
          matchReason = `Palavra-chave detectada no texto da mensagem`;
        }
      }

      // If matched, replace with clean image
      if (isMatch) {
        if (fs.existsSync(rule.cleanImagePath)) {
          try {
            const cleanBuffer = fs.readFileSync(rule.cleanImagePath);
            logger.success('IMAGE', `🎯 Regra acionada [${rule.name}] (${matchReason})! Imagem substituída com precisão visual pelo banner limpo.`);
            return cleanBuffer;
          } catch (err: any) {
            logger.error('IMAGE', `Erro ao carregar banner limpo (${rule.cleanImagePath}): ${err.message}`);
          }
        }
      }
    }

    return originalBuffer;
  }
}

export const imageService = new ImageService();
