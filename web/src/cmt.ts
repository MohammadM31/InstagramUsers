// Roadmap A.2 UI helpers (pure; unit-tested in test/commentsUi.test.js). The card never shows a sentiment number without saying it is an estimate.
export type Cmt = { username: string | null; text: string; likes: number | null; posted_at: string; owner_replied: boolean; question: boolean };
export type CommentsData = {
  postId: number; connected: boolean; lastFetchedAt: string | null; retentionDays: number; reason: string | null;
  insights: {
    total: number; accounts: number; sentiment: { positive: number; negative: number; neutral: number }; sentimentIsEstimate: boolean; sentimentNote: string;
    questions: { total: number; unanswered: number }; topCommenters: { username: string; comments: number; likes: number }[]; themes: { word: string; comments: number }[]; summary: string;
  };
  comments: Cmt[];
};

// Same keys the server returns in `reason`.
export const EMPTY_TEXT: Record<string, string> = {
  not_from_instagram: 'This post came from a file import, so there is no Instagram comment feed to read. Comments are pulled for posts synced from a connected Instagram account.',
  not_connected: 'Connect Instagram in Settings to read comments on your posts.',
  reconnect_needed: 'Your Instagram connection needs to be renewed (Settings), then comments can be read again.',
  none_stored: 'No comments are stored for this post yet. They are pulled every few hours; a post with no comments, or with comments turned off, stays empty.',
};
export const emptyMessage = (reason: string | null) => (reason && EMPTY_TEXT[reason]) || EMPTY_TEXT.none_stored;

export const sentimentParts = (s: { positive: number; negative: number; neutral: number }) =>
  ([['positive', s.positive], ['negative', s.negative], ['neutral', s.neutral]] as [string, number][]).map(([label, n]) => ({ label, n }));

// The unanswered questions, newest first as the server sent them, at most `max`.
export const openQuestions = (comments: Cmt[], max = 5) => comments.filter(c => c.question && !c.owner_replied).slice(0, max);

export const clip = (t: string, n = 140) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t);

export function freshness(iso: string | null, now = Date.now()) {
  if (!iso) return 'not pulled yet';
  const h = Math.floor((now - Date.parse(iso)) / 36e5);
  return h < 1 ? 'updated less than an hour ago' : h < 48 ? `updated ${h} h ago` : `updated ${Math.floor(h / 24)} days ago`;
}
