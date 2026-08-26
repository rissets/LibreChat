import React, { memo, useState, useCallback, useMemo, useEffect } from 'react';
import * as Ariakit from '@ariakit/react';
import { CheckboxButton } from '@librechat/client';
import { Check, ChevronDown, WandSparkles } from 'lucide-react';
import { ArtifactModes, defaultAgentCapabilities } from 'librechat-data-provider';
import { useLocalize, useAgentCapabilities } from '~/hooks';
import { useBadgeRowContext } from '~/Providers';
import { badgeAccents } from './accents';
import { cn } from '~/utils';

interface ArtifactsToggleState {
  enabled: boolean;
  mode: string;
}

const ARTIFACT_PRESETS = [
  {
    mode: ArtifactModes.DEFAULT,
    label: 'com_ui_artifacts_mode_default',
    info: 'com_ui_artifacts_mode_default_info',
  },
  {
    mode: ArtifactModes.WEB,
    label: 'com_ui_artifacts_mode_web',
    info: 'com_ui_artifacts_mode_web_info',
  },
  {
    mode: ArtifactModes.DATA,
    label: 'com_ui_artifacts_mode_data',
    info: 'com_ui_artifacts_mode_data_info',
  },
  {
    mode: ArtifactModes.PRESENTATION,
    label: 'com_ui_artifacts_mode_presentation',
    info: 'com_ui_artifacts_mode_presentation_info',
  },
  {
    mode: ArtifactModes.DOCUMENT,
    label: 'com_ui_artifacts_mode_document',
    info: 'com_ui_artifacts_mode_document_info',
  },
  {
    mode: ArtifactModes.DIAGRAM,
    label: 'com_ui_artifacts_mode_diagram',
    info: 'com_ui_artifacts_mode_diagram_info',
  },
  {
    mode: ArtifactModes.DESIGN,
    label: 'com_ui_artifacts_mode_design',
    info: 'com_ui_artifacts_mode_design_info',
  },
  {
    mode: ArtifactModes.SHADCNUI,
    label: 'com_ui_artifacts_mode_shadcn',
    info: 'com_ui_artifacts_mode_shadcn_info',
  },
  {
    mode: ArtifactModes.CUSTOM,
    label: 'com_ui_artifacts_mode_custom',
    info: 'com_ui_artifacts_mode_custom_info',
  },
] as const;

function Artifacts() {
  const localize = useLocalize();
  const context = useBadgeRowContext();
  const { toggleState, debouncedChange, isPinned } = context?.artifacts ?? {};

  const { artifactsEnabled } = useAgentCapabilities(
    context?.agentsConfig?.capabilities ?? defaultAgentCapabilities,
  );

  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isButtonExpanded, setIsButtonExpanded] = useState(false);

  const currentState = useMemo<ArtifactsToggleState>(() => {
    if (typeof toggleState === 'string' && toggleState) {
      return { enabled: true, mode: toggleState };
    }
    return { enabled: false, mode: '' };
  }, [toggleState]);

  const isEnabled = currentState.enabled;

  const handleToggle = useCallback(() => {
    if (!debouncedChange) return;
    if (isEnabled) {
      debouncedChange({ value: '' });
      setIsButtonExpanded(false);
    } else {
      debouncedChange({ value: ArtifactModes.DEFAULT });
    }
  }, [isEnabled, debouncedChange]);

  const handleMenuButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsButtonExpanded(!isButtonExpanded);
    },
    [isButtonExpanded],
  );

  useEffect(() => {
    if (!isPopoverOpen) {
      setIsButtonExpanded(false);
    }
  }, [isPopoverOpen]);

  const handleModeSelect = useCallback(
    (mode: ArtifactModes) => {
      if (!debouncedChange) return;
      debouncedChange({ value: mode });
    },
    [debouncedChange],
  );

  if (!artifactsEnabled) {
    return null;
  }

  if (!isEnabled && !isPinned) {
    return null;
  }

  return (
    <div className="flex">
      <CheckboxButton
        className={cn(isEnabled && 'rounded-r-none border-r-0')}
        checked={isEnabled}
        setValue={handleToggle}
        label={localize('com_ui_artifacts')}
        isCheckedClassName={badgeAccents.amber}
        icon={<WandSparkles className="icon-md" aria-hidden="true" />}
      />

      {isEnabled && (
        <Ariakit.MenuProvider open={isPopoverOpen} setOpen={setIsPopoverOpen}>
          <Ariakit.MenuButton
            className={cn(
              'w-7 rounded-l-none rounded-r-full border-b border-l-0 border-r border-t border-border-light md:w-6',
              badgeAccents.amber,
              'transition-colors',
            )}
            onClick={handleMenuButtonClick}
          >
            <ChevronDown
              className={cn(
                'ml-1 h-4 w-4 text-text-secondary transition-transform duration-300 md:ml-0.5',
                isButtonExpanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </Ariakit.MenuButton>

          <Ariakit.Menu
            gutter={4}
            className={cn(
              'animate-popover-top-left z-40 flex max-h-[70vh] min-w-[340px] flex-col overflow-y-auto rounded-xl',
              'border border-border-light bg-surface-secondary shadow-lg',
            )}
            portal={true}
            unmountOnHide={true}
          >
            <div className="px-2 py-1.5">
              <div className="mb-2 text-xs font-medium text-text-secondary">
                {localize('com_ui_artifacts_options')}
              </div>

              {ARTIFACT_PRESETS.map((preset) => {
                const selected = currentState.mode === preset.mode;
                return (
                  <Ariakit.MenuItem
                    key={preset.mode}
                    hideOnClick={false}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleModeSelect(preset.mode);
                    }}
                    className={cn(
                      'mb-1 flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-text-primary outline-none transition-colors',
                      'hover:bg-surface-hover data-[active-item]:bg-surface-hover',
                      selected ? 'bg-surface-active' : 'bg-surface-secondary',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{localize(preset.label)}</div>
                      <div className="mt-0.5 text-xs leading-4 text-text-secondary">
                        {localize(preset.info)}
                      </div>
                    </div>
                    <Check
                      className={cn('mt-0.5 size-4 shrink-0', !selected && 'invisible')}
                      aria-hidden="true"
                    />
                  </Ariakit.MenuItem>
                );
              })}
            </div>
          </Ariakit.Menu>
        </Ariakit.MenuProvider>
      )}
    </div>
  );
}

export default memo(Artifacts);
