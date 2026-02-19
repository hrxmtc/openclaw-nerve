import { InlineSelect } from '@/components/ui/InlineSelect';
import { useModelEffort } from './useModelEffort';

interface ChatHeaderProps {
  onReset?: () => void;
  onAbort: () => void;
  isGenerating: boolean;
}

/**
 * COMMS header with model/effort selectors and controls.
 *
 * Model and effort state management is delegated to useModelEffort() —
 * this component is purely presentational + event wiring.
 */
export function ChatHeader({
  onReset,
  onAbort,
  isGenerating,
}: ChatHeaderProps) {
  const {
    modelOptions,
    effortOptions,
    selectedModel,
    selectedEffort,
    handleModelChange,
    handleEffortChange,
    controlsDisabled,
    uiError,
  } = useModelEffort();

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 bg-secondary border-b border-border/60 shrink-0 border-l-[3px] border-l-primary">
      <span className="text-[11px] font-bold tracking-[2px] text-primary uppercase flex items-center gap-1.5">
        <span className="text-[8px]">◆</span>
        COMMS
      </span>

      {/* Model + Effort selectors on the right */}
      <div className="flex items-center gap-2 ml-auto">
        {uiError && (
          <span
            className="text-red text-[9px] tracking-wide max-w-[180px] truncate"
            title={uiError}
            role="status"
            aria-live="polite"
          >
            ⚠ {uiError}
          </span>
        )}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-foreground/70 font-mono uppercase">Model</span>
          <InlineSelect
            value={selectedModel}
            onChange={handleModelChange}
            ariaLabel="Model"
            disabled={controlsDisabled}
            title={controlsDisabled ? 'Connect to gateway to change model' : undefined}
            triggerClassName="max-w-[160px]"
            menuClassName="min-w-[200px]"
            options={modelOptions}
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-foreground/70 font-mono uppercase">Effort</span>
          <InlineSelect
            value={selectedEffort}
            onChange={handleEffortChange}
            ariaLabel="Effort"
            disabled={controlsDisabled}
            title={controlsDisabled ? 'Connect to gateway to change effort' : undefined}
            options={effortOptions}
          />
        </div>
        {isGenerating && (
          <button
            onClick={onAbort}
            aria-label="Stop generating"
            title="Stop generating"
            className="bg-transparent border border-red text-red text-[10px] px-1.5 py-0.5 cursor-pointer hover:text-red hover:border-red font-mono uppercase tracking-wide flex items-center gap-1"
          >
            <span aria-hidden="true">⏹</span>
            Stop
          </button>
        )}
        {onReset && (
          <button
            onClick={() => onReset()}
            title="Reset session (start fresh)"
            aria-label="Reset session"
            className="bg-transparent border border-red/50 text-red/70 text-[10px] px-1.5 py-0.5 cursor-pointer hover:text-red hover:border-red font-mono uppercase tracking-wide"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
