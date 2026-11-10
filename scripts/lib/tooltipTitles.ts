/**
 * 툴팁 · 아이콘 버튼 찾기(128차 · v2.69.0) — `design:lint` 의 「툴팁용 title」 · 「아이콘 버튼 크기」 와 `tooltip:test` 가 함께 쓴다.
 *
 * - `titleAttrs`: 화면 코드의 `title=` 속성마다 **브라우저 기본 툴팁인지**를 TypeScript 형 정보로 가린다 —
 *   속성 선언이 React 의 HTML 속성(`@types/react` 의 `HTMLAttributes.title` 등)이면 브라우저 기본 툴팁(앱 툴팁 `data-tip` 으로 바꿀 곳),
 *   우리 부품의 속성(`Dialog` · `PageHeader` 의 `title` 등)이면 툴팁이 아니다. `iframe` 의 `title` 은 화면 읽기 이름이라 툴팁이 아니다.
 * - `iconButtonSizeHits`: `<IconButton>` 에 정해진 두 크기(`size="md"` · `size="sm"` · 없음 = md) 밖의 크기 · `className` 높이 · 폭 덧칠.
 * - `iconTextButtons`: 아이콘 + 글자 버튼(`<Button icon={…}>글자</Button>` · 아이콘을 품은 맨 `<button>` + 글자 — 여러 줄로 쓴 것까지).
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const ROOT = path.resolve(import.meta.dirname, '../..');

/** 디자인 검사 대상 — `src/components` 의 .tsx 전부 + `src/App.tsx` + `src/main.tsx` */
export function screenFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src/components'));
  out.push(path.join(ROOT, 'src/App.tsx'), path.join(ROOT, 'src/main.tsx'));
  return out;
}

