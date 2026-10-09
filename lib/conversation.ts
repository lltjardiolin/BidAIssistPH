// Follow-up questions. "What about for infrastructure projects?" means nothing to a search engine on its own;
// it has to be searched together with the question it follows.
import { normalizeAliases } from './aliases';

const REFERS_BACK = /\b(it|its|they|them|their|theirs|that|this|those|these|such|the same|the above|the former|the latter|the first|the second|the third|the last|one|ones|there|then|said|mentioned|earlier|previous answer|you said)\b/i;
const CONTINUES = /^\W*(and|also|but|so|or|what about|how about|what if|why|why not|how so|how come|when|where|who|which one|explain|elaborate|clarify|expand|continue|go on|tell me more|more|details?|examples?|give|show|list|summari[sz]e|simplify|translate|in (filipino|tagalog|english)|paano naman|eh|e di|tapos|bakit|kailan|ano naman|yung)\b/i;

/** True when the question cannot be understood without the one before it. */
export function isFollowUp(question: string): boolean {
  const q = question.trim();
  // A question that names its own document ("What does Circular 06-2026 say?") stands by itself.
  if (normalizeAliases(q).ids.length > 0) return false;
  const wordCount = q.split(/\s+/).length;
  return wordCount <= 5 || REFERS_BACK.test(q) || (CONTINUES.test(q) && wordCount <= 12);
}

/**
 * The text to search for, given every question the user has asked so far in this conversation. A follow-up is
 * searched together with the last question that stood by itself; a new topic is searched alone.
 */
export function contextualQuery(questions: string[]): string {
  const asked = questions.map(q => q.trim()).filter(Boolean);
  const current = asked.at(-1) ?? '';
  if (asked.length < 2 || !isFollowUp(current)) return current.slice(0, 500);
  let anchor = asked.length - 2;
  while (anchor > 0 && isFollowUp(asked[anchor])) anchor--;
  return `${asked[anchor]} ${current}`.slice(0, 500);
}
