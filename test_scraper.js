async function testAmazonCdn() {
  const asin = 'B002HSYOXM';
  const urls = [
    `https://ws-na.amazon-adsystem.com/widgets/q?_encoding=UTF8&ASIN=${asin}&Format=_SL800_&ID=AsinImage&MarketPlace=BR&ServiceVersion=20070822&WS=1&tag=ibanez08-20`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_SX800_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      console.log('URL:', url, '-> Status:', res.status, 'Content-Type:', res.headers.get('content-type'), 'Length:', (await res.arrayBuffer()).byteLength);
    } catch (e) {
      console.log('URL:', url, '-> Error:', e.message);
    }
  }
}
testAmazonCdn();
