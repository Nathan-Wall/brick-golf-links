create table if not exists app_markdown_documents (
  document_key text primary key,
  markdown text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_markdown_documents_markdown_not_blank check (length(btrim(markdown)) > 0)
);
