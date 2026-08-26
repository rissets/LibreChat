import { useMemo, useState } from 'react';
import { useRecoilState } from 'recoil';
import {
  AppWindow,
  BarChart3,
  Blocks,
  ChevronDown,
  Database,
  FileText,
  FileSpreadsheet,
  Gamepad2,
  GitBranch,
  Globe2,
  Image,
  Layers3,
  LayoutTemplate,
  MessageSquare,
  Mic2,
  MoreHorizontal,
  Presentation,
  Search,
  Timer,
  Video,
} from 'lucide-react';
import { AgentCapabilities, ArtifactModes, Constants, Tools } from 'librechat-data-provider';
import type { LucideIcon } from 'lucide-react';
import { useChatFormContext } from '~/Providers';
import { mainTextareaId } from '~/common';
import { ephemeralAgentByConvoId } from '~/store';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export type ModeId =
  | 'slides'
  | 'website'
  | 'design'
  | 'games'
  | 'apps'
  | 'document'
  | 'diagram'
  | 'digital-twin'
  | 'google-workspace'
  | 'image-studio'
  | 'video'
  | 'schedule'
  | 'research'
  | 'spreadsheet'
  | 'visualization'
  | 'audio'
  | 'chat'
  | 'playbook';

export interface CreationMode {
  id: ModeId;
  label: string;
  description: string;
  icon: LucideIcon;
  prompt: string;
  artifacts?: ArtifactModes;
  code?: boolean;
  research?: boolean;
  examples: string[];
}

export const PRIMARY_MODES: CreationMode[] = [
  {
    id: 'slides',
    label: 'Buat slide',
    description: 'Presentasi editable dengan ekspor PPTX dan PDF.',
    icon: Presentation,
    artifacts: ArtifactModes.PRESENTATION,
    code: true,
    prompt:
      'Buat presentasi dengan engine HTML 16:9 yang dapat diedit langsung di Artifact. Artifact hanya menampilkan kanvas slide per halaman dan navigasi slide—tanpa catatan, metadata, atau panel penjelasan. Gunakan SVG, gambar, graph, chart, dan diagram bila relevan serta sediakan ekspor PPTX dan PDF. Topiknya: ',
    examples: [
      'Laporan status mingguan tim, 8 slide',
      'Pitch deck produk SaaS, 10 slide',
      'Business review dengan KPI dan chart',
      'Proposal pertumbuhan dengan proyeksi',
    ],
  },
  {
    id: 'website',
    label: 'Buat website',
    description: 'Aplikasi web responsif yang siap dipublikasikan.',
    icon: Globe2,
    artifacts: ArtifactModes.WEB,
    code: true,
    prompt:
      'Bangun website yang benar-benar selesai, responsif, dan siap dipublikasikan—bukan sekadar mockup. Implementasikan source code, interaksi, state, validasi, serta pengujian yang relevan; render hasilnya langsung di Artifact. Kebutuhannya: ',
    examples: [
      'Landing page produk dengan form aktif',
      'Dashboard operasi responsif',
      'Portal katalog dengan pencarian dan filter',
      'Microsite event dengan registrasi',
    ],
  },
  {
    id: 'design',
    label: 'Design',
    description: 'Poster, brand, dan UI visual yang dapat diedit.',
    icon: Image,
    artifacts: ArtifactModes.DESIGN,
    prompt:
      'Buat desain visual lengkap dan editable langsung di Artifact. Gunakan SVG/HTML untuk desain terstruktur atau image generation untuk raster; tampilkan hasil, layer/elemen yang bisa dipilih, dan kontrol style langsung di Artifact. Brief desain: ',
    examples: [
      'Infografik data vertikal untuk media sosial',
      'Poster peluncuran produk',
      'Brand kit modern dan minimalis',
      'UI aplikasi mobile yang tenang',
    ],
  },
  {
    id: 'games',
    label: 'Buat game',
    description: 'Game web interaktif yang langsung dapat dimainkan.',
    icon: Gamepad2,
    artifacts: ArtifactModes.WEB,
    code: true,
    prompt:
      'Bangun game web yang dapat langsung dimainkan di Artifact. Implementasikan mekanik, state, scoring, restart, responsivitas, dan uji alur utamanya. Konsep game: ',
    examples: [
      'Game puzzle data dengan skor dan timer',
      'Game edukasi keselamatan kerja',
      'Endless runner bertema kota pintar',
      'Simulasi strategi rantai pasok',
    ],
  },
];

