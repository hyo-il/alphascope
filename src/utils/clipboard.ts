/**
 * 텍스트 복사 — 앱의 텍스트 복사는 모두 여기를 지난다.
 *
 * `navigator.clipboard` 는 보안 컨텍스트(HTTPS·localhost) 전용이라 오라클처럼
 * `http://공인IP` 로 접속하면 아예 `undefined` 다. 그래서 둘로 나눈다:
 *  ① 보안 컨텍스트면 Clipboard API (지금까지와 같다)
 *  ② 없거나 실패하면 숨긴 textarea + `execCommand('copy')`.
 *     execCommand 는 deprecated 라(MDN) ①을 먼저 쓰고 ②는 대체 수단으로만 둔다.
 *
 * 판단은 `window.isSecureContext` 하나다 — 호스트·프로토콜 문자열로 가르지 않아야
 * HTTPS 를 붙였을 때 코드 수정 없이 ①로 돌아간다.
 *
 * ⚠️ 클릭 핸들러 안에서 다른 await 없이 바로 부른다. 사용자 제스처가 만료되면 둘 다 거부된다.
 */
export type TextCopyResult = 'copied' | 'failed';

export async function copyText(text: string): Promise<TextCopyResult> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      // 포커스 없음·권한 거부 — 아래 대체 방식으로 한 번 더 시도한다
    }
  }
  return copyWithExecCommand(text) ? 'copied' : 'failed';
}

function copyWithExecCommand(text: string): boolean {
  // 복사 뒤 되돌릴 포커스와 선택 — 프롬프트 편집창의 커서가 사라지지 않게
  const active = document.activeElement as HTMLElement | null;
  const field =
    active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? active : null;
  const fieldRange = field
    ? { start: field.selectionStart, end: field.selectionEnd, dir: field.selectionDirection }
    : null;
  const selection = document.getSelection();
  const ranges: Range[] = [];
  if (!field && selection) {
    for (let i = 0; i < selection.rangeCount; i++) ranges.push(selection.getRangeAt(i));
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  // 화면 밖으로 — display:none 이면 선택이 되지 않는다
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  document.body.appendChild(area);

  let ok = false;
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  } finally {
    area.remove();
    if (active && typeof active.focus === 'function') active.focus({ preventScroll: true });
    if (field && fieldRange && fieldRange.start != null && fieldRange.end != null) {
      try {
        field.setSelectionRange(fieldRange.start, fieldRange.end, fieldRange.dir ?? undefined);
      } catch {
        // 선택을 지원하지 않는 input 타입
      }
    } else if (selection && ranges.length > 0) {
      selection.removeAllRanges();
      ranges.forEach((r) => selection.addRange(r));
    }
  }
  return ok;
}
