'use strict';

// Generate a quote PDF with smart page format selection.
// Renders Letter first; if it spills to 2 pages by just a little,
// switches to Legal (14" tall) so it fits on one clean page.
// If the content genuinely needs 2+ pages, keeps Letter (multi-page is fine).
const PDF_MARGIN = { top: '20px', right: '16px', bottom: '20px', left: '16px' };

async function generateQuotePDF(html) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Try Letter first
    let pdfBuffer = await page.pdf({ format: 'Letter', margin: PDF_MARGIN, printBackground: true });
    // Quick page-count check: each PDF page is a fixed-size object.
    // Count "\/Type \/Page" occurrences (PDF spec marker for page objects).
    const pageCount = (pdfBuffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    if (pageCount === 2) {
      // Barely spilled — try Legal (3" more height). If it fits on 1 page, use it.
      const legalBuffer = await page.pdf({ format: 'Legal', margin: PDF_MARGIN, printBackground: true });
      const legalPages = (legalBuffer.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
      if (legalPages === 1) {
        pdfBuffer = legalBuffer;
      }
      // If Legal is also 2 pages, keep Letter (content genuinely needs 2 pages)
    }
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = { generateQuotePDF };