export const MORE_MODES: CreationMode[] = [
  {
    id: 'apps',
    label: 'Kembangkan aplikasi',
    description: 'Aplikasi React end-to-end dengan Tailwind dan shadcn/ui.',
    icon: AppWindow,
    artifacts: ArtifactModes.SHADCNUI,
    code: true,
    prompt:
      'Bangun aplikasi React end-to-end dengan Tailwind dan komponen shadcn/ui yang tersedia. Buat source multi-file, state, validasi, sample data, serta pengujian alur utama; render satu preview runnable di Artifact. Aplikasinya: ',
    examples: [
      'Aplikasi inspeksi lapangan offline-first',
      'CRM sederhana dengan pipeline penjualan',
      'Kalkulator biaya operasional interaktif',
      'Portal approval dengan riwayat audit',
    ],
  },
  {
    id: 'document',
    label: 'Dokumen',
    description: 'Dokumen profesional untuk dibuat, diperbarui, dan dibagikan.',
    icon: FileText,
    artifacts: ArtifactModes.DOCUMENT,
    code: true,
    prompt:
      'Buat dokumen DOCX yang lengkap, profesional, dan terstruktur. Render dokumennya di Artifact, simpan file asli, serta siapkan opsi edit melalui Google Docs bila koneksi tersedia. Kebutuhan dokumen: ',
    examples: [
      'Proposal proyek dengan ruang lingkup dan biaya',
      'Laporan bulanan dengan tabel KPI',
      'SOP operasional dengan matriks RACI',
      'Notulen rapat dengan action items',
    ],
  },
  {
    id: 'diagram',
    label: 'Diagram',
    description: 'Flow, ERD, sequence, dan arsitektur yang dapat dieksplorasi.',
    icon: GitBranch,
    artifacts: ArtifactModes.DIAGRAM,
    prompt:
      'Buat diagram yang jelas dan langsung dirender di chat. Gunakan Mermaid untuk flow, sequence, ERD, state, atau arsitektur; gunakan HTML/SVG interaktif jika perlu zoom, filter, tooltip, atau drill-down. Diagramnya: ',
    examples: [
      'Diagram arsitektur agentic AI dan MCP',
      'Sequence diagram proses approval',
      'ERD sistem inventori multi-gudang',
      'Flow proses insiden dan eskalasi',
    ],
  },
  {
    id: 'digital-twin',
    label: '3D & digital twin',
    description: 'Model Three.js dengan kontrol kamera dan data operasional.',
    icon: Layers3,
    artifacts: ArtifactModes.WEB,
    code: true,
    prompt:
      'Bangun pengalaman 3D atau digital twin interaktif dengan Three.js di Artifact. Sertakan kontrol kamera, objek yang dapat dipilih, status/data contoh, legenda, dan source code lengkap. Kebutuhannya: ',
    examples: [
      'Digital twin gudang dengan status zona',
      'Peta 3D pabrik dan sensor IoT',
      'Viewer produk 3D dengan hotspot',
      'Simulasi aliran kendaraan kawasan',
    ],
  },
  {
    id: 'google-workspace',
    label: 'Google Workspace',
    description: 'Buat, cari, baca, dan edit file Workspace yang terhubung.',
    icon: Database,
    artifacts: ArtifactModes.DOCUMENT,
    prompt:
      'Gunakan koneksi Google Workspace yang tersedia untuk membuat, menemukan, membaca, atau memperbarui file di Drive serta menyiapkan hasil yang dapat diedit di Docs, Sheets, atau Slides. Tugasnya: ',
    examples: [
      'Buat laporan ini sebagai Google Docs',
      'Ubah data lokal menjadi Google Sheets',
      'Cari dan rangkum file terbaru di Drive',
      'Siapkan presentasi yang dapat diedit di Slides',
    ],
  },
  {
    id: 'image-studio',
    label: 'Gambar & poster',
    description: 'Aset visual, infografik, dan SVG siap ekspor.',
    icon: Image,
    artifacts: ArtifactModes.DESIGN,
    prompt:
      'Buat gambar, poster, infografik, atau aset visual siap pakai. Gunakan SVG/HTML untuk elemen editable dan image generation untuk raster. Sertakan ukuran ekspor dan aset sumber. Brief: ',
    examples: [
      'Poster kampanye keselamatan A3',
      'Infografik vertikal untuk Instagram',
      'Banner peluncuran produk 16:9',
      'Set ikon SVG untuk dashboard IoT',
    ],
  },
  {
    id: 'video',
    label: 'Video',
    description: 'Storyboard, naskah, shot list, dan paket produksi video.',
    icon: Video,
    code: true,
    prompt: 'Buat konsep, storyboard, shot list, naskah, dan aset produksi video untuk: ',
    examples: [
      'Video profil perusahaan 90 detik',
      'Explainer produk dengan enam adegan',
      'Storyboard kampanye keselamatan',
      'Naskah demo aplikasi untuk media sosial',
    ],
  },
  {
    id: 'schedule',
    label: 'Tugas terjadwal',
    description: 'Rencana agentic berulang dengan input, aksi, dan laporan.',
    icon: Timer,
    prompt:
      'Rancang tugas agentic terjadwal berikut, termasuk jadwal, input, action, dan laporan hasil: ',
    examples: [
      'Ringkasan operasional setiap Senin pagi',
      'Pantau anomali data setiap 30 menit',
      'Kirim laporan pipeline tiap akhir bulan',
      'Audit file Drive yang berubah setiap hari',
    ],
  },
  {
    id: 'research',
    label: 'Wide Research',
    description: 'Riset berbasis sumber dengan perbandingan dan rekomendasi.',
    icon: Search,
    research: true,
    code: true,
    prompt:
      'Lakukan riset luas berbasis sumber primer dan terbaru. Bandingkan temuan, kutip sumber, olah data bila perlu, lalu sajikan kesimpulan dan rekomendasi. Topik: ',
    examples: [
      'Bandingkan platform agentic AI open source',
      'Riset MCP database production-ready',
      'Analisis tren pasar energi terbaru',
      'Benchmark editor presentasi berbasis web',
    ],
  },
  {
    id: 'spreadsheet',
    label: 'Spreadsheet',
    description: 'Workbook formula, validasi, chart, dan ringkasan data.',
    icon: FileSpreadsheet,
    artifacts: ArtifactModes.DOCUMENT,
    code: true,
    prompt:
      'Buat workbook XLSX native yang lengkap dengan formula, format, validasi, dan chart bila relevan. Render sheet langsung di Artifact dan berikan file XLSX asli. Kebutuhan: ',
    examples: [
      'Workbook anggaran dengan formula dan chart',
      'Dashboard penjualan dari file CSV lokal',
      'Model cash-flow 12 bulan',
      'Tracker proyek dengan validasi status',
    ],
  },
  {
    id: 'visualization',
    label: 'Visualisasi',
    description: 'Chart, peta, dan dashboard yang dapat difilter.',
    icon: BarChart3,
    artifacts: ArtifactModes.DATA,
    code: true,
    prompt:
      'Buat visualisasi data interaktif yang langsung dirender di Artifact, lengkap dengan label, tooltip, filter, dan insight utama. Data atau pertanyaannya: ',
    examples: [
      'Dashboard KPI dengan filter waktu',
      'Grafik tren dan proyeksi interaktif',
      'Peta panas performa per wilayah',
      'Sankey aliran proses dan biaya',
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    description: 'Naskah, audio, transkrip, dan workflow suara.',
    icon: Mic2,
    code: true,
    prompt: 'Buat aset atau workflow audio berikut dan berikan hasil yang dapat diputar: ',
    examples: [
      'Naskah podcast dan intro audio',
      'Voice-over demo produk 60 detik',
      'Soundscape untuk video profil',
      'Transkripsi dan ringkasan rekaman',
    ],
  },
  {
    id: 'chat',
    label: 'Mode chat',
    description: 'Diskusi, penjelasan, evaluasi, dan perencanaan cepat.',
    icon: MessageSquare,
    prompt: '',
    examples: [
      'Jelaskan topik ini dengan ringkas',
      'Bantu saya menyusun rencana kerja',
      'Tinjau ide dan risiko berikut',
      'Diskusikan beberapa alternatif solusi',
    ],
  },
  {
    id: 'playbook',
    label: 'Playbook',
    description: 'Prosedur kerja berulang dengan keputusan dan acceptance criteria.',
    icon: Blocks,
    artifacts: ArtifactModes.DEFAULT,
    prompt:
      'Buat playbook operasional yang dapat digunakan ulang, lengkap dengan langkah, keputusan, input, output, guardrail, dan acceptance criteria. Prosesnya: ',
    examples: [
      'Playbook respons insiden layanan',
      'Playbook onboarding pelanggan enterprise',
      'Playbook inspeksi dan handover aset',
      'Playbook riset hingga keputusan investasi',
    ],
  },
];

export function buildCreationModePrompt(mode: CreationMode, example = ''): string {
  return `${mode.prompt}${example}`;
}

function ModeButton({
  mode,
  selected,
  onSelect,
}: {
  mode: CreationMode;
  selected: boolean;
  onSelect: (mode: CreationMode) => void;
}) {
  const Icon = mode.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(mode)}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
        selected
          ? 'border-ring-primary bg-surface-active-alt text-text-primary'
          : 'border-border-light bg-surface-primary text-text-primary hover:bg-surface-hover',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {mode.label}
    </button>
  );
}

