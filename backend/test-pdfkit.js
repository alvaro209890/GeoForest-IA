const PDFDocument = require('pdfkit');
const fs = require('fs');
const sharp = require('sharp');

async function test() {
  const doc = new PDFDocument();
  const imgBuf = await sharp({
    create: { width: 800, height: 600, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } }
  }).png().toBuffer();
  
  const img = doc.openImage(imgBuf);
  console.log("Image width:", img.width);
  console.log("Image height:", img.height);
}
test().catch(console.error);
