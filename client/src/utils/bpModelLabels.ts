const PUBLIC_MODEL_LABELS: Record<string, string> = {
  'bp/gpt-5.6-sol-high': 'GPT 5.6 Sol (High)',
  'bp/gpt-5.6-sol-medium': 'GPT 5.6 Sol (Medium)',
  'bp/gpt-5.6-sol-low': 'GPT 5.6 Sol (Low)',
  'bp/gpt-5.6-terra-high': 'GPT 5.6 Terra (High)',
  'bp/gpt-5.6-terra-medium': 'GPT 5.6 Terra (Medium)',
  'bp/gpt-5.6-terra-low': 'GPT 5.6 Terra (Low)',
  'bp/gpt-5.6-luna-high': 'GPT 5.6 Luna (High)',
  'bp/gpt-5.6-luna-medium': 'GPT 5.6 Luna (Medium)',
  'bp/gpt-5.6-luna-low': 'GPT 5.6 Luna (Low)',
  'bp/gpt-5.5-high': 'GPT 5.5 (High)',
  'bp/gpt-5.5-medium': 'GPT 5.5 (Medium)',
  'bp/gpt-5.5-low': 'GPT 5.5 (Low)',
  'bp/claude-haiku': 'Claude Haiku',
  'bp/claude-sonnet': 'Claude Sonnet',
  'bp/claude-opus': 'Claude Opus',
};

export const getBPModelLabel = (model?: string | null): string =>
  (model && PUBLIC_MODEL_LABELS[model]) || model || '';
