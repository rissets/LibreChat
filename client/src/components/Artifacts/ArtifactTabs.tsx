import { lazy, Suspense, useEffect, useRef } from 'react';
import { Spinner } from '@librechat/client';
import * as Tabs from '@radix-ui/react-tabs';
import type { SandpackPreviewRef } from '@codesandbox/sandpack-react/unstyled';
import type { editor } from 'monaco-editor';
import type { ProcessedMermaidSvg } from '~/utils/diagram/export';
import { MermaidRenderer } from '~/components/Messages/Content/Mermaid/Mermaid';
import { MERMAID_ARTIFACT_TYPE, type Artifact } from '~/common/artifacts';
import { TOOL_ARTIFACT_TYPES } from '~/utils/artifacts';
import { ArtifactCodeEditor } from './ArtifactCodeEditor';
import { useCodeState } from '~/Providers/EditorContext';
import { useLocalize } from '~/hooks';
import { SvgArtifactPreview } from './InlineDataArtifactPreview';

const SandboxArtifactTabs = lazy(() => import('./SandboxArtifactTabs'));

interface ArtifactTabsProps {
  artifact: Artifact;
  previewRef: React.MutableRefObject<SandpackPreviewRef>;
  isSharedConvo?: boolean;
  onMermaidExportReady?: (data: ProcessedMermaidSvg | null) => void;
}

function LoadingArtifactTabs() {
  const localize = useLocalize();

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-surface-primary text-text-secondary"
      role="status"
    >
      <Spinner className="size-5" aria-hidden="true" />
      <span className="sr-only">{localize('com_ui_loading')}</span>
    </div>
  );
}

function MermaidArtifactTabs({
  artifact,
  isSharedConvo,
  onMermaidExportReady,
}: Omit<ArtifactTabsProps, 'previewRef'>) {
  const localize = useLocalize();
  const { currentCode, setCurrentCode } = useCodeState();
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const lastIdRef = useRef<string | null>(null);

  /* The reset below only lands after commit, so on the render that switches
   * artifacts `currentCode` still holds the previous artifact's editor text.
   * Ignore it until the reset catches up, or the freshly keyed renderer would
   * mount showing (and exporting) the diagram we just navigated away from. */
  const hasCurrentArtifactCode = lastIdRef.current === artifact.id;

  useEffect(() => {
    if (artifact.id !== lastIdRef.current) {
      setCurrentCode(undefined);
    }
    lastIdRef.current = artifact.id;
  }, [artifact.id, setCurrentCode]);

  const content = (hasCurrentArtifactCode ? currentCode : undefined) ?? artifact.content ?? '';
  const isReadOnly = isSharedConvo === true || artifact.index == null;

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs.Content
        value="code"
        id="artifacts-code"
        className="h-full w-full flex-grow overflow-auto"
        tabIndex={-1}
      >
        <ArtifactCodeEditor artifact={artifact} monacoRef={monacoRef} readOnly={isReadOnly} />
      </Tabs.Content>

      <Tabs.Content
        value="preview"
        className="min-h-0 w-full flex-1 overflow-hidden p-4"
        tabIndex={-1}
      >
        {/* Keyed by artifact so switching between two diagrams cannot carry the
            previous render, its dimensions, or its export payload across the
            boundary while the new source debounces. */}
        <MermaidRenderer
          key={artifact.id}
          exportFilename={artifact.title ?? localize('com_ui_mermaid_diagram')}
          fillContainer
          onExportReady={onMermaidExportReady}
          showExpandButton={false}
          showHeader={false}
        >
          {content}
        </MermaidRenderer>
      </Tabs.Content>
    </div>
  );
}

function SvgArtifactTabs({ artifact, isSharedConvo }: Omit<ArtifactTabsProps, 'previewRef'>) {
  const monacoRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  return (
    <div className="flex h-full w-full flex-col">
      <Tabs.Content
        value="code"
        id="artifacts-code"
        className="h-full w-full flex-grow overflow-auto"
        tabIndex={-1}
      >
        <ArtifactCodeEditor artifact={artifact} monacoRef={monacoRef} readOnly={isSharedConvo === true} />
      </Tabs.Content>
      <Tabs.Content
        value="preview"
        className="h-full w-full flex-grow overflow-hidden"
        tabIndex={-1}
      >
        <SvgArtifactPreview content={artifact.content ?? ''} title={artifact.title} fillContainer />
      </Tabs.Content>
    </div>
  );
}

export default function ArtifactTabs(props: ArtifactTabsProps) {
  if (props.artifact.type === MERMAID_ARTIFACT_TYPE) {
    return (
      <MermaidArtifactTabs
        artifact={props.artifact}
        isSharedConvo={props.isSharedConvo}
        onMermaidExportReady={props.onMermaidExportReady}
      />
    );
  }

  if (props.artifact.type === TOOL_ARTIFACT_TYPES.SVG) {
    return <SvgArtifactTabs artifact={props.artifact} isSharedConvo={props.isSharedConvo} />;
  }

  return (
    <Suspense fallback={<LoadingArtifactTabs />}>
      <SandboxArtifactTabs {...props} />
    </Suspense>
  );
}
