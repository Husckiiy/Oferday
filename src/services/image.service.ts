import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import { logger } from './logger.service.js';

const BANNERS_DIR = path.resolve(process.cwd(), 'data', 'banners');

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
    this.initDefaultRules();
  }

  private ensureBannersDir(): void {
    if (!fs.existsSync(BANNERS_DIR)) {
      fs.mkdirSync(BANNERS_DIR, { recursive: true });
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
    } catch (err: any) {
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
    } catch (err: any) {
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
    if (!fs.existsSync(filePath)) return null;
    try {
      const buf = fs.readFileSync(filePath);
      const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
      const md5 = crypto.createHash('md5').update(buf).digest('hex');
      const dHash = await this.computeDHash(buf);
      const pixelBuffer = await this.getNormalizedPixels(buf);

      if (!dHash) return null;

      return {
        path: filePath,
        sha256,
        md5,
        dHashBinary: dHash.binary,
        dHashHex: dHash.hex,
        pixelBuffer
      };
    } catch (err: any) {
      logger.error('IMAGE', `Erro ao indexar imagem de referência (${filePath}): ${err.message}`);
      return null;
    }
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
          'novo cupom de desconto no magalu',
          'salve seu cupom magalu'
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
   * Process image replacement with multi-tier hash and visual matching
   */
  public async processImageReplacement(text: string, originalBuffer: Buffer | null): Promise<Buffer | null> {
    if (!originalBuffer && !text) {
      return originalBuffer;
    }

    if (!this.initialized) {
      await this.initDefaultRules();
    }

    const lowerText = (text || '').toLowerCase();

    let inSha256 = '';
    let inMd5 = '';
    let inDHash: { binary: string; hex: string } | null = null;
    let inPixels: Buffer | null = null;

    if (originalBuffer && originalBuffer.length > 0) {
      inSha256 = crypto.createHash('sha256').update(originalBuffer).digest('hex');
      inMd5 = crypto.createHash('md5').update(originalBuffer).digest('hex');
      inDHash = await this.computeDHash(originalBuffer);
      inPixels = await this.getNormalizedPixels(originalBuffer);
    }

    for (const rule of this.rules) {
      let isMatch = false;
      let matchReason = '';

      if (rule.cachedRefs && rule.cachedRefs.length > 0) {
        for (const ref of rule.cachedRefs) {
          // 1. Exact MD5 / SHA-256 Hash Match
          if (inSha256 && (inSha256 === ref.sha256 || inMd5 === ref.md5)) {
            isMatch = true;
            matchReason = `Hash exato idêntico (MD5: ${inMd5})`;
            break;
          }

          // 2. Perceptual dHash Match (Hamming distance <= 14 bits out of 64)
          if (inDHash && ref.dHashBinary) {
            const dist = this.hammingDistance(inDHash.binary, ref.dHashBinary);
            if (dist <= 14) {
              const hashMatchPct = (((64 - dist) / 64) * 100).toFixed(1);
              isMatch = true;
              matchReason = `Perceptual dHash correspondente (${hashMatchPct}% de precisão, distância ${dist}/64 bits)`;
              break;
            }
          }

          // 3. Grayscale Pixel Similarity (>= 72%)
          if (inPixels && ref.pixelBuffer) {
            const similarity = this.calculateSimilarity(inPixels, ref.pixelBuffer);
            if (similarity >= 72.0) {
              isMatch = true;
              matchReason = `Similaridade visual de pixels de ${similarity.toFixed(1)}%`;
              break;
            }
          }
        }
      }

      // 4. Keyword Fallback in Text
      if (!isMatch && lowerText) {
        const matchedKeyword = rule.keywords.some((kw) => lowerText.includes(kw));
        if (matchedKeyword) {
          isMatch = true;
          matchReason = `Palavra-chave identificada no texto da oferta`;
        }
      }

      // If matched, replace with clean image
      if (isMatch) {
        if (fs.existsSync(rule.cleanImagePath)) {
          try {
            const cleanBuffer = fs.readFileSync(rule.cleanImagePath);
            logger.success('IMAGE', `🎯 Regra acionada [${rule.name}] via ${matchReason}! Imagem substituída com sucesso pelo banner limpo.`);
            return cleanBuffer;
          } catch (err: any) {
            logger.error('IMAGE', `Erro ao carregar imagem limpa (${rule.cleanImagePath}): ${err.message}`);
          }
        }
      }
    }

    return originalBuffer;
  }
}

export const imageService = new ImageService();