/** 앱 tsconfig 로 만든 프로그램(+ 시험용 가짜 파일) */
export function appProgram(extra: string[] = []): ts.Program {
  const cfgPath = path.join(ROOT, 'tsconfig.app.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(cfgPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
  return ts.createProgram([...parsed.fileNames, ...extra], parsed.options);
}

export interface TitleAttr {
  file: string; // 저장소 기준 경로
  line: number;
  tag: string; // 요소 이름(span · Button · Dialog …)
  /** 브라우저 기본 툴팁(HTML title) */
  native: boolean;
  /** 이 줄의 글(140자) */
  text: string;
  /** 값 — 글자 그대로면 그 글, 식이면 식 소스 */
  value: string;
  /** 같은 요소의 className 에 truncate(말줄임)가 있나 */
  truncate: boolean;
  /** 글자 없는 버튼(아이콘만) */
  iconOnly: boolean;
}

const tagName = (el: ts.JsxOpeningLikeElement) => el.tagName.getText();
const isIntrinsic = (name: string) => /^[a-z]/.test(name) || name.includes('-');

export function titleAttrs(program: ts.Program, files: string[]): TitleAttr[] {
  const checker = program.getTypeChecker();
  const out: TitleAttr[] = [];
  for (const file of files) {
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const lines = sf.text.split('\n');
    const visit = (n: ts.Node) => {
      if (ts.isJsxAttribute(n) && n.name.getText() === 'title') {
        const el = n.parent.parent as ts.JsxOpeningLikeElement;
        const tag = tagName(el);
        let native: boolean;
        if (tag === 'iframe') native = false;
        else if (isIntrinsic(tag)) native = true;
        else {
          const sym = checker.getSymbolAtLocation(n.name);
          const decls = sym?.declarations ?? [];
          native = decls.some((d) => /[\\/]@types[\\/]react[\\/]/.test(d.getSourceFile().fileName));
        }
        const cls = el.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'className');
        const init = n.initializer;
        const value = !init ? '' : ts.isStringLiteral(init) ? init.text : init.getText().replace(/^\{|\}$/g, '');
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        const kids = ts.isJsxOpeningElement(el) ? (el.parent as ts.JsxElement).children : null;
        const hasText = !!kids?.some((c) => (ts.isJsxText(c) && c.text.trim() !== '') || (ts.isJsxExpression(c) && c.expression && !ts.isJsxElement(c.expression) && !ts.isJsxSelfClosingElement(c.expression)));
        const iconOnly = /^(button|Button)$/.test(tag) && !hasText;
        out.push({ file: path.relative(ROOT, file), line, tag, native, text: lines[line - 1].trim().slice(0, 140), value, truncate: !!cls && /\btruncate\b/.test(cls.getText()), iconOnly });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

export interface SizeHit {
  file: string;
  line: number;
  text: string;
  why: string;
}

/** `<IconButton>` 에 정해진 두 크기 밖 — 구문만 본다 */
export function iconButtonSizeHits(files: string[], program?: ts.Program): SizeHit[] {
  const out: SizeHit[] = [];
  for (const file of files) {
    const sf = program?.getSourceFile(file) ?? ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const lines = sf.text.split('\n');
    const visit = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && tagName(n) === 'IconButton') {
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        for (const p of n.attributes.properties) {
          if (!ts.isJsxAttribute(p)) continue;
          const name = p.name.getText();
          const init = p.initializer;
          if (name === 'size' && !(init && ts.isStringLiteral(init) && (init.text === 'md' || init.text === 'sm')))
            out.push({ file: path.relative(ROOT, file), line, text: lines[line - 1].trim().slice(0, 140), why: `size=${init?.getText() ?? ''} — md(28/16) · sm(24/14) 둘만` });
          if (name === 'className' && init && /(^|[\s"'`{])!?(?:min-|max-)?(?:h|w|size)-[\w.[\]/]+/.test(init.getText()))
            out.push({ file: path.relative(ROOT, file), line, text: lines[line - 1].trim().slice(0, 140), why: 'className 에 높이 · 폭 — 크기는 size 두 가지만' });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}

export interface IconTextButton {
  file: string;
  line: number;
  kind: 'Button' | 'button';
  icon: string;
  text: string;
}

/** 아이콘 + 글자 버튼 — `<Button icon={X}>글자</Button>` · 아이콘(`{...ICON…}` 펼친 요소)을 품은 맨 `<button>` + 글자 */
export function iconTextButtons(files: string[]): IconTextButton[] {
  const out: IconTextButton[] = [];
  const textOf = (children: ts.NodeArray<ts.JsxChild>): string =>
    children
      .map((c) => {
        if (ts.isJsxText(c)) return c.text.replace(/\s+/g, ' ');
        if (ts.isJsxExpression(c) && c.expression) {
          const e = c.expression;
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
          if (ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e)) return '';
          return `{${e.getText().replace(/\s+/g, ' ').slice(0, 40)}}`;
        }
        if (ts.isJsxElement(c)) {
          const t = tagName(c.openingElement);
          if (/^[A-Z]/.test(t) && c.children.length === 0) return '';
          return textOf(c.children);
        }
        return '';
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  const iconIn = (children: ts.NodeArray<ts.JsxChild>): string | null => {
    for (const c of children) {
      if (ts.isJsxSelfClosingElement(c) && /^[A-Z]/.test(tagName(c)) && c.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p) && /ICON/.test(p.expression.getText()))) return tagName(c);
      if (ts.isJsxElement(c)) {
        const inner = iconIn(c.children);
        if (inner) return inner;
      }
      if (ts.isJsxExpression(c) && c.expression) {
        let found: string | null = null;
        const v = (n: ts.Node) => {
          if (found) return;
          if (ts.isJsxSelfClosingElement(n) && /^[A-Z]/.test(tagName(n)) && n.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p) && /ICON/.test(p.expression.getText()))) found = tagName(n);
          else ts.forEachChild(n, v);
        };
        v(c.expression);
        if (found) return found;
      }
    }
    return null;
  };
  for (const file of files) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node) => {
      if (ts.isJsxElement(n)) {
        const tag = tagName(n.openingElement);
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        if (tag === 'Button') {
          const icon = n.openingElement.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'icon');
          const text = textOf(n.children);
          if (icon && text) out.push({ file: path.relative(ROOT, file), line, kind: 'Button', icon: icon.initializer?.getText().replace(/^\{|\}$/g, '') ?? '', text });
        } else if (tag === 'button') {
          const icon = iconIn(n.children);
          const text = textOf(n.children);
          if (icon && text) out.push({ file: path.relative(ROOT, file), line, kind: 'button', icon, text });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
