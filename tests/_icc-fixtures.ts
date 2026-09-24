/**
 * Synthetic ICC profiles for the print / PDF/X suites.
 *
 * The builders live in scripts/lib/synthetic-icc.ts (the corpus and the
 * sample generator use them too); this module turns them into the
 * `outputIntent` inputs a tool call takes. They characterise no device.
 */
import { buildMinimalRgbIccProfile, buildSyntheticCmykProfile, buildSyntheticGrayProfile, iccBase64 } from '../scripts/lib/synthetic-icc.js';

export const CMYK_ICC_BASE64 = iccBase64(buildSyntheticCmykProfile());
export const GRAY_ICC_BASE64 = iccBase64(buildSyntheticGrayProfile());
/** ICC v4.2 Gray profile: PDF/A-1 refuses it (ISO 19005-1 §6.2.2 → PDFA_ICC_PROFILE_VERSION). */
export const GRAY_V4_ICC_BASE64 = iccBase64(buildSyntheticGrayProfile({ version: 4 }));
/** Display-class (`mntr`) RGB profile: valid under PDF/A, refused by PDF/X-4 (needs `prtr`). */
export const RGB_MNTR_ICC_BASE64 = buildMinimalRgbIccProfile();

export const CMYK_INTENT = { iccProfileBase64: CMYK_ICC_BASE64, outputConditionIdentifier: 'Synthetic CMYK (pdfnative test profile)' } as const;
export const GRAY_INTENT = { iccProfileBase64: GRAY_ICC_BASE64, outputConditionIdentifier: 'Synthetic Gray (pdfnative test profile)' } as const;
