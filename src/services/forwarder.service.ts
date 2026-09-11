import { EventEmitter } from 'events';
import { telegramService } from './telegram.service.js';
import { whatsappService } from './whatsapp.service.js';
import { configService } from '../config/config.service.js';
import { logger } from './logger.service.js';
import { ForwardedMessageItem } from '../types/index.js';

import { affiliateService } from './affiliate.service.js';
import { imageService } from './image.service.js';
import { divulgadorService } from './divulgador.service.js';

import crypto from 'crypto';

interface SentOfferRecord {
  fingerprint: string;
  channel: string;
  sentAt: number;
}

interface SentMessageHistoryItem {
  text: string;
  tokens: Set<string>;
  channel: string;
  sentAt: number;
}

class ForwarderService extends EventEmitter {
  private initialized = false;
  private recentMessages: ForwardedMessageItem[] = [];
  private maxHistory = 50;
  private sentOffers: Map<string, SentOfferRecord> = new Map();
  private sentMessagesHistory: SentMessageHistoryItem[] = [];
  private readonly DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours deduplication window

  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    telegramService.on('new_message', async (data: { id: number; text: string; mediaBuffer: Buffer | null; date: number; channel?: string }) => {
      await this.handleTelegramMessage(data);
    });

    logger.info('FORWARDER', 'Serviço de repasse (Telegram -> WhatsApp) inicializado e pronto (Filtro Anti-Duplicidade Ativo).');
  }

  public getRecentMessages(): ForwardedMessageItem[] {
    return [...this.recentMessages];
  }

  private cleanOldSentOffers(): void {
    const now = Date.now();
    for (const [key, record] of this.sentOffers.entries()) {
      if (now - record.sentAt > this.DEDUP_WINDOW_MS) {
        this.sentOffers.delete(key);
      }
    }
    this.sentMessagesHistory = this.sentMessagesHistory.filter((item) => now - item.sentAt < this.DEDUP_WINDOW_MS);
  }

  private extractTokens(text: string): Set<string> {
    const clean = text
      .toLowerCase()
      .replace(/https?:\/\/[^\s]+/g, '')
      .replace(/[^a-z0-9áéíóúãõâêîôûç]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const words = clean.split(' ').filter((w) => w.length > 2);
    return new Set(words);
  }

  private computeJaccardSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }
    const union = tokensA.size + tokensB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  public extractFingerprints(text: string, affResults: any[]): { productFps: string[]; announcementFps: string[] } {
    const productFps: string[] = [];
    const announcementFps: string[] = [];

    // 1. Product IDs (MLB, ASIN, SKU, Shopee ID)
    for (const res of affResults) {
      const fp = affiliateService.extractProductFingerprint(res.canonicalProductUrl) || 
                 affiliateService.extractProductFingerprint(res.finalResolvedUrl) || 
                 affiliateService.extractProductFingerprint(res.originalUrl);
      if (fp) {
        productFps.push(fp);
      } else {
        // Campaign or Showcase list URL fingerprint
        try {
          const u = new URL(res.finalResolvedUrl || res.originalUrl);
          if (u.pathname && (u.pathname.includes('/cupons') || u.pathname.includes('/landing') || u.pathname.includes('/promocao') || u.pathname.includes('/m/'))) {
            announcementFps.push(`campaign_${crypto.createHash('md5').update(u.origin + u.pathname).digest('hex')}`);
          }
        } catch {}
      }
    }

    if (text) {
      // 2. Coupon Code Extraction (Only for generic announcements without product IDs)
      const couponRegex1 = /(?:cupom|c[oó]digo|c[oó]d|off|desconto)\s*[:：\-–—]?\s*([A-Za-z0-9_\-]{4,25})/gi;
      let match: RegExpExecArray | null;
      const nonCoupons = [
        'MERCADO', 'MAGALU', 'SHOPEE', 'AMAZON', 'PRODUTOS', 'PRODUTO', 'SELECIONADOS',
        'CONTA', 'LIMITADO', 'HTTPS', 'HTTP', 'PARA', 'COM', 'SEM', 'POR', 'QUE',
        'TEM', 'EM', 'ESTA', 'ESTE', 'APROVEITEM', 'TODOS', 'TODAS', 'LINK', 'LISTA',
        'AQUI', 'ACESSE', 'AGORA', 'COMPRAS', 'COMPRA', 'VALIDO', 'VÁLIDO', 'RESGATE'
      ];
      while ((match = couponRegex1.exec(text)) !== null) {
        const code = match[1].toUpperCase().trim();
        if (code.length >= 4 && !nonCoupons.includes(code)) {
          announcementFps.push(`coupon_${code}`);
        }
      }

      // Standalone coupon codes
      const standaloneCodes = text.match(/\b([A-Z]{3,15}\d{1,8}[A-Z0-9]*|\d{1,5}[A-Z]{3,10}[A-Z0-9]*)\b/g);
      if (standaloneCodes) {
        for (const rawCode of standaloneCodes) {
          const code = rawCode.toUpperCase();
          if (code.length >= 5 && !code.startsWith('MLB') && !code.startsWith('HTTPS') && !code.startsWith('HTTP') && !code.includes('MERCADOLIVRE')) {
            announcementFps.push(`coupon_${code}`);
          }
        }
      }

      // 3. Semantic Discount Fingerprint (e.g. "25% OFF + R$ 89 + R$ 50")
      const percentMatch = text.match(/(\d{1,2}%\s*(?:off|desconto)?)/i);
      const moneyMatch = text.match(/r\$\s*(\d+)/gi);
      if (percentMatch && moneyMatch && moneyMatch.length > 0) {
        const semantic = `discount_${percentMatch[1].replace(/\s+/g, '').toLowerCase()}_${moneyMatch.map(m => m.replace(/\s+/g, '').toLowerCase()).sort().join('_')}`;
        announcementFps.push(semantic);
      }

      // 4. Normalized text hash
      const cleanText = text.replace(/https?:\/\/[^\s]+/g, '').replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚãõÃÕâêîôûÂÊÎÔÛçÇ]/g, '').toLowerCase().trim();
      if (cleanText.length > 25) {
        announcementFps.push(`text_${crypto.createHash('md5').update(cleanText).digest('hex')}`);
      }
    }

    return {
      productFps: Array.from(new Set(productFps)),
      announcementFps: Array.from(new Set(announcementFps))
    };
  }

  private async handleTelegramMessage(data: { id: number; text: string; mediaBuffer: Buffer | null; date: number; channel?: string }): Promise<void> {
    const config = configService.getConfig();
    const channel = data.channel || config.telegram.sourceChannel || '@canal';
    const destinationJid = config.whatsapp.destinationJid;

    this.cleanOldSentOffers();

    // 1. --- BLACKLIST CHECK (BLOQUEIO TOTAL DE MENSAGEM) ---
    // If message contains any keyword from blacklist (e.g. instagram.com, tiktok.com, grupo vip):
    // The entire message is discarded and blocked!
    const blacklist = config.filters?.blacklist || [];
    const lowerOriginalText = (data.text || '').toLowerCase();
    
    if (blacklist.length > 0 && lowerOriginalText) {
      const matchedKeyword = blacklist.find((word) => {
        const cleanWord = word.trim().toLowerCase();
        return cleanWord && lowerOriginalText.includes(cleanWord);
      });

      if (matchedKeyword) {
        logger.warn('FORWARDER', `🚫 Mensagem do canal "${channel}" bloqueada pelo filtro de Blacklist (termo detectado: "${matchedKeyword}").`);
        const blockedItem: ForwardedMessageItem = {
          id: Math.random().toString(36).substring(2, 9),
          telegramMessageId: data.id,
          channel,
          text: data.text,
          hasMedia: !!data.mediaBuffer,
          mediaBase64: null,
          destinationJid: destinationJid || 'Não configurado',
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
          status: 'failed',
          error: `Bloqueado por Blacklist ("${matchedKeyword}")`
        };
        this.addFeedItem(blockedItem);
        return;
      }
    }

    // 2. Process text through Affiliate Service to convert store links and REMOVE unwanted terms/lines
    let processedText = data.text;
    let affResults: any[] = [];
    if (data.text) {
      try {
        const affResult = await affiliateService.processMessageText(data.text);
        processedText = affResult.text;
        affResults = affResult.results || [];
      } catch (affErr: any) {
        logger.warn('FORWARDER', `Aviso ao processar links de afiliado: ${affErr.message}`);
      }
    }

    // If text became empty after sanitization, drop it
    if (!processedText || processedText.trim().length < 5) {
      logger.warn('FORWARDER', `🚫 Mensagem do canal "${channel}" vazia após limpeza de termos. Descartada.`);
      return;
    }

    // --- SMART ANTI-DUPLICATE DETECTION (CROSS-CHANNEL) ---
    let duplicateReason: string | null = null;
    let prevSentRecord: { channel: string; sentAt: number; detail?: string } | null = null;

    const { productFps, announcementFps } = this.extractFingerprints(data.text, affResults);
    
    // SCENARIO A: THIS IS A SPECIFIC PRODUCT OFFER (Has Product ID: MLB, ASIN, SKU, etc.)
    // Only block if the exact SAME product ID was sent before (allows all different deals using the same coupon code!)
    if (productFps.length > 0) {
      for (const pFp of productFps) {
        if (this.sentOffers.has(pFp)) {
          const rec = this.sentOffers.get(pFp)!;
          if (Date.now() - rec.sentAt < this.DEDUP_WINDOW_MS) {
            duplicateReason = `Produto já enviado [${pFp}]`;
            prevSentRecord = rec;
            break;
          }
        }
      }
    } 
    // SCENARIO B: THIS IS A GENERIC ANNOUNCEMENT / COUPON BANNER (No specific product ID)
    else {
      for (const aFp of announcementFps) {
        if (this.sentOffers.has(aFp)) {
          const rec = this.sentOffers.get(aFp)!;
          if (Date.now() - rec.sentAt < this.DEDUP_WINDOW_MS) {
            duplicateReason = aFp.startsWith('coupon_') ? `Alerta de cupom já divulgado [${aFp.replace('coupon_', '')}]` : `Anúncio duplicado [${aFp}]`;
            prevSentRecord = rec;
            break;
          }
        }
      }

      // Check Jaccard similarity ONLY for generic announcements without product IDs
      if (!duplicateReason && data.text) {
        const currentTokens = this.extractTokens(data.text);
        if (currentTokens.size >= 8) {
          for (const historyItem of this.sentMessagesHistory) {
            if (Date.now() - historyItem.sentAt < this.DEDUP_WINDOW_MS) {
              const similarity = this.computeJaccardSimilarity(currentTokens, historyItem.tokens);
              if (similarity >= 0.75) {
                const pct = (similarity * 100).toFixed(0);
                duplicateReason = `Anúncio ${pct}% similar a alerta anterior`;
                prevSentRecord = { channel: historyItem.channel, sentAt: historyItem.sentAt };
                break;
              }
            }
          }
        }
      }
    }

    // Process image replacement (e.g. Alerta de Cupons clean image via visual comparison)
    let finalMediaBuffer = data.mediaBuffer;
    try {
      finalMediaBuffer = await imageService.processImageReplacement(data.text, data.mediaBuffer);
    } catch (imgErr: any) {
      logger.warn('FORWARDER', `Aviso ao processar substituição de imagem: ${imgErr.message}`);
    }

    let mediaBase64: string | null = null;
    if (finalMediaBuffer && finalMediaBuffer.length > 0) {
      mediaBase64 = `data:image/jpeg;base64,${finalMediaBuffer.toString('base64')}`;
    }

    const item: ForwardedMessageItem = {
      id: Math.random().toString(36).substring(2, 9),
      telegramMessageId: data.id,
      channel,
      text: processedText,
      hasMedia: !!finalMediaBuffer,
      mediaBase64,
      destinationJid: destinationJid || 'Não configurado',
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
      status: 'pending'
    };

    this.addFeedItem(item);
    
    // Ingerir no catálogo de ofertas do Divulgador
    try {
      divulgadorService.ingestFromTelegramMessage(data.text, finalMediaBuffer);
    } catch {}

    // If duplicate detected, block forwarding
    if (duplicateReason && prevSentRecord) {
      const minutesAgo = Math.max(1, Math.round((Date.now() - prevSentRecord.sentAt) / 60000));
      logger.warn('FORWARDER', `🚫 Oferta/Cupom duplicado bloqueado: [${duplicateReason}] já foi enviado há ${minutesAgo} min pelo canal "${prevSentRecord.channel}". Ignorando repasse.`);
      item.status = 'failed';
      item.error = `Duplicado: ${duplicateReason} (enviado há ${minutesAgo} min por ${prevSentRecord.channel})`;
      this.emit('message_updated', item);
      return;
    }

    if (!config.forwarder.active) {
      item.status = 'failed';
      item.error = 'Repasse automático desativado';
      this.emit('message_updated', item);
      logger.warn('FORWARDER', `Mensagem #${data.id} ignorada: Repasse automático está desativado no painel.`);
      return;
    }

    if (!destinationJid || !destinationJid.trim()) {
      item.status = 'failed';
      item.error = 'Nenhum JID de destino configurado';
      this.emit('message_updated', item);
      logger.warn('FORWARDER', `Mensagem #${data.id} ignorada: Nenhum JID de destino do WhatsApp configurado.`);
      return;
    }

    const waStatus = whatsappService.getStatus();
    if (waStatus.status !== 'connected') {
      item.status = 'failed';
      item.error = 'WhatsApp desconectado';
      this.emit('message_updated', item);
      logger.error('FORWARDER', `Mensagem #${data.id} falhou: WhatsApp não está conectado no momento.`);
      return;
    }

    try {
      logger.info('FORWARDER', `Iniciando repasse da mensagem #${data.id} para o WhatsApp (${destinationJid})...`);
      
      const previewText = processedText ? (processedText.length > 80 ? processedText.substring(0, 80) + '...' : processedText) : '[Sem texto / Apenas mídia]';
      logger.info('FORWARDER', `Prévia do conteúdo: "${previewText}"`);

      await whatsappService.sendMessage(destinationJid, processedText, finalMediaBuffer);
      
      // Register fingerprints according to type (product deals vs generic announcements)
      if (productFps.length > 0) {
        for (const pFp of productFps) {
          this.sentOffers.set(pFp, { fingerprint: pFp, channel, sentAt: Date.now() });
        }
      } else {
        for (const aFp of announcementFps) {
          this.sentOffers.set(aFp, { fingerprint: aFp, channel, sentAt: Date.now() });
        }
        if (data.text) {
          this.sentMessagesHistory.unshift({
            text: data.text,
            tokens: this.extractTokens(data.text),
            channel,
            sentAt: Date.now()
          });
          if (this.sentMessagesHistory.length > 200) {
            this.sentMessagesHistory.pop();
          }
        }
      }

      item.status = 'success';
      this.emit('message_updated', item);
      logger.success('FORWARDER', `Mensagem #${data.id} repassada e entregue com sucesso no WhatsApp!`);
    } catch (err: any) {
      item.status = 'failed';
      item.error = err.message;
      this.emit('message_updated', item);
      logger.error('FORWARDER', `Erro ao repassar mensagem #${data.id} para o WhatsApp: ${err.message}`);
    }
  }

  private addFeedItem(item: ForwardedMessageItem): void {
    this.recentMessages.unshift(item);
    if (this.recentMessages.length > this.maxHistory) {
      this.recentMessages.pop();
    }
    this.emit('new_forwarded_message', item);
  }

  public async sendSimulatedMessage(text: string, imageUrl?: string): Promise<ForwardedMessageItem> {
    const config = configService.getConfig();
    const destinationJid = config.whatsapp.destinationJid;

    // --- BLACKLIST / SPAM FILTER CHECK ---
    const blacklist = config.filters?.blacklist || [];
    const lowerOriginalText = (text || '').toLowerCase();
    
    if (blacklist.length > 0 && lowerOriginalText) {
      const matchedKeyword = blacklist.find((word) => {
        const cleanWord = word.trim().toLowerCase();
        return cleanWord && lowerOriginalText.includes(cleanWord);
      });

      if (matchedKeyword) {
        logger.warn('FORWARDER', `🚫 Mensagem simulada bloqueada pelo filtro de Blacklist (termo detectado: "${matchedKeyword}").`);
        const blockedItem: ForwardedMessageItem = {
          id: Math.random().toString(36).substring(2, 9),
          telegramMessageId: Math.floor(Math.random() * 100000),
          channel: 'Simulador Manual',
          text,
          hasMedia: !!imageUrl,
          mediaBase64: null,
          destinationJid: destinationJid || 'Não configurado',
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
          status: 'failed',
          error: `Bloqueado por Blacklist ("${matchedKeyword}")`
        };
        this.addFeedItem(blockedItem);
        return blockedItem;
      }
    }

    let mediaBuffer: Buffer | null = null;
    let mediaBase64: string | null = null;

    if (imageUrl) {
      try {
        const res = await fetch(imageUrl);
        const arrayBuffer = await res.arrayBuffer();
        mediaBuffer = Buffer.from(arrayBuffer);
      } catch (err: any) {
        logger.warn('FORWARDER', `Não foi possível carregar imagem do simulador: ${err.message}`);
      }
    }

    // Process image replacement (e.g. Alerta de Cupons clean image)
    let finalMediaBuffer = mediaBuffer;
    try {
      finalMediaBuffer = await imageService.processImageReplacement(text, mediaBuffer);
    } catch (imgErr: any) {
      logger.warn('FORWARDER', `Aviso ao processar substituição de imagem: ${imgErr.message}`);
    }

    if (finalMediaBuffer && finalMediaBuffer.length > 0) {
      mediaBase64 = `data:image/jpeg;base64,${finalMediaBuffer.toString('base64')}`;
    }

    // Process text through Affiliate Service
    let processedText = text;
    if (text) {
      try {
        const affResult = await affiliateService.processMessageText(text);
        processedText = affResult.text;
      } catch (affErr: any) {
        logger.warn('FORWARDER', `Aviso ao processar links de afiliado: ${affErr.message}`);
      }
    }

    const item: ForwardedMessageItem = {
      id: Math.random().toString(36).substring(2, 9),
      telegramMessageId: Math.floor(Math.random() * 90000) + 10000,
      channel: config.telegram.sourceChannel || '@simulador_teste',
      text: processedText,
      hasMedia: !!finalMediaBuffer,
      mediaBase64,
      destinationJid: destinationJid || 'Não configurado',
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour12: false }),
      status: 'pending'
    };

    this.addFeedItem(item);

    if (!destinationJid) {
      item.status = 'failed';
      item.error = 'Destino WhatsApp não informado';
      this.emit('message_updated', item);
      throw new Error('JID de destino não configurado.');
    }

    try {
      await whatsappService.sendMessage(destinationJid, processedText, finalMediaBuffer);
      item.status = 'success';
      this.emit('message_updated', item);
      logger.success('FORWARDER', `Mensagem de teste/simulada repassada para ${destinationJid} com sucesso!`);
      return item;
    } catch (err: any) {
      item.status = 'failed';
      item.error = err.message;
      this.emit('message_updated', item);
      throw err;
    }
  }
}

export const forwarderService = new ForwarderService();
