import { Request, Response } from "express";
import prisma from "../dbConnection";
import { logger } from "../utils/logger";
import { backfillEventLocation } from "../utils/geoLookup";

function detectDevice(ua: string | undefined): string {
  const value = String(ua || "").toLowerCase();
  if (!value) return "unknown";
  if (/ipad|tablet/.test(value)) return "tablet";
  if (/mobile|iphone|android/.test(value)) return "mobile";
  return "desktop";
}

function rangeToDays(range: unknown): number {
  if (typeof range === "string") {
    if (range === "7d") return 7;
    if (range === "30d") return 30;
    if (range === "90d") return 90;
  }
  return 30;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export async function trackPageview(req: Request, res: Response): Promise<void> {
  try {
    const path = typeof req.body.path === "string" ? req.body.path.slice(0, 500) : null;
    const referrer = typeof req.body.referrer === "string" ? req.body.referrer.slice(0, 500) : null;
    const language = typeof req.body.language === "string" ? req.body.language.slice(0, 16) : null;
    const userId = req.user?.id || (typeof req.body.userId === "string" ? req.body.userId : null);

    const ipRaw = (req.headers["x-forwarded-for"] as string) || req.ip || req.socket.remoteAddress || "";
    const ip = String(ipRaw).split(",")[0].trim().slice(0, 64) || null;
    const deviceType = detectDevice(req.headers["user-agent"] as string | undefined);

    const created = await prisma.analytics_event.create({
      data: {
        user_id: userId,
        event_type: "page_view",
        ip,
        device_type: deviceType,
        language,
        source: referrer,
        location: null,
      },
    });

    backfillEventLocation(created.id, ip);

    res.status(204).end();
  } catch (error) {
    logger(`[ANALYTICS] pageview failed: ${String(error)}`);
    res.status(204).end();
  }
}

async function ensureAdmin(userId: string): Promise<boolean> {
  const role = await prisma.user_roles.findFirst({
    where: { user_id: userId },
    include: { role: true },
  });
  return role?.role?.name === "ADMIN";
}

export async function getAdminOverview(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId || !(await ensureAdmin(userId))) {
      res.status(403).json({ success: false, message: "Forbidden" });
      return;
    }

    const days = rangeToDays(req.query.range);
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const previousSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);

    const [
      pageViewEvents,
      previousPageViewEvents,
      signupsInRange,
      previousSignups,
      activeUserRows,
      totalUsers,
      photographerStatusCounts,
      bookingStatusCounts,
      revenueRows,
      previousRevenueRows,
      topReferrerRows,
    ] = await Promise.all([
      prisma.analytics_event.findMany({
        where: { event_type: "page_view", timestamp: { gte: since } },
        select: { ip: true, device_type: true, source: true, timestamp: true, user_id: true, location: true },
      }),
      prisma.analytics_event.count({
        where: { event_type: "page_view", timestamp: { gte: previousSince, lt: since } },
      }),
      prisma.user.count({ where: { created_at: { gte: since } } }),
      prisma.user.count({ where: { created_at: { gte: previousSince, lt: since } } }),
      prisma.analytics_event.findMany({
        where: { timestamp: { gte: since }, user_id: { not: null } },
        select: { user_id: true },
        distinct: ["user_id"],
      }),
      prisma.user.count(),
      prisma.photographer_profile.groupBy({ by: ["application_status" as any], _count: { _all: true } } as any),
      prisma.booking.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.payment.findMany({
        where: { status: "PAID", created_at: { gte: since } },
        select: { amount: true, created_at: true },
      }),
      prisma.payment.findMany({
        where: { status: "PAID", created_at: { gte: previousSince, lt: since } },
        select: { amount: true },
      }),
      prisma.analytics_event.groupBy({
        by: ["source"],
        where: { event_type: "page_view", timestamp: { gte: since }, source: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
        take: 8,
      }),
    ]);

    const uniqueVisitorSet = new Set<string>();
    const pageViewsByDay = new Map<string, number>();
    const deviceCounts: Record<string, number> = { desktop: 0, mobile: 0, tablet: 0, unknown: 0 };
    const cityIpSets = new Map<string, Set<string>>();

    for (const event of pageViewEvents) {
      if (event.ip) uniqueVisitorSet.add(event.ip);
      const day = startOfDay(event.timestamp).toISOString().slice(0, 10);
      pageViewsByDay.set(day, (pageViewsByDay.get(day) || 0) + 1);
      const device = (event.device_type || "unknown") as keyof typeof deviceCounts;
      deviceCounts[device] = (deviceCounts[device] || 0) + 1;

      if (event.location && event.ip && !event.location.startsWith("/")) {
        const existing = cityIpSets.get(event.location) || new Set<string>();
        existing.add(event.ip);
        cityIpSets.set(event.location, existing);
      }
    }

    const topCities = Array.from(cityIpSets.entries())
      .map(([location, ips]) => ({ location, visitors: ips.size }))
      .sort((a, b) => b.visitors - a.visitors)
      .slice(0, 5);

    const signupRows = await prisma.user.findMany({
      where: { created_at: { gte: since } },
      select: { created_at: true },
    });
    const signupsByDay = new Map<string, number>();
    for (const row of signupRows) {
      const day = startOfDay(row.created_at).toISOString().slice(0, 10);
      signupsByDay.set(day, (signupsByDay.get(day) || 0) + 1);
    }

    const dailySeries: Array<{ date: string; pageViews: number; signups: number }> = [];
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const day = startOfDay(new Date(now.getTime() - offset * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
      dailySeries.push({
        date: day,
        pageViews: pageViewsByDay.get(day) || 0,
        signups: signupsByDay.get(day) || 0,
      });
    }

    const totalPageViews = pageViewEvents.length;
    const uniqueVisitors = uniqueVisitorSet.size;
    const conversionRate = uniqueVisitors > 0 ? signupsInRange / uniqueVisitors : 0;
    const previousConversionRate = previousPageViewEvents > 0 ? previousSignups / previousPageViewEvents : 0;
    const revenue = revenueRows.reduce((acc, row) => acc + Number(row.amount || 0), 0);
    const previousRevenue = previousRevenueRows.reduce((acc, row) => acc + Number(row.amount || 0), 0);

    const photographers = {
      total: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
    };
    for (const row of photographerStatusCounts as any[]) {
      const status = String(row.application_status || "").toUpperCase();
      const count = Number(row._count?._all || 0);
      photographers.total += count;
      if (status === "APPROVED") photographers.approved += count;
      else if (status === "REJECTED") photographers.rejected += count;
      else photographers.pending += count;
    }

    const bookings = { total: 0, pending: 0, confirmed: 0, cancelled: 0 };
    for (const row of bookingStatusCounts) {
      const count = Number((row as any)._count?._all || 0);
      const status = String((row as any).status || "");
      bookings.total += count;
      if (status === "PENDING") bookings.pending += count;
      else if (status === "CONFIRMED") bookings.confirmed += count;
      else if (status === "CANCELLED") bookings.cancelled += count;
    }

    const topReferrers = (topReferrerRows as any[]).map((row) => ({
      source: row.source as string,
      count: Number(row._count?._all || 0),
    }));

    const funnel = [
      { label: "Visitors (unique)", value: uniqueVisitors },
      { label: "Signups", value: signupsInRange },
      { label: "Photographer apps", value: photographers.total },
      { label: "Bookings created", value: bookings.total },
      { label: "Paid bookings", value: bookings.confirmed },
    ];

    res.status(200).json({
      success: true,
      data: {
        range: { days, since: since.toISOString(), now: now.toISOString() },
        totals: {
          totalPageViews,
          totalPageViewsPrev: previousPageViewEvents,
          uniqueVisitors,
          activeUsers: activeUserRows.length,
          totalUsers,
          signups: signupsInRange,
          signupsPrev: previousSignups,
          conversionRate,
          conversionRatePrev: previousConversionRate,
          revenue,
          revenuePrev: previousRevenue,
        },
        photographers,
        bookings,
        dailySeries,
        deviceBreakdown: deviceCounts,
        topReferrers,
        topCities,
        funnel,
      },
    });
  } catch (error) {
    logger(`[ANALYTICS] overview failed: ${String(error)}`);
    res.status(500).json({ success: false, message: "Failed to load analytics" });
  }
}
