import prisma from "../dbConnection";

function isYoutubeFieldValidationError(error: unknown): boolean {
  return error instanceof Error && /Unknown argument `youtube_url`|Unknown argument `youtubeUrl`/i.test(error.message);
}

export async function listResources() {
  return prisma.resource.findMany({ orderBy: { created_at: "asc" } });
}

export async function getResourceBySlug(slug: string) {
  return prisma.resource.findUnique({ where: { slug } });
}

export async function updateResource(
  slug: string,
  payload: { title?: string; contentHtml?: string; youtubeUrl?: string; removePdf?: boolean },
  files: any,
  updatedBy?: string
) {
  const existing = await prisma.resource.findUnique({ where: { slug } });

  const normalizedYoutubeUrl = payload.youtubeUrl?.trim() || null;
  const pdfUpload = files?.pdf?.[0] || null;
  const shouldRemovePdf = Boolean(payload.removePdf) && !pdfUpload;

  const data: any = {
    title: payload.title ?? existing?.title ?? "",
    content_html: payload.contentHtml ?? existing?.content_html ?? null,
    youtube_url: normalizedYoutubeUrl,
    updated_by: updatedBy ?? existing?.updated_by ?? null,
    pdf: pdfUpload ? pdfUpload.buffer : shouldRemovePdf ? null : existing?.pdf ?? null,
    pdf_filename: pdfUpload ? pdfUpload.originalname : shouldRemovePdf ? null : existing?.pdf_filename ?? null,
    pdf_mime: pdfUpload ? pdfUpload.mimetype : shouldRemovePdf ? null : existing?.pdf_mime ?? null,
  };

  if (existing) {
    try {
      return await prisma.resource.update({ where: { slug }, data });
    } catch (error) {
      if (!isYoutubeFieldValidationError(error)) {
        throw error;
      }

      await prisma.$executeRaw`
        UPDATE "resource"
        SET
          title = ${data.title},
          content_html = ${data.content_html},
          youtube_url = ${data.youtube_url},
          updated_by = ${data.updated_by},
          pdf = ${data.pdf},
          pdf_filename = ${data.pdf_filename},
          pdf_mime = ${data.pdf_mime},
          updated_at = NOW()
        WHERE slug = ${slug}
      `;

      return prisma.resource.findUnique({ where: { slug } });
    }
  }

  return prisma.resource.create({ data: { ...data, slug } });
}
