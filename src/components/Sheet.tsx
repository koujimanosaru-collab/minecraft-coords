import type { ReactNode } from 'react';

interface SheetProps {
  title: string;
  onClose: () => void;
  /** 右上のボタン（保存など）。キーボードで隠れないよう上部に置く */
  action?: ReactNode;
  closeLabel?: string;
  children: ReactNode;
}

/** 画面全体を覆うシート。本文はスクロールする */
export function Sheet({ title, onClose, action, closeLabel = '閉じる', children }: SheetProps) {
  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
      <header className="sheet-header">
        <button type="button" className="text-btn" onClick={onClose}>
          {closeLabel}
        </button>
        <h2>{title}</h2>
        <div className="sheet-action">{action}</div>
      </header>
      <div className="sheet-body">{children}</div>
    </div>
  );
}
