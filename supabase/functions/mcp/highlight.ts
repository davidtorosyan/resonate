// get_score_view's still_highlighted: is the stored highlight (score_focus's span) the one the
// device shows now (its state's selection)? No imports: node tests it (tools/mcpcatalog.mjs).
type Json = Record<string, unknown>;
const at = (p: unknown) => JSON.stringify(p ?? null);
// The same span: start, end and kind (from a page that names them — v2), and for one chord picked,
// the same staff and part (from a page that names them — v97's review: a right-hand chord and a
// left-hand one at the same moment, as long, looked the same). A page or a row that names less: the
// bars decide (the caller compares them).
export function sameSpan(sel: Json | undefined | null, span: Json | null | undefined): boolean {
  if (!span || !sel?.start) return true;
  if (at(sel.start) !== at(span.start) || at(sel.end) !== at(span.end) || (sel.kind ?? null) !== (span.kind ?? null)) return false;
  if (sel.kind !== "note" || !("staff" in sel)) return true;
  const first = Array.isArray(span.first) ? (span.first[0] as Json | undefined) : undefined;
  return (sel.staff ?? null) === (span.staff ?? null) && (sel.part ?? null) === (first?.part ?? null);
}
