import { Extractly } from 'extractly/browser';
import { docToMarkdown, pageToMarkdown } from 'extractly/markdown';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $<HTMLInputElement>('pgFileInput');
const fileNameEl = $('pgFileName');
const modeToggle = $<HTMLInputElement>('pgModeToggle');
const labelText = $('pgLabelText');
const labelMd = $('pgLabelMd');
const emptyState = $('pgEmptyState');
const loadingEl = $('pgLoading');
const errorEl = $('pgError');
const textOut = $<HTMLPreElement>('pgTextOut');
const mdOut = $('pgMdOut');
const pager = $('pgPager');
const btnAll = $<HTMLButtonElement>('pgBtnAll');
const btnPrev = $<HTMLButtonElement>('pgBtnPrev');
const btnNext = $<HTMLButtonElement>('pgBtnNext');
const pageBtns = $('pgPageBtns');
const pagerInfo = $('pgPagerInfo');

const metaEls = {
  pages: $('pgMetaPages'),
  title: $('pgMetaTitle'),
  author: $('pgMetaAuthor'),
  subject: $('pgMetaSubject'),
  creator: $('pgMetaCreator'),
  producer: $('pgMetaProducer'),
  created: $('pgMetaCreated'),
  modified: $('pgMetaModified'),
};

let pageTexts: string[] = [];
let pageMds: string[] = [];
let fullText = '';
let fullMd = '';
let currentPage = -1;
let isMarkdownMode = false;

marked.setOptions({ breaks: true, gfm: true });

function setMeta(el: HTMLElement, value: string | null | undefined) {
  if (value) {
    el.textContent = value;
    el.classList.remove('empty');
  } else {
    el.textContent = '--';
    el.classList.add('empty');
  }
}

function formatPdfDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return raw;
  const [, y, mo, d, h, min, s] = m;
  return new Date(`${y}-${mo}-${d}T${h || '00'}:${min || '00'}:${s || '00'}`)
    .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function clearError() {
  errorEl.style.display = 'none';
}

function getActiveText(): string {
  if (isMarkdownMode) {
    return currentPage === -1 ? fullMd : (pageMds[currentPage] ?? '');
  }
  return currentPage === -1 ? fullText : (pageTexts[currentPage] ?? '');
}

function renderSanitizedHtml(container: HTMLElement, markdownText: string) {
  const rawHtml = marked.parse(markdownText) as string;
  const clean = DOMPurify.sanitize(rawHtml);
  container.replaceChildren();
  const template = document.createElement('template');
  template.innerHTML = clean;
  container.appendChild(template.content);
}

function render() {
  const text = getActiveText();
  if (!text && currentPage !== -1) {
    textOut.textContent = '(empty page)';
    textOut.style.display = 'block';
    mdOut.style.display = 'none';
    return;
  }
  if (!text) return;

  if (isMarkdownMode) {
    textOut.style.display = 'none';
    renderSanitizedHtml(mdOut, text);
    mdOut.style.display = 'block';
  } else {
    mdOut.style.display = 'none';
    textOut.textContent = text;
    textOut.style.display = 'block';
  }
}

function makePageBtn(idx: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'pg-pager-btn' + (currentPage === idx ? ' active' : '');
  btn.textContent = String(idx + 1);
  btn.addEventListener('click', () => goToPage(idx));
  return btn;
}

function buildPageButtons() {
  pageBtns.replaceChildren();
  const total = pageTexts.length;
  if (total === 0) return;

  const maxVisible = 7;
  let start = 0;
  let end = total - 1;

  if (total > maxVisible) {
    const active = currentPage === -1 ? 0 : currentPage;
    const half = Math.floor(maxVisible / 2);
    start = Math.max(0, active - half);
    end = start + maxVisible - 1;
    if (end >= total) {
      end = total - 1;
      start = Math.max(0, end - maxVisible + 1);
    }
  }

  if (start > 0) {
    pageBtns.appendChild(makePageBtn(0));
    if (start > 1) {
      const dots = document.createElement('span');
      dots.textContent = '\u2026';
      dots.style.cssText = 'padding:0 3px;color:var(--text-secondary);font-size:12px;';
      pageBtns.appendChild(dots);
    }
  }

  for (let i = start; i <= end; i++) pageBtns.appendChild(makePageBtn(i));

  if (end < total - 1) {
    if (end < total - 2) {
      const dots = document.createElement('span');
      dots.textContent = '\u2026';
      dots.style.cssText = 'padding:0 3px;color:var(--text-secondary);font-size:12px;';
      pageBtns.appendChild(dots);
    }
    pageBtns.appendChild(makePageBtn(total - 1));
  }
}

function updatePager() {
  const total = pageTexts.length;
  btnAll.classList.toggle('active', currentPage === -1);
  btnPrev.disabled = currentPage <= 0;
  btnNext.disabled = currentPage === -1 || currentPage >= total - 1;
  pagerInfo.textContent = currentPage === -1
    ? `${total} page${total !== 1 ? 's' : ''}`
    : `Page ${currentPage + 1} of ${total}`;
  buildPageButtons();
}

function goToPage(idx: number) {
  currentPage = idx;
  updatePager();
  render();
}

btnAll.addEventListener('click', () => goToPage(-1));
btnPrev.addEventListener('click', () => { if (currentPage > 0) goToPage(currentPage - 1); });
btnNext.addEventListener('click', () => { if (currentPage < pageTexts.length - 1) goToPage(currentPage + 1); });

modeToggle.addEventListener('change', () => {
  isMarkdownMode = modeToggle.checked;
  labelText.classList.toggle('active', !isMarkdownMode);
  labelMd.classList.toggle('active', isMarkdownMode);
  render();
});

fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  clearError();
  fileNameEl.textContent = file.name;
  emptyState.style.display = 'none';
  textOut.style.display = 'none';
  mdOut.style.display = 'none';
  loadingEl.style.display = 'flex';

  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const doc = Extractly.fromBuffer(bytes);

    fullText = doc.text;
    fullMd = docToMarkdown(doc);
    pageTexts = doc.pages.map(p => p.text);
    pageMds = doc.pages.map(p => pageToMarkdown(p));
    currentPage = -1;

    setMeta(metaEls.pages, String(doc.pageCount));
    setMeta(metaEls.title, doc.metadata.title);
    setMeta(metaEls.author, doc.metadata.author);
    setMeta(metaEls.subject, doc.metadata.subject);
    setMeta(metaEls.creator, doc.metadata.creator);
    setMeta(metaEls.producer, doc.metadata.producer);
    setMeta(metaEls.created, formatPdfDate(doc.metadata.creationDate));
    setMeta(metaEls.modified, formatPdfDate(doc.metadata.modDate));

    loadingEl.style.display = 'none';
    pager.style.display = 'flex';
    updatePager();
    render();

    doc.dispose();
  } catch (err) {
    loadingEl.style.display = 'none';
    showError(`Failed to parse PDF: ${(err as Error).message}`);
    console.error(err);
  }
});
