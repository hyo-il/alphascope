import { useEffect, useRef, useState } from 'react';
import { toast } from '../store/uiStore';
import { DEFAULT_ACCOUNTS_VIEW, isAccountsView, type AccountsView } from '../types/paper';

/**
 * 계좌 모아보기의 보기(카드 · 목록) — 서버(`GET|PUT /api/paper/accounts-view`)에 두어 모든 기기에서 같다.
 *
 * - `view` 는 서버 값을 받기 전에는 `null` 이다 — 화면은 그동안 로딩을 보인다(카드로 그렸다가 목록으로 바뀌는 깜빡임을 막는다).
 *   한 번 받은 값은 이 탭이 기억해 두고 다시 들어올 때 먼저 쓴다(다른 기기에서 바꾼 값은 받는 대로 바뀐다).
 * - 읽기에 실패하면 조용히 카드로 보인다(이 탭에서 이미 받은 값이 있으면 그 값).
 * - 바꾸면 화면을 바로 바꾸고 저장한다. 실패하면 원래 보기로 되돌리고 알린다(계좌 순서 저장과 같은 방식). 폴링하지 않는다.
 */
let remembered: AccountsView | null = null;

export function useAccountsView() {
  const [view, setView] = useState<AccountsView | null>(remembered);
  // 받는 사이에 사람이 바꿨으면 늦게 온 읽기 값으로 덮지 않는다
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch('/api/paper/accounts-view')
      .then(async (res) => {
        const body = (await res.json()) as { view?: unknown };
        if (!res.ok || !isAccountsView(body.view)) throw new Error();
        return body.view;
      })
      .catch(() => remembered ?? DEFAULT_ACCOUNTS_VIEW)
      .then((v) => {
        if (!alive || touched.current) return;
        remembered = v;
        setView(v);
      });
    return () => {
      alive = false;
    };
  }, []);

  const change = async (next: AccountsView) => {
    const before = view;
    touched.current = true;
    remembered = next;
    setView(next);
    try {
      const res = await fetch('/api/paper/accounts-view', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ view: next }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok || !body || body.error) throw new Error(body?.error ?? '서버에 연결하지 못했습니다.');
    } catch (e) {
      remembered = before;
      setView(before);
      toast.error('보기를 바꾸지 못했습니다', (e as Error).message);
    }
  };

  return { view, change };
}
