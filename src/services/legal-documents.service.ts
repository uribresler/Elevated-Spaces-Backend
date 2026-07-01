import prisma from "../dbConnection";

export type LegalDocumentSlug =
  | "terms-of-use"
  | "privacy-policy"
  | "cancellation-policy"
  | "cookie-policy"
  | "copyright-policy"
  | "disclaimer"
  | "support";

export interface LegalDocumentRecord {
  slug: LegalDocumentSlug;
  title: string;
  description: string;
  contentHtml: string;
  updatedAt: string;
  updatedBy: string | null;
}

export async function listLegalDocuments(): Promise<LegalDocumentRecord[]> {
  const docs = await prisma.legal_documents.findMany({
    orderBy: { slug: "asc" },
  });
  return docs.map((doc) => ({
    slug: doc.slug as LegalDocumentSlug,
    title: doc.title,
    description: doc.description,
    contentHtml: doc.content_html,
    updatedAt: doc.updated_at?.toISOString() || new Date().toISOString(),
    updatedBy: doc.updated_by || null,
  }));
}

export async function getLegalDocumentBySlug(slug: string): Promise<LegalDocumentRecord | null> {
  const doc = await prisma.legal_documents.findUnique({
    where: { slug },
  });
  if (!doc) return null;
  return {
    slug: doc.slug as LegalDocumentSlug,
    title: doc.title,
    description: doc.description,
    contentHtml: doc.content_html,
    updatedAt: doc.updated_at?.toISOString() || new Date().toISOString(),
    updatedBy: doc.updated_by || null,
  };
}

export async function updateLegalDocument(
  slug: string,
  input: { title?: string; description?: string; contentHtml?: string },
  updatedBy: string | null
): Promise<LegalDocumentRecord> {
  const doc = await prisma.legal_documents.update({
    where: { slug },
    data: {
      ...(input.title?.trim() ? { title: input.title.trim() } : {}),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.contentHtml?.trim() ? { content_html: input.contentHtml } : {}),
      updated_at: new Date(),
      updated_by: updatedBy,
    },
  });
  return {
    slug: doc.slug as LegalDocumentSlug,
    title: doc.title,
    description: doc.description,
    contentHtml: doc.content_html,
    updatedAt: doc.updated_at?.toISOString() || new Date().toISOString(),
    updatedBy: doc.updated_by || null,
  };
}
