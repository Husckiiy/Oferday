import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { logger } from './logger.service.js';

const BANNERS_DIR = path.resolve(process.cwd(), 'data', 'banners');

export interface BannerRule {
  id: string;
  name: string;
  keywords: string[];
  cleanImagePath: string;
  competitorHashes?: string[];
}

class ImageService {
  private rules: BannerRule[] = [];

  constructor() {
    this.ensureBannersDir();
    this.initDefaultRules();
  }

  private ensureBannersDir(): void {
    if (!fs.existsSync(BANNERS_DIR)) {
      fs.mkdirSync(BANNERS_DIR, { recursive: true });
    }
  }

  private initDefaultRules(): void {
    const mlCouponClean = path.join(BANNERS_DIR, 'alerta_cupons_ml_limpo.jpg');
    const magaluCouponClean = path.join(BANNERS_DIR, 'alerta_cupons_magalu_limpo.jpg');

    this.rules = [
      {
        id: 'magalu_coupon_alert',
        name: 'Alerta de Cupons Magalu',
        keywords: [
          'alerta de cupons magalu',
          'cupons magalu',
          'cupom magalu',
          'alerta magalu',
          'cupom magazine luiza',
          'cupons magazine luiza'
        ],
        cleanImagePath: magaluCouponClean
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
          'alerta cupom'
        ],
        cleanImagePath: mlCouponClean
      }
    ];
  }

  /**
   * Checks if incoming message text or image matches a banner replacement rule.
   * If matched, returns the clean replacement image buffer.
   */
  public processImageReplacement(text: string, originalBuffer: Buffer | null): Buffer | null {
    if (!originalBuffer && !text) {
      return originalBuffer;
    }

    const lowerText = (text || '').toLowerCase();

    for (const rule of this.rules) {
      // 1. Match by keywords in the text
      const matchedKeyword = rule.keywords.some((kw) => lowerText.includes(kw));

      if (matchedKeyword) {
        if (fs.existsSync(rule.cleanImagePath)) {
          try {
            const cleanBuffer = fs.readFileSync(rule.cleanImagePath);
            logger.success('IMAGE', `Regra acionada [${rule.name}]: Imagem substituída automaticamente pelo banner limpo!`);
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
