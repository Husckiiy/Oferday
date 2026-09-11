import { logger } from './logger.service.js';

export class UrlShortenerService {
  /**
   * Shorten with CleanURI (Clean 301 direct redirect, no ads)
   */
  public async shortenWithCleanUri(url: string): Promise<string | null> {
    try {
      const res = await fetch('https://cleanuri.com/api/v1/shorten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `url=${encodeURIComponent(url)}`,
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const data: any = await res.json();
        if (data?.result_url && typeof data.result_url === 'string') {
          return data.result_url.trim();
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Shorten with Ulvis.net (Clean 301 direct redirect, fast)
   */
  public async shortenWithUlvis(url: string): Promise<string | null> {
    try {
      const apiUrl = `https://ulvis.net/api.php?url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl, {
        signal: AbortSignal.timeout(4000)
      });
      if (res.ok) {
        const text = (await res.text()).trim();
        if (text.startsWith('https://ulvis.net/')) {
          return text;
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  /**
   * Shorten with TinyURL API
   */
  public async shortenWithTinyUrl(url: string): Promise<string | null> {
    try {
      const apiUrl = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`;
      const res = await fetch(apiUrl, {
        signal: AbortSignal.timeout(4000)
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
        signal: AbortSignal.timeout(4000)
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
   * Universal shortener: tries CleanURI, Ulvis, TinyURL, is.gd
   */
  public async shorten(url: string): Promise<string> {
    if (!url) return url;

    // If already short (e.g. meli.la, s.shopee, s.click, amzn.to, cleanuri, ulvis, tinyurl, is.gd), return directly
    if (
      url.includes('meli.la/') ||
      url.includes('mercadolivre.com/sec') ||
      url.includes('s.shopee.com.br/') ||
      url.includes('s.shopee.com/') ||
      url.includes('shope.ee/') ||
      url.includes('s.click.aliexpress.com/') ||
      url.includes('amzn.to/') ||
      url.includes('a.co/') ||
      url.includes('cleanuri.com/') ||
      url.includes('ulvis.net/') ||
      url.includes('tinyurl.com/') ||
      url.includes('is.gd/') ||
      url.includes('v.gd/')
    ) {
      return url;
    }

    // 1. Try CleanURI (Cleanest direct redirect)
    const clean = await this.shortenWithCleanUri(url);
    if (clean) return clean;

    // 2. Try Ulvis
    const ulvis = await this.shortenWithUlvis(url);
    if (ulvis) return ulvis;

    // 3. Try TinyURL
    const tiny = await this.shortenWithTinyUrl(url);
    if (tiny) return tiny;

    // 4. Try is.gd
    const isgd = await this.shortenWithIsGd(url);
    if (isgd) return isgd;

    return url;
  }
}

export const urlShortenerService = new UrlShortenerService();
