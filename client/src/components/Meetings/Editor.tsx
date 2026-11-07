import { useEffect, useRef, useState } from 'react';
import { Button } from '@librechat/client';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { Bold, Italic, Heading2, List, ListOrdered, Undo2, Redo2 } from 'lucide-react';
import { useLocalize } from '~/hooks';

/** Rich editing, clipboard and undo belong to the editor; autosave still owns Markdown. */
export default function Editor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const localize = useLocalize();
  const accepted = useRef(value);
  const update = useRef(onChange);
  update.current = onChange;
  const [tooLong, setTooLong] = useState(false);
  const [document, setDocument] = useState({ revision: 0, content: value });
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [2] }, link: false, underline: false }),
        Markdown,
      ],
      content: document.content,
      contentType: 'markdown',
      editable: !disabled,
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-label': localize('com_meeting_workspace_notes'),
          'aria-multiline': 'true',
          class:
            'text-text-primary min-h-[300px] outline-none text-base leading-7 break-words [&_p]:my-2 [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_blockquote]:pl-4 [&_blockquote]:italic',
        },
      },
      onUpdate: ({ editor: current }) => {
        const markdown = current.getMarkdown();
        if (markdown.length > 16000) {
          setTooLong(true);
          setDocument((previous) => ({
            revision: previous.revision + 1,
            content: accepted.current,
          }));
          return;
        }
        setTooLong(false);
        accepted.current = markdown;
        update.current(markdown);
      },
    },
    [document.revision],
  );
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      empty: current?.isEmpty ?? true,
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      heading: current?.isActive('heading') ?? false,
      bullets: current?.isActive('bulletList') ?? false,
      numbered: current?.isActive('orderedList') ?? false,
      undo: current?.can().undo() ?? false,
      redo: current?.can().redo() ?? false,
    }),
  });
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);
  useEffect(() => {
    if (!editor || value === accepted.current) return;
    accepted.current = value;
    // Server drafts are a fresh document, not a user edit that Undo can erase.
    setDocument((previous) => ({ revision: previous.revision + 1, content: value }));
  }, [editor, value]);
  const controls = [
    {
      icon: Bold,
      key: 'com_meeting_editor_bold',
      active: state?.bold,
      run: () => editor?.chain().focus().toggleBold().run(),
    },
    {
      icon: Italic,
      key: 'com_meeting_editor_italic',
      active: state?.italic,
      run: () => editor?.chain().focus().toggleItalic().run(),
    },
    {
      icon: Heading2,
      key: 'com_meeting_editor_heading',
      active: state?.heading,
      run: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      icon: List,
      key: 'com_meeting_editor_bullets',
      active: state?.bullets,
      run: () => editor?.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      key: 'com_meeting_editor_numbered',
      active: state?.numbered,
      run: () => editor?.chain().focus().toggleOrderedList().run(),
    },
    {
      icon: Undo2,
      key: 'com_meeting_editor_undo',
      unavailable: !state?.undo,
      run: () => editor?.chain().focus().undo().run(),
    },
    {
      icon: Redo2,
      key: 'com_meeting_editor_redo',
      unavailable: !state?.redo,
      run: () => editor?.chain().focus().redo().run(),
    },
  ] as const;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        role="toolbar"
        aria-label={localize('com_meeting_editor_toolbar')}
        className="border-border-light flex flex-wrap gap-1 border-b pb-3"
      >
        {controls.map(({ icon: Icon, key, run, ...control }) => (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={localize(key)}
            title={localize(key)}
            aria-pressed={'active' in control ? control.active : undefined}
            disabled={disabled || !editor || ('unavailable' in control && control.unavailable)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run()}
          >
            <Icon className="size-4" aria-hidden="true" />
          </Button>
        ))}
      </div>
      <div className="relative min-h-[300px] flex-1 overflow-y-auto" aria-busy={disabled}>
        {state?.empty && (
          <p aria-hidden="true" className="text-text-secondary pointer-events-none absolute top-2">
            {localize('com_meeting_workspace_notes_placeholder')}
          </p>
        )}
        <EditorContent editor={editor} />
      </div>
      {tooLong && (
        <p role="alert" className="text-sm">
          {localize('com_meeting_editor_limit')}
        </p>
      )}
    </div>
  );
}
