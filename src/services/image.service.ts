import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import crypto from 'crypto';
import { logger } from './logger.service.js';

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

  public async reload(): Promise<void> {
    this.initialized = false;
    await this.initDefaultRules();
  }

  public getBannerStatus(): { ml: boolean; magalu: boolean; mlPreview?: string; magaluPreview?: string } {
    const mlPath = path.join(BANNERS_DIR, 'alerta_cupons_ml_limpo.jpg');
    const magaluPath = path.join(BANNERS_DIR, 'alerta_cupons_magalu_limpo.jpg');
    const mlFallback = path.join(ASSETS_BANNERS_DIR, 'alerta_cupons_ml_limpo.jpg');
    const magaluFallback = path.join(ASSETS_BANNERS_DIR, 'alerta_cupons_magalu_limpo.jpg');

    let mlPreview: string | undefined;
    let magaluPreview: string | undefined;

    const actualMl = fs.existsSync(mlPath) ? mlPath : (fs.existsSync(mlFallback) ? mlFallback : null);
    const actualMagalu = fs.existsSync(magaluPath) ? magaluPath : (fs.existsSync(magaluFallback) ? magaluFallback : null);

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

    return {
      ml: !!actualMl,
      magalu: !!actualMagalu,
      mlPreview,
      magaluPreview
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
  public async detectColorTheme(buffer: Buffer): Promise<'YELLOW_ML' | 'BLUE_MAGALU' | 'UNKNOWN'> {
    try {
      const { data, info } = await sharp(buffer)
        .resize(50, 50, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const channels = info.channels || 3;
      let yellowVotes = 0;
      let blueVotes = 0;

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
        if (r > 140 && g > 130 && b < 120) {
          yellowVotes++;
        }
        // Blue (Magalu): High Blue, Low Red
        if (b > 130 && r < 140) {
          blueVotes++;
        }
      }

      if (yellowVotes >= 4) {
        return 'YELLOW_ML';
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
          'resgate seu cupom',
          'resgate o cupom',
          'resgatou na conta',
          'para quem resgatou',
          'produtos full',
          'valido em produtos',
          'cupom ativo',
          'cupons ativos',
          'cupons full'
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
          'economizandocomjp',
          'resgate seu cupom magalu',
          'cupom ativo magalu'
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
   * Process image replacement strictly by visual comparison (Perceptual dHash and Exact Hash).
   * Will ONLY replace if the incoming image is actually a known coupon banner image.
   * Product photos will never be replaced.
   */
  public async processImageReplacement(text: string, originalBuffer: Buffer | null): Promise<Buffer | null> {
    if (!originalBuffer || originalBuffer.length === 0) {
      return originalBuffer;
    }

    if (!this.initialized) {
      await this.initDefaultRules();
    }

    const inSha256 = crypto.createHash('sha256').update(originalBuffer).digest('hex');
    const inMd5 = crypto.createHash('md5').update(originalBuffer).digest('hex');
    const inDHash = await this.computeDHash(originalBuffer);

    if (!inDHash) {
      return originalBuffer;
    }

    for (const rule of this.rules) {
      let isMatch = false;
      let matchReason = '';

      if (rule.cachedRefs && rule.cachedRefs.length > 0) {
        for (const ref of rule.cachedRefs) {
          // 1. Exact Hash Match
          if (inSha256 === ref.sha256 || inMd5 === ref.md5) {
            isMatch = true;
            matchReason = `Hash exato idêntico (MD5: ${inMd5})`;
            break;
          }

          // 2. Perceptual dHash Match (Distance <= 14 indicates visual banner match)
          if (ref.dHashBinary) {
            const dist = this.hammingDistance(inDHash.binary, ref.dHashBinary);
            if (dist <= 14) {
              const hashMatchPct = (((64 - dist) / 64) * 100).toFixed(1);
              isMatch = true;
              matchReason = `Perceptual dHash (${hashMatchPct}% precisão, dist ${dist}/64)`;
              break;
            }
          }
        }
      }

      // If matched, replace with clean image
      if (isMatch) {
        let cleanPath = rule.cleanImagePath;
        if (!fs.existsSync(cleanPath)) {
          const fallback = path.join(ASSETS_BANNERS_DIR, path.basename(rule.cleanImagePath));
          if (fs.existsSync(fallback)) {
            cleanPath = fallback;
          }
        }

        if (fs.existsSync(cleanPath)) {
          try {
            const cleanBuffer = fs.readFileSync(cleanPath);
            logger.success('IMAGE', `🎯 Regra acionada [${rule.name}] via ${matchReason}! Imagem de banner substituída pelo banner limpo.`);
            return cleanBuffer;
          } catch (err: any) {
            logger.error('IMAGE', `Erro ao carregar banner limpo (${cleanPath}): ${err.message}`);
          }
        }
      }
    }

    // Default: keep the original product image intact
    return originalBuffer;
  }
}

export const imageService = new ImageService();
