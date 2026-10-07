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

  /**
   * Fetches official, high-resolution, watermark-free product image directly from the store
   */
  public async fetchOfficialStoreImage(affResults: any[]): Promise<Buffer | null> {
    if (!affResults || affResults.length === 0) return null;

    for (const res of affResults) {
      if (!res || !res.store || res.store === 'UNKNOWN') continue;
      const targetUrl = res.canonicalProductUrl || res.finalResolvedUrl || res.originalUrl;
      if (!targetUrl) continue;

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
                    if (buf.length > 5000) {
                      logger.success('IMAGE', `✨ Imagem oficial HD extraída do Mercado Livre (${mlbId}) - 100% limpa sem marcas!`);
                      return buf;
                    }
                  }
                }
              }
            } catch {}
          }

          const scraped = await this.scrapeOgImageFromUrl(targetUrl);
          if (scraped) {
            logger.success('IMAGE', `✨ Imagem oficial extraída do Mercado Livre - 100% limpa sem marcas!`);
            return scraped;
          }
        }

        // 2. Amazon
        if (res.store === 'AMAZON') {
          const asinMatch = targetUrl.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})/i) || targetUrl.match(/\/([A-Z0-9]{10})(?:[/?]|$)/i);
          const lookupUrl = asinMatch ? `https://www.amazon.com.br/dp/${asinMatch[1]}` : targetUrl;
          const scraped = await this.scrapeOgImageFromUrl(lookupUrl);
          if (scraped) {
            logger.success('IMAGE', `✨ Imagem oficial extraída da Amazon - 100% limpa sem marcas!`);
            return scraped;
          }
        }

        // 3. Shopee
        if (res.store === 'SHOPEE') {
          const scraped = await this.scrapeOgImageFromUrl(targetUrl);
          if (scraped) {
            logger.success('IMAGE', `✨ Imagem oficial extraída da Shopee - 100% limpa sem marcas!`);
            return scraped;
          }
        }

        // 4. Magalu
        if (res.store === 'MAGALU') {
          const scraped = await this.scrapeOgImageFromUrl(targetUrl);
          if (scraped) {
            logger.success('IMAGE', `✨ Imagem oficial extraída do Magalu - 100% limpa sem marcas!`);
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
        logger.warn('IMAGE', `Aviso ao buscar imagem da loja (${res.store}): ${err.message}`);
      }
    }

    return null;
  }

  /**
   * Scrapes Open Graph og:image or high-res product image from HTML
   */
  private async scrapeOgImageFromUrl(url: string): Promise<Buffer | null> {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        signal: AbortSignal.timeout(5000)
      });
      if (!resp.ok) return null;

      const html = await resp.text();
      let imageUrl: string | null = null;
      const ogMatch = html.match(/<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)[\"']/i) ||
                      html.match(/<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:image[\"']/i) ||
                      html.match(/<meta[^>]+name=[\"']twitter:image[\"'][^>]+content=[\"']([^\"']+)[\"']/i);

      if (ogMatch && ogMatch[1]) {
        imageUrl = ogMatch[1].trim();
      }

      if (!imageUrl && url.includes('amazon')) {
        const dynamicMatch = html.match(/data-a-dynamic-image=[\"']\{&quot;([^&]+)&quot;/i) || html.match(/\"large\":\"([^"]+)\"/i);
        if (dynamicMatch && dynamicMatch[1]) {
          imageUrl = dynamicMatch[1].replace(/\\/g, '');
        }
      }

      if (imageUrl && imageUrl.startsWith('http')) {
        if (imageUrl.includes('mlstatic.com')) {
          imageUrl = imageUrl.replace(/-[I|V]\.(jpg|jpeg|png|webp)/i, '-O.$1');
        }

        const imgResp = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Referer': url
          },
          signal: AbortSignal.timeout(6000)
        });

        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          if (buf.length > 3000) {
            return buf;
          }
        }
      }
    } catch {
      // ignore
    }
    return null;
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
    if (!config.watermark?.enabled) {
      return imageBuffer;
    }

    try {
      const customFile = path.join(BANNERS_DIR, 'custom_watermark.png');
      let watermarkBuffer: Buffer | null = null;

      if (fs.existsSync(customFile)) {
        watermarkBuffer = fs.readFileSync(customFile);
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
      if (config.watermark.positionMode === 'AUTO_DETECT') {
        targetCorner = await this.detectWatermarkCorner(imageBuffer);
      } else if (config.watermark.positionMode === 'BOTTOM_LEFT') {
        targetCorner = 'bottom-left';
      } else if (config.watermark.positionMode === 'TOP_RIGHT') {
        targetCorner = 'top-right';
      } else if (config.watermark.positionMode === 'TOP_LEFT') {
        targetCorner = 'top-left';
      } else {
        targetCorner = 'bottom-right';
      }

      const scale = config.watermark.sizeScale || 0.25;
      const targetWidth = Math.max(100, Math.round(imgWidth * scale));

      const resizedWatermark = await sharp(watermarkBuffer)
        .resize({ width: targetWidth, withoutEnlargement: false, fit: 'inside' })
        .toBuffer();

      const wmMetadata = await sharp(resizedWatermark).metadata();
      const wmWidth = wmMetadata.width || targetWidth;
      const wmHeight = wmMetadata.height || Math.round(targetWidth * 0.4);

      const margin = Math.max(12, Math.round(imgWidth * 0.025));

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
            input: resizedWatermark,
            top,
            left
          }
        ])
        .jpeg({ quality: 92 })
        .toBuffer();

      logger.success('IMAGE', `🏷️ Marca d'água do canal aplicada com sucesso no canto [${targetCorner}] cobrindo a marca anterior!`);
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
      <svg width="320" height="100" viewBox="0 0 320 100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#f97316;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#ea580c;stop-opacity:1" />
          </linearGradient>
          <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity="0.35"/>
          </filter>
        </defs>
        <rect x="8" y="10" width="304" height="80" rx="40" fill="url(#grad1)" filter="url(#shadow)"/>
        <path d="M 45 52 L 60 26 L 55 46 L 72 46 L 40 76 L 48 52 Z" fill="#ffffff"/>
        <text x="82" y="60" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="900" fill="#ffffff" letter-spacing="2">OFERDAY</text>
      </svg>
    `;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  public getWatermarkInfo(): { enabled: boolean; positionMode: string; sizeScale: number; customExists: boolean; previewBase64?: string } {
    const config = configService.getConfig();
    const customFile = path.join(BANNERS_DIR, 'custom_watermark.png');
    const customExists = fs.existsSync(customFile);

    let previewBase64: string | undefined;
    try {
      if (customExists) {
        previewBase64 = `data:image/png;base64,${fs.readFileSync(customFile).toString('base64')}`;
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
