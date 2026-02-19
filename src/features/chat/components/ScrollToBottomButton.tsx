interface ScrollToBottomButtonProps {
  onClick: () => void;
  unreadCount: number;
}

/**
 * Floating button to scroll to bottom with unread badge
 */
export function ScrollToBottomButton({ onClick, unreadCount }: ScrollToBottomButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={unreadCount > 0 ? `Scroll to bottom, ${unreadCount} unread messages` : "Scroll to bottom"}
      title="Scroll to bottom"
      className="absolute bottom-[120px] right-4 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center cursor-pointer shadow-lg z-10 hover:bg-primary/90 transition-colors text-sm font-bold"
    >
      <span aria-hidden="true">↓</span>
      {unreadCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 bg-red text-white text-[9px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1" aria-hidden="true">
          {unreadCount}
        </span>
      )}
    </button>
  );
}
