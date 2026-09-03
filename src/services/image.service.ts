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
  theme: 'YELLOW_ML' | 'BLUE_MAGALU' | 'OTHER';
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

  private ensureBannersDir(): void {
    if (!fs.existsSync(BANNERS_DIR)) {
      fs.mkdirSync(BANNERS_DIR, { recursive: true });
    }
  }

  /**
   * Detects the dominant background color theme from the banner image corners
   */
  public async detectColorTheme(buffer: Buffer): Promise<'YELLOW_ML' | 'BLUE_MAGALU' | 'UNKNOWN'> {
    try {
      const { data } = await sharp(buffer)
        .resize(50, 50, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const r = data[0];
      const g = data[1];
      const b = data[2];

      // Yellow: High Red & Green, Low Blue
      if (r > 150 && g > 150 && b < 100) {
        return 'YELLOW_ML';
      }
      // Blue: High Blue, Low Red
      if (b > 140 && r < 120) {
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
        id: 'ml_coupon_alert',
        name: 'Alerta de Cupons Mercado Livre',
        theme: 'YELLOW_ML',
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
          'novo cupom',
          'ativou',
          'resgatou',
          'resgate',
          'produtos full',
          'cupom ativo',
          'cupons ativos'
        ],
        cleanImagePath: mlClean,
        referenceImages: [mlComp, mlClean]
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
          'economizandocomjp'
        ],
        cleanImagePath: magaluClean,
        referenceImages: [magaluComp, magaluClean]
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
   * Process image replacement with Color Theme, Perceptual dHash, and Hash matching
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
    let inColorTheme: 'YELLOW_ML' | 'BLUE_MAGALU' | 'UNKNOWN' = 'UNKNOWN';

    if (originalBuffer && originalBuffer.length > 0) {
      inSha256 = crypto.createHash('sha256').update(originalBuffer).digest('hex');
      inMd5 = crypto.createHash('md5').update(originalBuffer).digest('hex');
      inDHash = await this.computeDHash(originalBuffer);
      inPixels = await this.getNormalizedPixels(originalBuffer);
      inColorTheme = await this.detectColorTheme(originalBuffer);
    }

    for (const rule of this.rules) {
      let isMatch = false;
      let matchReason = '';

      // 1. Color Theme Match (Direct Yellow for ML or Blue for Magalu)
      if (inColorTheme !== 'UNKNOWN' && inColorTheme === rule.theme) {
        // Confirm with dHash or keywords or structure
        if (inDHash && rule.cachedRefs) {
          for (const ref of rule.cachedRefs) {
            const dist = this.hammingDistance(inDHash.binary, ref.dHashBinary);
            if (dist <= 22) {
              isMatch = true;
              matchReason = `Tema de cor (${rule.theme}) + dHash correspondente (distância ${dist}/64 bits)`;
              break;
            }
          }
        }
        if (!isMatch) {
          isMatch = true;
          matchReason = `Tema visual de cor exclusivo do ${rule.name}`;
        }
      }

      // 2. Exact MD5 / SHA-256 Hash Match
      if (!isMatch && rule.cachedRefs) {
        for (const ref of rule.cachedRefs) {
          if (inSha256 && (inSha256 === ref.sha256 || inMd5 === ref.md5)) {
            isMatch = true;
            matchReason = `Hash exato idêntico (MD5: ${inMd5})`;
            break;
          }

          if (inDHash && ref.dHashBinary) {
            const dist = this.hammingDistance(inDHash.binary, ref.dHashBinary);
            if (dist <= 18) {
              const hashMatchPct = (((64 - dist) / 64) * 100).toFixed(1);
              isMatch = true;
              matchReason = `Perceptual dHash (${hashMatchPct}% precisão, dist ${dist}/64)`;
              break;
            }
          }
        }
      }

      // 3. Keyword Fallback in Text
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
            logger.success('IMAGE', `🎯 Regra acionada [${rule.name}] via ${matchReason}! Imagem substituída com precisão pelo banner limpo.`);
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
