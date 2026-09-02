import { logger } from './logger.service.js';

export class UrlShortenerService {
  /**
   * Shorten with TinyURL API
   */
  public async shortenWithTinyUrl(url: string): Promise<string | null> {
    try {
      const apiUrl = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text.startsWith('https://tinyurl.com/')) {
          return text;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Shorten with is.gd API
   */
  public async shortenWithIsGd(url: string): Promise<string | null> {
    try {
      const apiUrl = `https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text.startsWith('https://is.gd/')) {
          return text;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Shorten with v.gd API
   */
  public async shortenWithVGd(url: string): Promise<string | null> {
    try {
      const apiUrl = `https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl, {
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text.startsWith('https://v.gd/')) {
          return text;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Universal shortener: tries TinyURL, is.gd, v.gd
   */
  public async shorten(url: string): Promise<string> {
    if (!url) return url;

    // If already short (e.g. meli.la, s.shopee, tinyurl, is.gd), return directly
    if (url.includes('meli.la/') || url.includes('s.shopee.com.br/') || url.includes('s.click.aliexpress.com/')) {
      return url;
    }

    // 1. Try TinyURL (Fast and highly reliable)
    const tiny = await this.shortenWithTinyUrl(url);
    if (tiny) return tiny;

    // 2. Try is.gd
    const isgd = await this.shortenWithIsGd(url);
    if (isgd) return isgd;

    // 3. Try v.gd
    const vgd = await this.shortenWithVGd(url);
    if (vgd) return vgd;

    return url;
  }
}

export const urlShortenerService = new UrlShortenerService();
