/**
 * Safe search-match highlighting (SEC-10).
 *
 * Returns DOM nodes — text nodes plus one <mark> — instead of an HTML string,
 * so neither the result text nor the user's query is ever parsed as markup.
 * Matching is a literal, case-insensitive substring search (no RegExp), so
 * regex metacharacters in the query are just characters.
 */
export function highlightMatch(text: string, query: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  // Some characters change length when lower-cased (e.g. "İ" → "i̇"), which
  // would misalign indices between the lowered and original strings. In that
  // case skip highlighting rather than slice the wrong range.
  const index =
    query !== '' && lowerText.length === text.length && lowerQuery.length === query.length
      ? lowerText.indexOf(lowerQuery)
      : -1;

  if (index === -1) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }

  const mark = document.createElement('mark');
  mark.style.background = 'var(--jp-accent)';
  mark.style.color = 'var(--jp-white)';
  mark.style.padding = '0 2px';
  mark.textContent = text.slice(index, index + query.length);

  if (index > 0) frag.appendChild(document.createTextNode(text.slice(0, index)));
  frag.appendChild(mark);
  const rest = text.slice(index + query.length);
  if (rest) frag.appendChild(document.createTextNode(rest));
  return frag;
}
