import sharp from "sharp";

/**
 * Adds a semi-transparent watermark text to the bottom right of an image buffer.
 * @param inputBuffer The original image buffer
 * @param watermarkText The text to use as a watermark
 * @returns Buffer with watermark applied
 */
export async function addWatermark(
  inputBuffer: Buffer,
  watermarkText: string = "DEMO PREVIEW"
): Promise<Buffer> {
  const image = sharp(inputBuffer);
  const { width, height } = await image.metadata();
  const fontSize = Math.round((width || 800) / 18);

  // Create SVG overlay for watermark
  const svg = `
    <svg width="${width}" height="${height}">
      <text x="${(width || 800) - fontSize * 0.5}" y="${(height || 600) - fontSize * 0.5}"
        font-size="${fontSize}" font-family="Arial, Helvetica, sans-serif"
        fill="white" fill-opacity="0.7" stroke="black" stroke-width="2" text-anchor="end"
        alignment-baseline="bottom">
        ${watermarkText}
      </text>
    </svg>
  `;
  return image.composite([
    { input: Buffer.from(svg), gravity: "southeast" }
  ]).toBuffer();
}
