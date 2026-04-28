import fs from 'node:fs';
import path from 'node:path';

const privacyPolicyMarkdownPathCandidates = [
  path.resolve(process.cwd(), 'content/privacy-policy.md'),
  path.resolve(process.cwd(), 'server/content/privacy-policy.md')
];

export function normalizePrivacyPolicyMarkdown(markdown: string) {
  return markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

export function loadDefaultPrivacyPolicyMarkdown() {
  for (const candidatePath of privacyPolicyMarkdownPathCandidates) {
    if (fs.existsSync(candidatePath)) {
      return normalizePrivacyPolicyMarkdown(fs.readFileSync(candidatePath, 'utf8'));
    }
  }

  throw new Error('Privacy policy markdown document not found.');
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sanitizeMarkdownHref(value: string) {
  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return '#';
  }

  if (trimmedValue.startsWith('/')) {
    return trimmedValue;
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    if (
      parsedUrl.protocol === 'http:' ||
      parsedUrl.protocol === 'https:' ||
      parsedUrl.protocol === 'mailto:'
    ) {
      return parsedUrl.toString();
    }
  } catch {
    return '#';
  }

  return '#';
}

function renderInlineMarkdown(value: string) {
  const escapedValue = escapeHtml(value);

  return escapedValue
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
      return `<a href="${escapeHtml(sanitizeMarkdownHref(href))}">${label}</a>`;
    })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export function renderPrivacyPolicyMarkdownToHtml(markdown: string) {
  const lines = normalizePrivacyPolicyMarkdown(markdown).split('\n');
  const htmlParts: string[] = [];
  let paragraphLines: string[] = [];
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    htmlParts.push(`<p>${renderInlineMarkdown(paragraphLines.join(' '))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    htmlParts.push(
      `<ul>${listItems.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      flushParagraph();
      flushList();
      continue;
    }

    if (trimmedLine.startsWith('# ')) {
      flushParagraph();
      flushList();
      htmlParts.push(`<h1>${renderInlineMarkdown(trimmedLine.slice(2).trim())}</h1>`);
      continue;
    }

    if (trimmedLine.startsWith('## ')) {
      flushParagraph();
      flushList();
      htmlParts.push(`<h2>${renderInlineMarkdown(trimmedLine.slice(3).trim())}</h2>`);
      continue;
    }

    if (trimmedLine.startsWith('- ')) {
      flushParagraph();
      listItems.push(trimmedLine.slice(2).trim());
      continue;
    }

    flushList();
    paragraphLines.push(trimmedLine);
  }

  flushParagraph();
  flushList();

  return htmlParts.join('\n');
}
