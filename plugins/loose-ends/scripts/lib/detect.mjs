// Zero-token detector: decides whether a session is waiting on the user, from its digest alone.
// Rules, not a model. Precision matters more than recall: a wrong reminder costs trust.

const ASK_LINE = /\b(let me know|tell me (which|if|whether)|your call|up to you|waiting (on|for) you(?![a-z])|your go[- ]ahead|your (ok|okay|approval|answer)\b|once you (confirm|approve|decide|choose|pick|reply)|unless you (say|tell me) otherwise)/i;
const DECISION = /\b(which (one|option|approach|of)|or would you|or do you|or should|or keep|or go|or rather|prefer|either)\b|\bor\b[^.?!\n]{0,140}\?/i;
const APPROVAL = /\b(should i|shall i|ready (to|for)|go[- ]ahead|ok(ay)? to|proceed|confirm|approve|approval|can i|may i|unless you (say|tell me) otherwise|do you want me to (start|build|ship|publish|push|commit|run|merge|send))\b/i;
const OFFER = /\b(want me to|would you like( me)? to|i can also|happy to|if you('d)? like)\b/i;
// The AI handed a step to the user without asking anything: "upload it again", "listen through once", "your remaining steps are…".
const YOUR_MOVE = /\b(your (remaining|next) steps?|you('ll)? (need|have) to|over to you|listen (through|to it)|watch it (through|once)|give (it|them) a (look|listen|watch)|re-?upload|upload .{0,100}? again|once you('ve)? (tested|tried|watched|checked|uploaded|installed))\b/i;
// Assistant greetings in throwaway sessions ("Reply OK" → "What would you like to work on?").
const GENERIC = /^(what (would you like|can i help|do you want)( me)? (to )?(help with|work on|do)?|how can i help)/i;
const CLOSED = /^(thanks?( you)?|thx|ty|perfect|great|awesome|amazing|works|it works|done|ok(ay)?|cool|nice|merci|good|got it|all good|that'?s it|bye)\b[\s\S]{0,40}$/i;
const BROKEN = /(traceback|exception|\berror\b|\bfailed\b|not working|does ?n[o']?t work|isn'?t working|\bbroken\b|\bcrash)/i;
// First person only: "I'll test it tomorrow", "remind me", not "you get paid days later".
const PROMISE = /\b(remind me|i'?ll come back|come back to (this|it)|i'?ll (check|try|test|look at|review|do|finish|get back to)\b[^.!?\n]{0,40}\b(later|tomorrow|tonight|next week)|(later|tomorrow|tonight) i'?ll)\b/i;

export const WEIGHTS = { decision: 5, approval: 4, question: 3, your_move: 2, offer: 1, broken: 4, interrupted: 3, unanswered: 3, half_done: 2, promised: 2 };

export const LABELS = {
  decision: "Decision waiting",
  approval: "Approval waiting",
  question: "Question waiting",
  your_move: "Your move",
  offer: "Offer (optional)",
  broken: "Left broken",
  interrupted: "Interrupted",
  unanswered: "No reply yet",
  half_done: "Half done",
  promised: "You said later",
};

function stripCode(t) {
  return t.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, (m) => m.slice(1, -1));
}

function sentences(t) {
  return t
    .split(/\n+|(?<=[.?!])\s+(?=[A-Z0-9*_"'(\[])/)
    .map((s) => s.replace(/^[\s>*\-#\d.)]+/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
}

/** The question the AI ended on, if any. Only the last few sentences count: a question buried mid-answer is not a hand-off. */
export function finalQuestion(text) {
  const tail = sentences(stripCode(String(text || "")).slice(-900)).slice(-3);
  // A "?" right before a closing quote is quoted text (a title, on-screen copy), not a question to the user.
  for (let i = tail.length - 1; i >= 0; i--) if (/\?[)\]]*$/.test(tail[i]) && !/\?["'”’]/.test(tail[i])) return tail[i];
  for (let i = tail.length - 1; i >= Math.max(0, tail.length - 2); i--) if (ASK_LINE.test(tail[i])) return tail[i];
  return "";
}

export function yourMove(text) {
  const tail = sentences(stripCode(String(text || "")).slice(-900)).slice(-3);
  for (let i = tail.length - 1; i >= 0; i--) if (YOUR_MOVE.test(tail[i])) return tail[i];
  return "";
}

const QUESTION_WORD = /^(what|which|why|how|when|where|who|whose|is|are|was|were|do|does|did|can|could|would|will|should|shall|have|has|any|tell|let)\b/i;

export function kindOfQuestion(q) {
  if (DECISION.test(q)) return "decision";
  if (APPROVAL.test(q)) return "approval";
  if (OFFER.test(q) || /^want\b/i.test(q)) return "offer";
  // "Start M1 now?", "Commit the voice-over work?": an imperative put as a question is asking for a go-ahead.
  if (!QUESTION_WORD.test(q.trim())) return "approval";
  return "question";
}

/**
 * @returns {{state:string, kind:string, weight:number, question:string}}
 * state: "waiting" | "broken" | "interrupted" | "unanswered" | "half_done" | "promised" | "closed" | "finished" | "empty"
 */
export function classify(d) {
  if (!d || !d.userTurns) return { state: "empty", kind: "", weight: 0, question: "" };
  const r = (state, kind, question = "") => ({ state, kind, weight: WEIGHTS[kind] || 0, question });
  const lastUser = (d.lastUserText || "").trim();

  if (d.lastKind === "user") {
    if (lastUser.length <= 60 && CLOSED.test(lastUser)) return r("closed", "");
    if (BROKEN.test(lastUser)) return r("broken", "broken", lastUser.slice(0, 200));
    return r("unanswered", "unanswered", lastUser.slice(0, 200));
  }
  if (d.lastKind === "interrupt") return r("interrupted", "interrupted", "You stopped Claude mid-answer");
  if (d.lastKind === "api_error") return r("interrupted", "interrupted", d.apiError ? `Stopped by an error: ${d.apiError}` : "Stopped by an API error or usage limit");
  if (d.lastKind === "tool_result" || d.lastKind === "tool_use") return r("interrupted", "interrupted", "The session ended in the middle of a task");

  // The AI spoke last.
  // Our own /loose-ends:scan ends with "which one do you want to pick up?": never flag the scan itself.
  if (/^\/?loose-ends:/i.test(lastUser)) return r("finished", "");
  if (d.pendingAsk) {
    const q = d.pendingAsk.text;
    const kind = d.pendingAsk.source === "ask_tool" ? "decision" : d.pendingAsk.source === "plan" ? "approval" : kindOfQuestion(q) === "offer" ? "approval" : kindOfQuestion(q);
    return r("waiting", kind, q);
  }
  const q = finalQuestion(d.finalText);
  if (q && GENERIC.test(q) && d.userTurns <= 2) return r("finished", "");
  if (q) return r("waiting", kindOfQuestion(q), q);
  const move = yourMove(d.finalText);
  if (move) return r("waiting", "your_move", move);
  if (d.pendingSteps && d.pendingSteps.length) return r("half_done", "half_done", `${d.pendingSteps.length} step(s) left: ${d.pendingSteps[0]}`);
  if (lastUser && PROMISE.test(lastUser)) return r("promised", "promised", lastUser.slice(0, 200));
  return r("finished", "");
}

export function isLooseEnd(c, { includeOffers = false } = {}) {
  if (!c || !c.weight) return false;
  if (c.kind === "offer" && !includeOffers) return false;
  return true;
}
