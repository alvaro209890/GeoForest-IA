/**
 * Barrel de helpers de formatação do Dashboard GeoForest.
 * Plano 03 — módulos puros extraídos de Dashboard.tsx.
 */
export {
  sanitizeMessagesForFirestore,
  isPlainObject,
  stripUndefinedDeep,
  toCloudinaryDownloadUrl,
  toFileProxyUrl,
  resolveBackendDownloadUrl,
  renderInlineRichText,
  isMarkdownTableSeparator,
  splitMarkdownTableRow,
  renderRichText,
  renderAnalysisRichText,
  normalizeImageCaption,
  normalizeBackendText,
  removeRoboticAuasLines,
  buildIntegratedVectorizedReport,
} from './format';

export {
  formatSimcarAuasStatus,
  formatSimcarAcAvnVerdict,
  formatSimcarAcAvnConfidence,
  formatSimcarAuasVerdict,
  simcarAuasVerdictClass,
} from './formatters-simcar';
