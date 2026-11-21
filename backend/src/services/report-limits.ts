// A render attempt has no in-memory waiting queue. Budgets leave 70 seconds
// within the existing lease for other work; unbounded DB waits remain a risk.
export const REPORT_EMAIL_LEASE_MS = 120000;
export const PDF_RENDER_TIMEOUT_MS = 45000;
export const PDF_CLOSE_TIMEOUT_MS = 5000;
