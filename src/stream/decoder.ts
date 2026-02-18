/**
 * Stream decoder: dispatches to the appropriate filter(s) based on the
 * /Filter and /DecodeParms entries in a stream dictionary.
 */

import type { PdfDict, PdfObject } from '../parser/types.js';
import { dictGet, dictGetName, dictGetNumber, isArray, isName, isDict } from '../parser/types.js';
import { flateDecode, asciiHexDecode, ascii85Decode, lzwDecode, applyPNGPredictor } from './filters.js';

type ResolveFn = (obj: PdfObject) => PdfObject;

export function decodeStream(
  data: Uint8Array,
  dict: PdfDict,
  resolve?: ResolveFn,
): Uint8Array {
  let filterObj = dictGet(dict, 'Filter');
  if (!filterObj) return data;

  // Resolve indirect refs for /Filter and /DecodeParms
  if (resolve) filterObj = resolve(filterObj);
  let parmsObj = dictGet(dict, 'DecodeParms');
  if (parmsObj && resolve) parmsObj = resolve(parmsObj);

  // Single filter
  if (isName(filterObj)) {
    const parms = parmsObj && isDict(parmsObj) ? parmsObj : undefined;
    return applyFilter(data, filterObj.value, parms);
  }

  // Filter chain (array of names)
  if (isArray(filterObj)) {
    let result = data;
    for (let i = 0; i < filterObj.items.length; i++) {
      let filter = filterObj.items[i];
      if (resolve) filter = resolve(filter);
      if (isName(filter)) {
        let parms: PdfDict | undefined;
        if (parmsObj && isArray(parmsObj) && i < parmsObj.items.length) {
          let p = parmsObj.items[i];
          if (resolve) p = resolve(p);
          if (isDict(p)) parms = p;
        } else if (parmsObj && isDict(parmsObj)) {
          parms = parmsObj;
        }
        result = applyFilter(result, filter.value, parms);
      }
    }
    return result;
  }

  return data;
}

function applyFilter(data: Uint8Array, filterName: string, parms?: PdfDict): Uint8Array {
  let decoded: Uint8Array;

  switch (filterName) {
    case 'FlateDecode':
    case 'Fl':
      decoded = flateDecode(data);
      break;
    case 'ASCIIHexDecode':
    case 'AHx':
      decoded = asciiHexDecode(data);
      break;
    case 'ASCII85Decode':
    case 'A85':
      decoded = ascii85Decode(data);
      break;
    case 'LZWDecode':
    case 'LZW': {
      const earlyChange = parms ? (dictGetNumber(parms, 'EarlyChange') ?? 1) : 1;
      decoded = lzwDecode(data, earlyChange);
      break;
    }
    default:
      // Unsupported filter: return data as-is
      return data;
  }

  // Apply predictor if specified
  if (parms) {
    const predictor = dictGetNumber(parms, 'Predictor') ?? 1;
    if (predictor >= 10) {
      // PNG predictors (10-15)
      const columns = dictGetNumber(parms, 'Columns') ?? 1;
      const colors = dictGetNumber(parms, 'Colors') ?? 1;
      const bpc = dictGetNumber(parms, 'BitsPerComponent') ?? 8;
      decoded = applyPNGPredictor(decoded, columns, colors, bpc);
    }
    // Predictor 2 (TIFF) could be added but is rare
  }

  return decoded;
}
