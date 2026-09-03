import { EventEmitter } from 'events';
import { telegramService } from './telegram.service.js';
import { whatsappService } from './whatsapp.service.js';
import { configService } from '../config/config.service.js';
import { logger } from './logger.service.js';
import { ForwardedMessageItem } from '../types/index.js';

import { affiliateService } from './affiliate.service.js';
import { imageService } from './image.service.js';

class ForwarderService extends EventEmitter {
  private initialized = false;
  private recentMessages: ForwardedMessageItem[] = [];
  private maxHistory = 50;

  public initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    telegramService.on('new_message', async (data: { id: number; text: string; mediaBuffer: Buffer | null; date: number; channel?: string }) => {
      await this.handleTelegramMessage(data);
    });

    logger.info('FORWARDER', 'Serviço de repasse (Telegram -> WhatsApp) inicializado e pronto.');
  }

  public getRecentMessages(): ForwardedMessageItem[] {
    return [...this.recentMessages];
  }

  private async handleTelegramMessage(data: { id: number; text: string; mediaBuffer: Buffer | null; date: number; channel?: string }): Promise<void> {
    const config = configService.getConfig();
    const channel = data.channel || config.telegram.sourceChannel || '@canal';
    const destinationJid = config.whatsapp.destinationJid;

    // Process text through Affiliate Service to convert store links
    let processedText = data.text;
    if (data.text) {
      try {
        const affResult = await affiliateService.processMessageText(data.text);
        processedText = affResult.text;
      } catch (affErr: any) {
        logger.warn('FORWARDER', `Aviso ao processar links de afiliado: ${affErr.message}`);
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
      // Create thumbnail / preview data URL (JPEG/PNG)
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
