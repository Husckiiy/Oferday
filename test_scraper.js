async function testAllImages() {
  const res = await fetch('https://www.mercadolivre.com.br/ofertas?page=1', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9'
    }
  });
  const html = await res.text();
  const rawCards = html.split('<div class="poly-card');

  let withImageCount = 0;
  for (let i = 1; i < rawCards.length; i++) {
    const card = rawCards[i];
    const imgMatch = card.match(/https:\/\/http2\.mlstatic\.com\/D_[^"'\s\),]+/i);
    if (imgMatch) {
      withImageCount++;
    }
  }

  console.log(`Found images in ${withImageCount} of ${rawCards.length - 1} cards!`);
}
testAllImages();
