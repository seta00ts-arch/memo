import { useRef, useState } from "react";

interface Props {
  onDelete: () => void;
  deleteLabel?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

const REVEAL_WIDTH = 76;
const MAX_DRAG = REVEAL_WIDTH + 24;
// この距離を超えて動くまでは「クリック」として扱い、ネイティブのクリックを邪魔しない。
const DRAG_THRESHOLD = 8;

/** 左にスワイプ（またはドラッグ）すると削除ボタンが現れる行。タッチ・マウス両対応。 */
export default function SwipeToDelete({ onDelete, deleteLabel = "削除", disabled, children }: Props) {
  const [dragX, setDragX] = useState(0);
  const revealed = useRef(false);
  const startX = useRef<number | null>(null);
  const dragging = useRef(false);
  const captured = useRef(false);
  const wasDragged = useRef(false);

  if (disabled) return <div className="swipe-row-content">{children}</div>;

  function handlePointerDown(e: React.PointerEvent) {
    startX.current = e.clientX;
    dragging.current = true;
    captured.current = false;
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging.current || startX.current === null) return;
    const delta = e.clientX - startX.current;
    if (!captured.current) {
      if (Math.abs(delta) < DRAG_THRESHOLD) return; // まだクリックかもしれないので何もしない
      captured.current = true;
      wasDragged.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const base = revealed.current ? -REVEAL_WIDTH : 0;
    const next = Math.min(0, Math.max(-MAX_DRAG, base + delta));
    setDragX(next);
  }

  function handlePointerUp() {
    dragging.current = false;
    startX.current = null;
    if (!captured.current) return; // ドラッグと判定していなければ通常のクリックに任せる
    captured.current = false;
    if (dragX <= -REVEAL_WIDTH / 2) {
      setDragX(-REVEAL_WIDTH);
      revealed.current = true;
    } else {
      setDragX(0);
      revealed.current = false;
    }
  }

  return (
    <div className="swipe-row">
      <div className="swipe-row-delete-bg">
        <button className="swipe-row-delete-btn" onClick={onDelete} aria-label={deleteLabel}>
          {deleteLabel}
        </button>
      </div>
      <div
        className="swipe-row-content"
        style={{ transform: `translateX(${dragX}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={(e) => {
          // スワイプ操作の直後は、その終点でのクリックが中身のボタンを誤って発火させないようにする。
          if (wasDragged.current) {
            wasDragged.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
