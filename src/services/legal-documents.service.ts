import { pgPool } from "../dbConnection";

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
  const result = await pgPool.query(
    `SELECT slug, title, description, content_html, updated_at, updated_by FROM legal_documents ORDER BY slug ASC`
  );
  return result.rows.map((row) => ({
    slug: row.slug as LegalDocumentSlug,
    title: row.title,
    description: row.description,
    contentHtml: row.content_html,
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
    updatedBy: row.updated_by || null,
  }));
}

export async function getLegalDocumentBySlug(slug: string): Promise<LegalDocumentRecord | null> {
  const result = await pgPool.query(
    `SELECT slug, title, description, content_html, updated_at, updated_by FROM legal_documents WHERE slug = $1`,
    [slug]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    slug: row.slug as LegalDocumentSlug,
    title: row.title,
    description: row.description,
    contentHtml: row.content_html,
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
    updatedBy: row.updated_by || null,
  };
}

export async function updateLegalDocument(
  slug: string,
  input: { title?: string; description?: string; contentHtml?: string },
  updatedBy: string | null
): Promise<LegalDocumentRecord> {
  const result = await pgPool.query(
    `UPDATE legal_documents 
     SET 
       title = COALESCE(NULLIF($2, ''), title),
       description = COALESCE(NULLIF($3, ''), description),
       content_html = COALESCE(NULLIF($4, ''), content_html),
       updated_at = NOW(),
       updated_by = $5
     WHERE slug = $1
     RETURNING slug, title, description, content_html, updated_at, updated_by`,
    [slug, input.title?.trim() || '', input.description?.trim() || '', input.contentHtml?.trim() || '', updatedBy]
  );
  if (result.rows.length === 0) throw new Error("Legal document not found");
  const row = result.rows[0];
  return {
    slug: row.slug as LegalDocumentSlug,
    title: row.title,
    description: row.description,
    contentHtml: row.content_html,
    updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
    updatedBy: row.updated_by || null,
  };
}
