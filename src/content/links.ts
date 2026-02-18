/**
 * Link Annotation Extraction
 *
 * Reads /Annots from a PDF page dict and extracts hyperlink annotations.
 * Each link annotation has a bounding rectangle and a URI target.
 */

import type { PdfParser } from '../parser/parser.js';
import type { PdfDict } from '../parser/types.js';
import {
  dictGet, dictGetName, dictGetArray,
  isNumber, isString, isArray,
} from '../parser/types.js';

/** A hyperlink annotation extracted from a PDF page */
export interface LinkAnnotation {
  /** Bounding rectangle [x1, y1, x2, y2] in page coordinates */
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** Target URI */
  readonly uri: string;
}

/**
 * Extract link annotations from a PDF page dictionary.
 */
export function extractLinks(pageDict: PdfDict, parser: PdfParser): LinkAnnotation[] {
  const annotsObj = dictGet(pageDict, 'Annots');
  if (!annotsObj) return [];

  const annotsArr = dictGetArray(pageDict, 'Annots')
    ?? (() => {
      const resolved = parser.resolve(annotsObj);
      return isArray(resolved) ? resolved : null;
    })();

  if (!annotsArr) return [];

  const links: LinkAnnotation[] = [];

  for (const annotRef of annotsArr.items) {
    const annot = parser.resolveDict(annotRef);
    if (!annot) continue;

    // Only process Link annotations
    const subtype = dictGetName(annot, 'Subtype');
    if (subtype !== 'Link') continue;

    // Extract URI from /A (action) dictionary
    const actionObj = dictGet(annot, 'A');
    if (!actionObj) continue;
    const action = parser.resolveDict(actionObj);
    if (!action) continue;

    const actionType = dictGetName(action, 'S');
    if (actionType !== 'URI') continue;

    const uriObj = dictGet(action, 'URI');
    if (!uriObj) continue;
    const resolvedUri = parser.resolve(uriObj);

    let uri: string;
    if (isString(resolvedUri)) {
      uri = new TextDecoder('latin1').decode(resolvedUri.value);
    } else {
      continue;
    }

    // Extract /Rect [x1, y1, x2, y2]
    const rectArr = dictGetArray(annot, 'Rect');
    if (!rectArr || rectArr.items.length < 4) continue;

    const coords = rectArr.items.map(item => {
      const resolved = parser.resolve(item);
      return isNumber(resolved) ? resolved.value : 0;
    });

    links.push({
      x1: Math.min(coords[0], coords[2]),
      y1: Math.min(coords[1], coords[3]),
      x2: Math.max(coords[0], coords[2]),
      y2: Math.max(coords[1], coords[3]),
      uri,
    });
  }

  return links;
}
