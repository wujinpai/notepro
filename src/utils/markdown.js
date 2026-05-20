import { marked } from 'marked';
import katex from 'katex';

const katexBlockRegex = /\$\$([\s\S]*?)\$\$/g;
const katexInlineRegex = /\$([^\$\n]+?)\$/g;

function renderKatex(latex, displayMode) {
  try {
    return katex.renderToString(latex.trim(), {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return `<span class="katex-error">${latex}</span>`;
  }
}

function replaceKatex(src) {
  let result = src.replace(katexBlockRegex, (_, latex) => renderKatex(latex, true));
  result = result.replace(katexInlineRegex, (_, latex) => renderKatex(latex, false));
  return result;
}

const renderer = new marked.Renderer();

renderer.image = (href, title, text) => {
  const t = title || '';
  const alt = text || '';
  return `<img src="${href}" alt="${alt}" title="${t}" loading="lazy" onclick="window.__openLightbox?.('${href}','${alt}')">`;
};

renderer.link = (href, title, text) => {
  const t = title || '';
  return `<a href="${href}" title="${t}" target="_blank" rel="noopener noreferrer">${text}</a>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

export function renderMarkdown(source) {
  if (!source) return '';
  const withKatex = replaceKatex(source);
  return marked.parse(withKatex);
}

export function renderMarkdownPreview(source, maxLength = 300) {
  if (!source) return '';
  const html = renderMarkdown(source);
  const plain = html.replace(/<[^>]*>/g, '');
  if (plain.length <= maxLength) return html;
  return plain.slice(0, maxLength) + '...';
}
