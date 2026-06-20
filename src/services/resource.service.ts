import prisma from "../dbConnection";

function isYoutubeFieldValidationError(error: unknown): boolean {
  return error instanceof Error && /Unknown argument `youtube_url`|Unknown argument `youtubeUrl`/i.test(error.message);
}

export async function listResources() {
  return prisma.resource.findMany({
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      slug: true,
      title: true,
      content_html: true,
      youtube_url: true,
      pdf_filename: true,
      pdf_mime: true,
      video_filename: true,
      video_mime: true,
      updated_by: true,
      created_at: true,
      updated_at: true,
    },
  });
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
  // Only fetch metadata — pulling pdf/video bytes here would round-trip the whole
  // BLOB through Node on every save, even when nothing about it changed.
  const existing = await prisma.resource.findUnique({
    where: { slug },
    select: {
      id: true,
      title: true,
      content_html: true,
      updated_by: true,
      pdf_filename: true,
      pdf_mime: true,
    },
  });

  const normalizedYoutubeUrl = payload.youtubeUrl?.trim() || null;
  const pdfUpload = files?.pdf?.[0] || null;
  const shouldRemovePdf = Boolean(payload.removePdf) && !pdfUpload;

  const data: any = {
    title: payload.title ?? existing?.title ?? "",
    content_html: payload.contentHtml ?? existing?.content_html ?? null,
    youtube_url: normalizedYoutubeUrl,
    updated_by: updatedBy ?? existing?.updated_by ?? null,
  };

  // Only touch BLOB columns when they actually change. Writing `pdf: existing.pdf`
  // on every save re-streams the entire file back into Postgres.
  if (pdfUpload) {
    data.pdf = pdfUpload.buffer;
    data.pdf_filename = pdfUpload.originalname;
    data.pdf_mime = pdfUpload.mimetype;
  } else if (shouldRemovePdf) {
    data.pdf = null;
    data.pdf_filename = null;
    data.pdf_mime = null;
  }

  // Return metadata only — the client never needs the bytes echoed back, and
  // streaming a freshly-uploaded multi-MB BLOB back doubles the request time.
  const metadataSelect = {
    id: true,
    slug: true,
    title: true,
    content_html: true,
    youtube_url: true,
    pdf_filename: true,
    pdf_mime: true,
    video_filename: true,
    video_mime: true,
    updated_by: true,
    created_at: true,
    updated_at: true,
  } as const;

  if (existing) {
    try {
      return await prisma.resource.update({ where: { slug }, data, select: metadataSelect });
    } catch (error) {
      if (!isYoutubeFieldValidationError(error)) {
        throw error;
      }

      if ("pdf" in data) {
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
      } else {
        await prisma.$executeRaw`
          UPDATE "resource"
          SET
            title = ${data.title},
            content_html = ${data.content_html},
            youtube_url = ${data.youtube_url},
            updated_by = ${data.updated_by},
            updated_at = NOW()
          WHERE slug = ${slug}
        `;
      }

      return prisma.resource.findUnique({ where: { slug }, select: metadataSelect });
    }
  }

  return prisma.resource.create({ data: { ...data, slug }, select: metadataSelect });
}
