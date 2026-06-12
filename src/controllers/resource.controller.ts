import { Request, Response } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  listResources,
  getResourceBySlug,
  updateResource,
} from "../services/resource.service";

function isAdmin(req: Request) {
  const roles = Array.isArray(req.user?.role)
    ? req.user?.role
    : req.user?.role
    ? [req.user.role]
    : [];

  return roles.includes("ADMIN");
}

export async function listResourcesHandler(_req: Request, res: Response) {
  try {
    const data = await listResources();
    return res.status(200).json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || "Failed to list resources" });
  }
}

export async function getResourceHandler(req: Request, res: Response) {
  try {
    const { slug } = req.params;
    const resource = await getResourceBySlug(slug);
    if (!resource) return res.status(404).json({ success: false, message: "Resource not found" });
    const { pdf, video, ...rest } = resource as any;
    return res.status(200).json({ success: true, data: rest });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || "Failed to get resource" });
  }
}

export async function updateResourceHandler(req: Request, res: Response) {
  try {
    if (!isAdmin(req)) return res.status(403).json({ success: false, message: "Admin access required" });

    const { slug } = req.params;
    const { title, contentHtml, youtubeUrl, removePdf } = req.body as { title?: string; contentHtml?: string; youtubeUrl?: string; removePdf?: string | boolean };
    const files = (req as any).files;
    const normalizedRemovePdf = removePdf === true || removePdf === "true";
    const updated = await updateResource(slug, { title, contentHtml, youtubeUrl, removePdf: normalizedRemovePdf }, files, req.user?.email);
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message || "Failed to update resource" });
  }
}

export async function getResourcePdfHandler(req: Request, res: Response) {
  try {
    const { slug } = req.params;
    const resource = await getResourceBySlug(slug);
    if (!resource || !resource.pdf) return res.status(404).send("Not found");
    res.setHeader("Content-Type", resource.pdf_mime || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${resource.pdf_filename || "resource.pdf"}"`);
    return res.status(200).send(Buffer.from(resource.pdf));
  } catch (error: any) {
    return res.status(500).send(error.message || "Failed to send PDF");
  }
}

export async function getResourceVideoHandler(req: Request, res: Response) {
  try {
    const { slug } = req.params;
    const resource = await getResourceBySlug(slug);
    if (!resource || !resource.video) return res.status(404).send("Not found");
    res.setHeader("Content-Type", resource.video_mime || "video/mp4");
    res.setHeader("Content-Disposition", `inline; filename="${resource.video_filename || "resource.mp4"}"`);
    return res.status(200).send(Buffer.from(resource.video));
  } catch (error: any) {
    return res.status(500).send(error.message || "Failed to send video");
  }
}