export default function CreationModes({ conversationId }: { conversationId?: string | null }) {
  const localize = useLocalize();
  const methods = useChatFormContext();
  const key = conversationId ?? Constants.NEW_CONVO;
  const [agent, setAgent] = useRecoilState(ephemeralAgentByConvoId(key));
  const [selectedId, setSelectedId] = useState<ModeId | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  const selectedMode = useMemo(
    () => [...PRIMARY_MODES, ...MORE_MODES].find((mode) => mode.id === selectedId),
    [selectedId],
  );
  const exampleMode = selectedMode ?? PRIMARY_MODES[0];
  const selectedMoreMode = selectedMode && MORE_MODES.some((mode) => mode.id === selectedMode.id);

  const selectMode = (mode: CreationMode) => {
    setSelectedId(mode.id);
    setMoreOpen(false);
    setAgent({
      ...(agent ?? {}),
      [AgentCapabilities.artifacts]: mode.artifacts ?? '',
      [Tools.execute_code]: mode.code === true,
      [Tools.web_search]: mode.research === true,
    });
    const value = buildCreationModePrompt(mode);
    methods.setValue('text', value, { shouldDirty: true, shouldValidate: true });
    requestAnimationFrame(() => {
      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      textarea?.focus();
      textarea?.setSelectionRange(value.length, value.length);
    });
  };

  return (
    <section className="mt-4 w-full" aria-label="Mode pembuatan HelloDigi">
      <div className="relative flex w-full items-start gap-2">
        <div className="scrollbar-hide flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {PRIMARY_MODES.map((mode) => (
            <ModeButton
              key={mode.id}
              mode={mode}
              selected={selectedId === mode.id}
              onSelect={selectMode}
            />
          ))}
        </div>
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMoreOpen((current) => !current)}
            aria-expanded={moreOpen}
            aria-label="Pilih kemampuan lainnya"
            className={cn(
              'inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium text-text-primary transition-colors',
              selectedMoreMode
                ? 'border-ring-primary bg-surface-active-alt'
                : 'border-border-light bg-surface-primary hover:bg-surface-hover',
            )}
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
            {selectedMoreMode ? `More · ${selectedMode.label}` : localize('com_ui_more')}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </button>
          {moreOpen && (
            <div
              role="menu"
              aria-label="Kemampuan lainnya"
              className="absolute right-0 top-12 z-50 max-h-[65vh] w-80 overflow-y-auto rounded-2xl border border-border-light bg-surface-primary p-2 shadow-xl"
            >
              <div className="px-3 pb-2 pt-1">
                <p className="text-sm font-semibold text-text-primary">Kemampuan lainnya</p>
                <p className="mt-0.5 text-xs text-text-secondary">Pilih mode untuk memuat instruksi dan contoh yang sesuai.</p>
              </div>
              {MORE_MODES.map((mode) => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="menuitem"
                    aria-pressed={selectedId === mode.id}
                    onClick={() => selectMode(mode)}
                    className={cn(
                      'flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover',
                      selectedId === mode.id && 'bg-surface-active-alt',
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
                    <span>
                      <span className="block text-sm font-medium text-text-primary">{mode.label}</span>
                      <span className="mt-0.5 block text-xs leading-4 text-text-secondary">{mode.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Contoh {exampleMode.label}</h2>
            <p className="mt-0.5 text-xs text-text-secondary">{exampleMode.description}</p>
          </div>
          <span className="shrink-0 text-xs text-text-secondary">{exampleMode.examples.length} contoh</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {exampleMode.examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                const value = buildCreationModePrompt(exampleMode, example);
                methods.setValue('text', value, { shouldDirty: true, shouldValidate: true });
                document.getElementById(mainTextareaId)?.focus();
              }}
              className="min-h-20 rounded-2xl border border-border-light bg-surface-primary p-3 text-left text-xs leading-5 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <LayoutTemplate className="mb-2 size-4" aria-hidden="true" />
              {example}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
