import fs from 'node:fs';

const files = [
  'node_modules/@librechat/agents/dist/cjs/tools/search/search.cjs',
  'node_modules/@librechat/agents/dist/esm/tools/search/search.mjs',
  'node_modules/@librechat/agents/dist/cjs/tools/search/tool.cjs',
  'node_modules/@librechat/agents/dist/esm/tools/search/tool.mjs',
];

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');

  if (file.endsWith('search.cjs') || file.endsWith('search.mjs')) {
    const original = 'engines: "google,bing,duckduckgo"';
    const replacement =
      'engines: process.env.SEARXNG_ENGINES ?? "yandex"';
    if (!source.includes(original) && !source.includes(replacement)) {
      throw new Error(`Unable to locate SearXNG engine selection in ${file}`);
    }
    source = source.replace(original, replacement);

    source = source
      .replace(
        'logger_.warn("No content provided for highlights");',
        'logger_.debug("No content provided for highlights");',
      )
      .replace(
        'logger_.warn("No reranker provided for highlights");',
        'logger_.debug("No reranker provided for highlights");',
      );
  }

  if (file.endsWith('tool.cjs') || file.endsWith('tool.mjs')) {
    const original =
      'if (!selectedReranker) logger.warn("No reranker selected. Using default ranking.");';
    const replacement =
      'if (!selectedReranker && rerankerType !== "none") logger.warn("No reranker selected. Using default ranking.");';
    if (!source.includes(original) && !source.includes(replacement)) {
      throw new Error(`Unable to locate reranker warning in ${file}`);
    }
    source = source.replace(original, replacement);
  }

  fs.writeFileSync(file, source);
}

console.log('Patched the internal web-search provider defaults.');
