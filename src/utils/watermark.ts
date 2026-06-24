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
  const w = width || 800;
  const h = height || 600;
  const fontSize = Math.round(w / 12);
  const subSize = Math.round(w / 32);
  const safeText = watermarkText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Bold dark text with white stroke + drop shadow so it stays legible on any photo.
  const svg = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000000" flood-opacity="0.45" />
        </filter>
      </defs>
      <text x="50%" y="50%"
        font-size="${fontSize}"
        font-family="Arial, Helvetica, sans-serif"
        fill="#ffffff" fill-opacity="0.92"
        stroke="#000000" stroke-opacity="0.7" stroke-width="2"
        text-anchor="middle" dominant-baseline="middle"
        filter="url(#shadow)"
        style="font-weight:900; letter-spacing:3px; text-transform:uppercase;">
        ${safeText}
      </text>
      <text x="50%" y="${Math.round(h / 2) + Math.round(fontSize * 0.85)}"
        font-size="${subSize}"
        font-family="Arial, Helvetica, sans-serif"
        fill="#ffffff" fill-opacity="0.85"
        stroke="#000000" stroke-opacity="0.6" stroke-width="1"
        text-anchor="middle" dominant-baseline="middle"
        filter="url(#shadow)"
        style="font-weight:600; letter-spacing:2px;">
        elevatespacesai.com · upgrade to remove
      </text>
    </svg>
  `;
  return image.composite([
    { input: Buffer.from(svg), gravity: "center" }
  ]).toBuffer();
}
