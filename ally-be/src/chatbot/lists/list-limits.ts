/** The lists' limits in v2 (chunk 5a; `TEMPLATE-DATA-MODEL.md` §2). Each is refused with `limit_exceeded`. */
export const LIST_LIMITS = {
  listsPerBot: 50,
  fieldsPerList: 100,
  recordsPerBot: 200_000,
  dataBytesPerRecord: 32 * 1024,
  csvRows: 5_000,
  csvBytes: 5 * 1024 * 1024,
  rulesPerList: 20,
  /** A deleted list can be restored for this long. */
  restoreDays: 30,
} as const;

/** How each limit reads in "This would go over the limit of {limit}." */
export const LIMIT_WORDS = {
  listsPerBot: `${LIST_LIMITS.listsPerBot} lists`,
  fieldsPerList: `${LIST_LIMITS.fieldsPerList} fields`,
  recordsPerBot: '200,000 entries',
  dataBytesPerRecord: '32 KB per entry',
  csvRows: '5,000 rows a file',
  csvBytes: '5 MB a file',
  rulesPerList: `${LIST_LIMITS.rulesPerList} rules`,
} as const;
