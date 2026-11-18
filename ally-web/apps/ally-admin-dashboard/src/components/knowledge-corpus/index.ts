/**
 * Widgets for the WhatsApp Q&A corpus, the one corpus the Knowledge Base still serves.
 *
 * `CorpusDocumentPanel` is the uploader, one implementation for paste / PDF / DOCX / EPUB / URL
 * (and the S3 presign dance behind three of them); `DocumentStatusBadge` renders the shared
 * status enum. Used by the WhatsApp bot's Corpus tab.
 */
export { CorpusDocumentPanel } from "./CorpusDocumentPanel";
// The table cell that summarises a document's audience (`isGlobal`/`tenantIds`).
export { audienceSummary } from "./CorpusAudienceField";
export { DocumentStatusBadge } from "./DocumentStatusBadge";
