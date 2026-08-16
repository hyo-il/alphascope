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
    backgroundColor: '#0D0D1A',
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

/** 캡처 이미지를 파일로 내려받는다. */
export async function downloadChartImage(element: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await captureChartDataUrl(element);
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
