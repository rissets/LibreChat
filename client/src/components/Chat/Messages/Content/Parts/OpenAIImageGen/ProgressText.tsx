import { AGENT_STYLE_TOOLS } from '.';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

export default function ProgressText({
  progress,
  error,
  toolName = '',
  intent,
}: {
  progress: number;
  error?: boolean;
  toolName?: string;
  /** Model-authored label; wins over the phase texts (error state excepted). */
  intent?: string;
}) {
  const localize = useLocalize();

  const getText = () => {
    if (error) {
      return localize('com_ui_image_gen_failed');
    }
    // Keep successful output concise; model-authored intent is only useful while running.
    if (progress >= 1) {
      return localize(toolName === 'image_edit_oai' ? 'com_ui_image_edited' : 'com_ui_image_created');
    }
    if (intent != null) {
      return intent;
    }

    if (toolName === 'image_edit_oai') {
      if (progress >= 0.7) {
        return localize('com_ui_final_touch');
      }
      if (progress >= 0.5) {
        return localize('com_ui_adding_details');
      }
      if (progress >= 0.3) {
        return localize('com_ui_edit_editing_image');
      }
      return localize('com_ui_getting_started');
    }

    if (toolName === 'gemini_image_gen') {
      if (progress >= 0.7) {
        return localize('com_ui_final_touch');
      }
      if (progress >= 0.5) {
        return localize('com_ui_adding_details');
      }
      if (progress >= 0.3) {
        return localize('com_ui_creating_image');
      }
      return localize('com_ui_getting_started');
    }

    if (AGENT_STYLE_TOOLS.has(toolName)) {
      if (progress >= 0.7) {
        return localize('com_ui_final_touch');
      }
      if (progress >= 0.5) {
        return localize('com_ui_adding_details');
      }
      if (progress >= 0.3) {
        return localize('com_ui_creating_image');
      }
      return localize('com_ui_getting_started');
    }

    return localize('com_ui_generating_image');
  };

  const text = getText();

  return (
    <span
      className={cn(
        'progress-text-content tool-status-text min-w-0 truncate font-medium',
        progress < 1 && 'shimmer',
      )}
    >
      {text}
    </span>
  );
}
