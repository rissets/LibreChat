import { useState } from 'react';
import * as Ariakit from '@ariakit/react';
import { Button } from '@librechat/client';
import { ChevronDown, Code2, FileDown, FileType2, LoaderCircle, Presentation } from 'lucide-react';
import PptxGenJS from 'pptxgenjs';
import { toPng } from 'html-to-image';
import type { Artifact } from '~/common';
import { useLocalize } from '~/hooks';

const PRESENTATION_MARKER = /hellodigi-artifact-kind["']?\s+content=["']presentation/i;

export function supportsPresentationExport(artifact: Artifact): boolean {
  return artifact.type === 'text/html' && PRESENTATION_MARKER.test(artifact.content ?? '');
}

function safeName(title?: string): string {
  const normalized = (title ?? 'HelloDigi presentation')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim();
  return normalized || 'HelloDigi presentation';
}

function presentationPages(content: string): string {
  const source = new DOMParser().parseFromString(content, 'text/html');
  const slides = Array.from(source.querySelectorAll<HTMLElement>('.hd-slide, [data-slide]'));
  if (slides.length === 0) {
    return content;
  }
  const styles = Array.from(source.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((element) => element.outerHTML)
    .join('\n');
  return `<!doctype html><html><head>${styles}</head><body>${slides
    .map((slide) => slide.outerHTML)
    .join('\n')}</body></html>`;
}

function printPresentation(content: string, title: string) {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer');
  if (!printWindow) {
    throw new Error('Pop-up blocked');
  }
  const printStyles = `
    <style>
      @page { size: 13.333in 7.5in; margin: 0; }
      html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
      .hd-slide, [data-slide] { width: 13.333in !important; height: 7.5in !important; margin: 0 !important; break-after: page; page-break-after: always; overflow: hidden !important; }
      .hd-slide:last-child, [data-slide]:last-child { break-after: auto; page-break-after: auto; }
    </style>`;
  const pagesOnly = presentationPages(content);
  const documentContent = pagesOnly.includes('</head>')
    ? pagesOnly.replace('</head>', `<title>${title}</title>${printStyles}</head>`)
    : `${printStyles}${pagesOnly}`;
  printWindow.document.open();
  printWindow.document.write(documentContent);
  printWindow.document.close();
  printWindow.addEventListener(
    'load',
    () => {
      printWindow.focus();
      printWindow.print();
    },
    { once: true },
  );
}

function downloadHtml(content: string, title: string) {
  const url = window.URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${title}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function pptxColor(value: string): string {
  const rgb = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((channel) => Number(channel).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }
  return value.startsWith('#') ? value.slice(1).toUpperCase() : '111111';
}

async function exportPresentationPptx(content: string, title: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText =
    'position:fixed;left:-100000px;top:0;width:1280px;height:720px;border:0;pointer-events:none;';
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Unable to render slides'));
      frame.srcdoc = content;
    });
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const slideElements = Array.from(
      frame.contentDocument?.querySelectorAll<HTMLElement>('.hd-slide, [data-slide]') ?? [],
    );
    if (slideElements.length === 0) {
      throw new Error('No slide elements found');
    }
    const presentation = new PptxGenJS();
    presentation.layout = 'LAYOUT_WIDE';
    presentation.author = 'HelloDigi';
    presentation.subject = title;
    presentation.title = title;
    presentation.company = 'HelloDigi';
    for (const element of slideElements) {
      element.style.width = '1280px';
      element.style.height = '720px';
      element.style.margin = '0';
      const slideRect = element.getBoundingClientRect();
      const editableText = Array.from(element.querySelectorAll<HTMLElement>('*'))
        .filter(
          (candidate) =>
            candidate.children.length === 0 &&
            candidate.textContent?.trim() &&
            !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(candidate.tagName),
        )
        .map((candidate) => ({
          candidate,
          cssText: candidate.style.cssText,
          text: candidate.textContent?.trim() ?? '',
          rect: candidate.getBoundingClientRect(),
          style: window.getComputedStyle(candidate),
        }))
        .filter(({ rect, style }) =>
          Boolean(rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden'),
        );
      editableText.forEach(({ candidate }) => {
        candidate.style.setProperty('color', 'transparent', 'important');
        candidate.style.setProperty('text-shadow', 'none', 'important');
      });
      const data = await toPng(element, {
        cacheBust: true,
        pixelRatio: 1.5,
        width: 1280,
        height: 720,
        backgroundColor: window.getComputedStyle(element).backgroundColor || '#ffffff',
      });
      editableText.forEach(({ candidate, cssText }) => {
        candidate.style.cssText = cssText;
      });
      const slide = presentation.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addImage({ data, x: 0, y: 0, w: 13.333, h: 7.5 });
      editableText.forEach(({ text, rect, style }) => {
        const fontWeight = Number.parseInt(style.fontWeight, 10);
        slide.addText(text, {
          x: Math.max(0, (rect.left - slideRect.left) / 96),
          y: Math.max(0, (rect.top - slideRect.top) / 96),
          w: Math.max(0.1, rect.width / 96),
          h: Math.max(0.1, rect.height / 96),
          fontFace: style.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() || 'Arial',
          fontSize: Math.max(6, Number.parseFloat(style.fontSize) * 0.75),
          color: pptxColor(style.color),
          bold: Number.isFinite(fontWeight) ? fontWeight >= 600 : style.fontWeight === 'bold',
          italic: style.fontStyle === 'italic',
          align:
            style.textAlign === 'center' || style.textAlign === 'right' ? style.textAlign : 'left',
          valign: 'middle',
          margin: 0,
          breakLine: false,
          fit: 'shrink',
        });
      });
    }
    await presentation.writeFile({ fileName: `${title}.pptx`, compression: true });
  } finally {
    frame.remove();
  }
}

export default function PresentationExport({ artifact }: { artifact: Artifact }) {
  const localize = useLocalize();
  const [busy, setBusy] = useState<'pptx' | 'pdf' | 'html' | null>(null);
  const content = artifact.content ?? '';
  const title = safeName(artifact.title);

  const runExport = async (format: 'pptx' | 'pdf' | 'html') => {
    setBusy(format);
    try {
      if (format === 'pptx') {
        await exportPresentationPptx(content, title);
      } else if (format === 'pdf') {
        printPresentation(content, title);
      } else {
        downloadHtml(content, title);
      }
    } catch (error) {
      console.error('Presentation export failed:', error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Ariakit.MenuProvider>
      <Ariakit.MenuButton
        render={<Button size="sm" variant="outline" className="h-9 gap-1.5" />}
        disabled={busy != null}
        aria-label={localize('com_ui_export_presentation')}
      >
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <FileDown className="size-4" aria-hidden="true" />
        )}
        <span className="hidden lg:inline">{localize('com_ui_export_presentation')}</span>
        <ChevronDown className="size-3.5" aria-hidden="true" />
      </Ariakit.MenuButton>
      <Ariakit.Menu
        gutter={4}
        portal
        className="z-[100] min-w-52 rounded-xl border border-border-light bg-surface-secondary p-1.5 shadow-lg"
      >
        <Ariakit.MenuItem
          className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-primary outline-none hover:bg-surface-hover data-[active-item]:bg-surface-hover"
          onClick={() => void runExport('pptx')}
        >
          <Presentation className="size-4" aria-hidden="true" />
          {localize('com_ui_export_pptx')}
        </Ariakit.MenuItem>
        <Ariakit.MenuItem
          className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-primary outline-none hover:bg-surface-hover data-[active-item]:bg-surface-hover"
          onClick={() => void runExport('pdf')}
        >
          <FileType2 className="size-4" aria-hidden="true" />
          {localize('com_ui_export_pdf')}
        </Ariakit.MenuItem>
        <Ariakit.MenuItem
          className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-text-primary outline-none hover:bg-surface-hover data-[active-item]:bg-surface-hover"
          onClick={() => void runExport('html')}
        >
          <Code2 className="size-4" aria-hidden="true" />
          {localize('com_ui_export_html')}
        </Ariakit.MenuItem>
      </Ariakit.Menu>
    </Ariakit.MenuProvider>
  );
}
