import { loadDefaultPrivacyPolicyMarkdown, normalizePrivacyPolicyMarkdown } from '../services/privacy-policy.js';
import { pool } from './pool.js';

const PRIVACY_POLICY_DOCUMENT_KEY = 'privacy_policy';

type AppMarkdownDocumentRow = {
  document_key: string;
  markdown: string;
  created_at: string;
  updated_at: string;
};

export type PrivacyPolicyDocumentRecord = {
  markdown: string;
  createdAt: string;
  updatedAt: string;
};

function mapPrivacyPolicyDocument(row: AppMarkdownDocumentRow): PrivacyPolicyDocumentRecord {
  return {
    markdown: row.markdown,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function findPrivacyPolicyDocumentRow() {
  const result = await pool.query<AppMarkdownDocumentRow>(
    `
      select
        document_key,
        markdown,
        created_at::text,
        updated_at::text
      from app_markdown_documents
      where document_key = $1
      limit 1
    `,
    [PRIVACY_POLICY_DOCUMENT_KEY]
  );

  return result.rows[0] ?? null;
}

async function ensurePrivacyPolicyDocumentRow() {
  const existingRow = await findPrivacyPolicyDocumentRow();
  if (existingRow) {
    return existingRow;
  }

  await pool.query(
    `
      insert into app_markdown_documents (document_key, markdown)
      values ($1, $2)
      on conflict (document_key) do nothing
    `,
    [PRIVACY_POLICY_DOCUMENT_KEY, loadDefaultPrivacyPolicyMarkdown()]
  );

  const createdRow = await findPrivacyPolicyDocumentRow();
  if (!createdRow) {
    throw new Error('Unable to initialize the privacy policy document.');
  }

  return createdRow;
}

export async function getPrivacyPolicyDocument() {
  return mapPrivacyPolicyDocument(await ensurePrivacyPolicyDocumentRow());
}

export async function updatePrivacyPolicyDocument(markdown: string) {
  const normalizedMarkdown = normalizePrivacyPolicyMarkdown(markdown);
  const result = await pool.query<AppMarkdownDocumentRow>(
    `
      insert into app_markdown_documents (document_key, markdown)
      values ($1, $2)
      on conflict (document_key)
      do update
      set markdown = excluded.markdown,
          updated_at = now()
      returning
        document_key,
        markdown,
        created_at::text,
        updated_at::text
    `,
    [PRIVACY_POLICY_DOCUMENT_KEY, normalizedMarkdown]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Unable to update the privacy policy document.');
  }

  return mapPrivacyPolicyDocument(row);
}
