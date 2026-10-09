import { CORPUS_VERSION, formatDate } from './manifest';

export const CORPUS_DATE = formatDate(CORPUS_VERSION) ?? CORPUS_VERSION;

// PDR H5.
export const DISCLAIMER =
  'BidAIssistPH provides document-grounded information from its indexed Philippine procurement sources. ' +
  'It is not legal advice or official procurement guidance. Rules and issuances change; verify important ' +
  `decisions against the latest official source. Corpus last updated: ${CORPUS_DATE}.`;

export const SHORT_DISCLAIMER =
  'Not legal advice or official procurement guidance. Questions are logged to improve the service; do not enter personal or confidential details.';
