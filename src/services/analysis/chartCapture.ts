import html2canvas from 'html2canvas';

/**
 * 차트 DOM 을 PNG 로 캡처한다.
 *
 * Lightweight Charts 는 캔버스로 그리므로 html2canvas 가 그대로 담아낸다.
 * Step 4(수동 분석)와 Step 7(Claude API 이미지 첨부)에서 함께 쓴다.
 */

/** PNG data URL (`data:image/png;base64,...`) 반환 */
export async function captureChartDataUrl(element: HTMLElement): Promise<string> {
  const canvas = await html2canvas(element, {
    backgroundColor: '#141414',
    scale: window.devicePixelRatio || 1,
    logging: false,
    useCORS: true,
  });
  return canvas.toDataURL('image/png');
}

/** Claude API 의 image 블록에 넣을 순수 base64 (프리픽스 제거) */
export function toBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '');
}

/**
 * 캡처 이미지를 클립보드에 복사한다.
 * 클립보드 이미지 쓰기를 지원하지 않는 브라우저에서는 false 를 반환한다.
 */
export async function copyChartToClipboard(element: HTMLElement): Promise<boolean> {
  if (!navigator.clipboard || !('write' in navigator.clipboard) || !window.ClipboardItem) {
    return false;
  }

  const dataUrl = await captureChartDataUrl(element);
  const blob = await (await fetch(dataUrl)).blob();

  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export type ImageCopyResult = 'copied' | 'unsupported' | 'failed';

/** 차트 이미지만 클립보드에 복사한다 (2단계 복사 흐름의 1단계) */
export async function copyChartImage(element: HTMLElement): Promise<ImageCopyResult> {
  if (!navigator.clipboard?.write || !window.ClipboardItem) return 'unsupported';

  try {
    const dataUrl = await captureChartDataUrl(element);
    const blob = await (await fetch(dataUrl)).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    // 문서 포커스 없음, 권한 거부 등
    return 'failed';
  }
}

export type CopyResult =
  /** 이미지 + 텍스트 모두 복사됨 */
  | 'image+text'
  /** 브라우저가 클립보드 이미지 쓰기를 지원하지 않아 텍스트만 복사됨 */
  | 'text-only-unsupported'
  /** 지원은 하지만 이미지 복사가 실패해(권한·포커스 등) 텍스트만 복사됨 */
  | 'text-only-failed'
  /** 아무것도 복사하지 못함 */
  | 'failed';

/**
 * 차트 이미지와 요약 텍스트를 한 번에 클립보드에 넣는다.
 *
 * 하나의 ClipboardItem 에 image/png 와 text/plain 을 함께 담으면, 붙여넣는 앱이
 * 지원하는 형식을 골라 간다. 이미지 쓰기를 막는 브라우저에서는 텍스트만이라도 넣고
 * 무엇이 복사됐는지 호출부에 알려 준다.
 */
export async function copyChartWithText(
  element: HTMLElement,
  text: string,
): Promise<CopyResult> {
  const canWriteRich = Boolean(navigator.clipboard?.write) && Boolean(window.ClipboardItem);
  let imageFailed = false;

  if (canWriteRich) {
    try {
      const dataUrl = await captureChartDataUrl(element);
      const imageBlob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([
        new ClipboardItem({
          'image/png': imageBlob,
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return 'image+text';
    } catch {
      // 문서 포커스 없음, 권한 거부 등 — 아래 텍스트 폴백으로 넘어간다.
      imageFailed = true;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return imageFailed ? 'text-only-failed' : 'text-only-unsupported';
  } catch {
    return 'failed';
  }
}

/** 캡처 이미지를 파일로 내려받는다. */
export async function downloadChartImage(element: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await captureChartDataUrl(element);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
