/**
 * Test-only source scanner for the src/audio architecture rule.
 *
 * `stripComments` is a single-pass lexer over the JS/TS lexical states that
 * matter here: code, '…' and "…" strings, `…` templates with nested ${ }
 * expressions (brace-depth stack), // and /* *\/ comments, and regex
 * literals. Comments become spaces (newlines kept, so line-anchored regexes
 * still work); everything else is copied verbatim.
 *
 * Known limitation: whether '/' starts a regex literal or is division is
 * decided by the standard heuristic — regex if the previous significant
 * character is an operator/punctuator ( ( , = : [ ! & | ? { } ; + - * % < > ~ ^ )
 * or start of input, or the previous word is a keyword that precedes an
 * expression (return, typeof, …). A regex directly after ')' or ']' (e.g.
 * `if (x) /re/.test(s)`) is misread as division; its body is then lexed as
 * code. That can only make the scan MORE conservative in practice when the
 * regex contains no quote characters; src/audio has no such construct.
 */

const REGEX_PREV = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'yield', 'await', 'delete', 'new', 'throw', 'instanceof']);

function regexAllowed(out: string, lastSig: string): boolean {
  if (lastSig === '') return true;
  if (REGEX_PREV.has(lastSig)) return true;
  const word = /([A-Za-z_$][\w$]*)\s*$/.exec(out.slice(-32));
  return word !== null && REGEX_KEYWORDS.has(word[1]!);
}

export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let mode: 'code' | 'sq' | 'dq' | 'tpl' = 'code';
  /** For each open `${`, the depth of plain `{` braces inside it. */
  const tpl: number[] = [];
  let lastSig = '';
  while (i < n) {
    const c = src[i]!;
    const d = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && d === '/') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && d === '*') {
        const end = src.indexOf('*/', i + 2);
        const stop = end < 0 ? n : end + 2;
        out += src.slice(i, stop).replace(/[^\n]/g, ' ');
        i = stop;
        continue;
      }
      if (c === '/' && regexAllowed(out, lastSig)) {
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const ch = src[j]!;
          if (ch === '\\') {
            j += 2;
            continue;
          }
          if (ch === '\n') break;
          j++;
          if (inClass) {
            if (ch === ']') inClass = false;
          } else if (ch === '[') inClass = true;
          else if (ch === '/') break;
        }
        while (j < n && /[a-z]/i.test(src[j]!)) j++;
        out += src.slice(i, j);
        i = j;
        lastSig = ')'; // a regex literal is an operand: a following '/' divides
        continue;
      }
      if (c === "'") mode = 'sq';
      else if (c === '"') mode = 'dq';
      else if (c === '`') mode = 'tpl';
      else if (c === '{' && tpl.length > 0) tpl[tpl.length - 1]!++;
      else if (c === '}' && tpl.length > 0) {
        if (tpl[tpl.length - 1] === 0) {
          tpl.pop();
          mode = 'tpl';
          out += c;
          i++;
          continue;
        }
        tpl[tpl.length - 1]!--;
      }
      out += c;
      i++;
      if (!/\s/.test(c)) lastSig = c;
      continue;
    }
    // Inside a string or template.
    if (c === '\\') {
      out += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) {
      mode = 'code';
      out += c;
      i++;
      lastSig = ')'; // a literal is an operand
      continue;
    }
    if (mode === 'tpl' && c === '$' && d === '{') {
      tpl.push(0);
      mode = 'code';
      out += '${';
      i += 2;
      lastSig = '{';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export interface ImportRef {
  spec: string;
  /** Only `import type … from` / `export type … from` are type-only (erased at build). */
  typeOnly: boolean;
  form: 'static' | 'side-effect' | 'dynamic' | 'require';
}

/** Every module reference in (comment-stripped) code. */
export function scanImports(code: string): ImportRef[] {
  const refs: ImportRef[] = [];
  for (const m of code.matchAll(/\b(import|export)(\s+type(?=[\s{*]))?\b[^;'"`]*?\bfrom\s*(['"])([^'"]+)\3/g)) {
    refs.push({ spec: m[4]!, typeOnly: m[2] !== undefined, form: 'static' });
  }
  for (const m of code.matchAll(/\bimport\s*(['"])([^'"]+)\1/g)) refs.push({ spec: m[2]!, typeOnly: false, form: 'side-effect' });
  for (const m of code.matchAll(/\bimport\s*\(\s*(['"`])([^'"`]+)\1/g)) refs.push({ spec: m[2]!, typeOnly: false, form: 'dynamic' });
  for (const m of code.matchAll(/\brequire\s*\(\s*(['"`])([^'"`]+)\1/g)) refs.push({ spec: m[2]!, typeOnly: false, form: 'require' });
  return refs;
}

const FORBIDDEN_LAYERS = /\.\.\/(run|ui|render|builder|physics|terrain|spike|app)\b/g;

/**
 * src/audio rule: modules may reference './…' freely and '../model/…' ONLY in
 * type-only form; everything else is a violation. Backstop: no path into
 * another game layer may appear anywhere in code (strings included).
 */
export function audioViolations(source: string, label = 'src'): string[] {
  const code = stripComments(source);
  const bad: string[] = [];
  for (const r of scanImports(code)) {
    if (r.spec.startsWith('./')) continue;
    if (r.spec.startsWith('../model/') && r.typeOnly) continue;
    bad.push(`${label} -> ${r.spec} (${r.typeOnly ? 'type' : r.form})`);
  }
  for (const m of code.matchAll(FORBIDDEN_LAYERS)) bad.push(`${label} mentions ../${m[1]}`);
  return bad;
}
