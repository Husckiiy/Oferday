import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { apiRouter } from './routes/api.routes.js';
import { telegramService } from './services/telegram.service.js';
import { whatsappService } from './services/whatsapp.service.js';
import { forwarderService } from './services/forwarder.service.js';
import { logger } from './services/logger.service.js';
import { configService } from './config/config.service.js';
import { meliAuthService } from './services/meli-auth.service.js';
import { imageService } from './services/image.service.js';

dotenv.config();

process.on('uncaughtException', (err) => {
  logger.error('SYSTEM', `Exceção não tratada: ${err.message}`);
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('SYSTEM', `Rejeição assíncrona: ${reason?.message || reason}`);
});

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend dashboard
app.use(express.static(PUBLIC_DIR));

// API Routes
app.use('/api', apiRouter);

// Fallback to index.html for frontend routing
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, async () => {
  logger.success('SYSTEM', `Painel Web rodando em: http://localhost:${PORT}`);
  
  // Pre-load and index banner images for instant perceptual hash matching
  try {
    await imageService.initialize();
  } catch (err: any) {
    logger.warn('IMAGE', `Aviso ao carregar imagens de referência: ${err.message}`);
  }

  // Initialize Forwarder bridging service
  forwarderService.initialize();

  // Try auto-initializing WhatsApp if configured or auth exists
  try {
    await whatsappService.initialize();
  } catch (err: any) {
    logger.warn('WHATSAPP', `Não foi possível auto-iniciar WhatsApp: ${err.message}`);
  }

  // Try auto-initializing Telegram if session or API credentials exist
  const cfg = configService.getConfig();
  if (cfg.telegram.apiId && cfg.telegram.apiHash) {
    try {
      await telegramService.initialize();
    } catch (err: any) {
      logger.warn('TELEGRAM', `Não foi possível auto-iniciar Telegram: ${err.message}`);
    }
  }

  // Start 24/7 proactive OAuth token refresher
  meliAuthService.startProactiveTokenRefresher();
});
