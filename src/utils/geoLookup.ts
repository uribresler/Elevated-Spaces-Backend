import prisma from "../dbConnection";
import { logger } from "../utils/logger";

interface IpApiResponse {
  status?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  regionName?: string;
  city?: string;
}

function isPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === "::1" || ip === "127.0.0.1" || ip.startsWith("::ffff:127.")) return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  if (ip.startsWith("172.")) {
    const second = Number(ip.split(".")[1]);
    if (Number.isFinite(second) && second >= 16 && second <= 31) return true;
  }
  return false;
}

function formatLocation(payload: IpApiResponse): string | null {
  if (payload.status && payload.status !== "success") return null;
  const parts = [payload.city, payload.regionName || payload.region, payload.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function backfillEventLocation(eventId: string, ip: string | null): void {
  if (!ip || isPrivateIp(ip)) return;
  void (async () => {
    try {
      const response = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city`);
      if (!response.ok) return;
      const payload = (await response.json()) as IpApiResponse;
      const location = formatLocation(payload);
      if (!location) return;
      await prisma.analytics_event.update({ where: { id: eventId }, data: { location } });
    } catch (error) {
      logger(`[GEO] lookup failed for ${ip}: ${String(error)}`);
    }
  })();
}
