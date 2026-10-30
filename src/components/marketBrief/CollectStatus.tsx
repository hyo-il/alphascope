import { useState } from 'react';
import { COLLECT_ICON, DisclosureButton, ICON_SM, Panel } from '../ui';
import { formatNumber } from '../../utils/formatters';
import type { MarketBrief } from '../../types/marketBrief';

/** 수집 상태 — 소스마다 받음/실패 · AI 호출 · 모델 · 토큰 · 프롬프트 버전(접어 둔다) */
export default function CollectStatus({ brief }: { brief: MarketBrief }) {
  const [open, setOpen] = useState(false);
  const failed = brief.sources.filter((s) => !s.ok).length;
  return (
    <div className="space-y-2" data-brief-sources>
      <div className="flex items-center gap-2">
        <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} label="수집 상태 보기" controls="brief-sources" />
        <span className={`text-caption ${failed ? 'text-warning' : 'text-text-muted'}`}>
          {failed ? `${failed}곳 실패` : '모두 받음'}
        </span>
      </div>
      {open && (
        <Panel pad="sm" id="brief-sources" className="space-y-1">
          {brief.sources.map((s, i) => {
            const Icon = s.ok ? COLLECT_ICON.ok : COLLECT_ICON.fail;
            return (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Icon {...ICON_SM} className={`mt-0.5 shrink-0 ${s.ok ? 'text-text-muted' : 'text-danger'}`} />
                <span className="w-64 shrink-0 text-text-secondary">{s.label}</span>
                <span className={`min-w-0 break-keep ${s.ok ? 'text-text-primary' : 'text-danger'}`}>
                  {s.ok ? '받음' : '실패'} · {s.detail}
                </span>
              </div>
            );
          })}
          <div className="pt-1 text-caption text-text-muted tabular-nums">
            AI 호출 {brief.aiCalls}번{brief.model ? ` · 모델 ${brief.model}` : ''}{brief.tokens ? ` · 토큰 ${formatNumber(brief.tokens, 0)}` : ''} · 프롬프트 {brief.promptVersion}
          </div>
        </Panel>
      )}
    </div>
  );
}
