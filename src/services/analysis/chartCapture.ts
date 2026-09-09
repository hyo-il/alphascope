import html2canvas from 'html2canvas';

/**
 * 차트 캡처 (수정 3).
 *
 * 캡처와 클립보드 복사를 떼어 놓는 것이 핵심이다. 예전에는 버튼 클릭 시점에
 * html2canvas 를 돌렸는데, 렌더가 끝날 때쯤엔 사용자 제스처가 만료돼
 * `clipboard.write()` 가 NotAllowedError 로 거부됐다("복사 거부").
 * 이제 캡처 팝업에서 미리 Blob 을 만들어 두고, 복사 버튼은 그 Blob 만 쓴다.
 */

export type ImageCopyResult = 'copied' | 'unsupported' | 'failed';

/**
 * 캡처 해상도.
 *
 * 붙여넣는 쪽(Claude 대화)에서 이미지 토큰은 **넓이×높이에 비례**한다 — 배율을 절반으로
 * 낮추면 픽셀이 1/4 이 된다. 캔들의 위치·색을 읽는 데는 1배로도 충분해서 기본값을
 * 1배로 두고, 얇은 지표선까지 확대해 봐야 할 때만 고화질을 쓴다.
 * (Retina 의 devicePixelRatio 를 그대로 따르면 2배가 기본이 된다.)
 */
export type CaptureQuality = 'low' | 'high';

const SCALE: Record<CaptureQuality, number> = {
  low: 1,
  high: Math.min(2, window.devicePixelRatio || 1) || 1,
};

/** 차트 DOM 을 PNG Blob 으로 캡처한다. */
export async function captureElementToBlob(
  element: HTMLElement,
  quality: CaptureQuality = 'low',
): Promise<{ blob: Blob; width: number; height: number }> {
  const canvas = await html2canvas(element, {
    backgroundColor: '#141414',
    scale: SCALE[quality],
    logging: false,
    useCORS: true,
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('캡처한 이미지를 PNG 로 변환하지 못했습니다.');

  return { blob, width: canvas.width, height: canvas.height };
}

/**
 * 이미 캡처해 둔 Blob 을 클립보드에 넣는다.
 *
 * 여기서 기다리는 것은 클립보드 쓰기 하나뿐이라 사용자 제스처 안에서 끝난다.
 */
export async function copyBlobToClipboard(blob: Blob): Promise<ImageCopyResult> {
  if (!navigator.clipboard?.write || !window.ClipboardItem) return 'unsupported';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch {
    // 문서 포커스 없음, 권한 거부 등
    return 'failed';
  }
}

/** 캡처해 둔 Blob 을 파일로 내려받는다 (복사 실패 시 폴백). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // 클릭 직후에 놓으면 저장이 취소될 수 있어 한 틱 뒤에 해제한다.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
