import sharp from "sharp";

/**
 * Adds a semi-transparent watermark text to the bottom right of an image buffer.
 * @param inputBuffer The original image buffer
 * @param watermarkText The text to use as a watermark
 * @returns Buffer with watermark applied
 */
export async function addWatermark(
  inputBuffer: Buffer,
  watermarkText: string = "ElevateSpaces"
): Promise<Buffer> {
  const image = sharp(inputBuffer);
  const { width, height } = await image.metadata();
  const fontSize = Math.round((width || 800) / 10);
  // Centered, grayish, semi-transparent, no color accent
  const svg = `
    <svg width="${width}" height="${height}">
      <text x="50%" y="50%"
        font-size="${fontSize}"
        font-family="Arial, Helvetica, sans-serif"
        fill="#6B7280" fill-opacity="0.4"
        text-anchor="middle"
        alignment-baseline="middle"
        dominant-baseline="middle"
        style="font-weight:bold; letter-spacing:2px;">
        ElevateSpaces
      </text>
    </svg>
  `;
  return image.composite([
    { input: Buffer.from(svg), gravity: "center" }
  ]).toBuffer();
}
