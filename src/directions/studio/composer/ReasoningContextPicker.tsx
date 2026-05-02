import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  ConversationComposerSettings,
  ModelOption,
  ProviderKind,
  ReasoningEffort,
} from "../../../lib/types";
import { BarsIcon, CheckIcon, ChevronRightIcon } from "../../../shared/Icons";
import type { ComposerPickerOption } from "../ComposerPicker";
import {
  claudeModelSupportsOneMillionContext,
  claudeUsesOneMillionContext,
  resolveClaudeModelForContext,
} from "../claudeModelContext";
import "../ComposerPicker.css";
import "./ReasoningContextPicker.css";

type Props = {
  composer: ConversationComposerSettings;
  disabled: boolean;
  modelOptions: ModelOption[];
  options: ComposerPickerOption<ReasoningEffort>[];
  onUpdateComposer: (patch: Partial<ConversationComposerSettings>) => void;
};

type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

const MENU_MARGIN = 12;
const MENU_GAP = 8;
const MENU_MIN_WIDTH = 180;
const MENU_MAX_HEIGHT = 300;
const MENU_MIN_HEIGHT = 150;

const REASONING_LEVEL_RANK: Record<ReasoningEffort, number> = {
  low: 1,
  medium: 2,
  high: 3,
  xhigh: 4,
  max: 5,
};

function reasoningTotalBars(provider: ProviderKind): number {
  return provider === "claude" ? 5 : 4;
}

function reasoningFilledBars(effort: ReasoningEffort, total: number): number {
  return Math.max(1, Math.min(REASONING_LEVEL_RANK[effort] ?? 1, total));
}

export function ReasoningContextPicker({
  composer,
  disabled,
  modelOptions,
  options,
  onUpdateComposer,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const selected = useMemo(
    () => options.find((option) => option.value === composer.reasoningEffort) ?? null,
    [composer.reasoningEffort, options],
  );
  const supportsLargeContext =
    composer.provider === "claude" &&
    claudeModelSupportsOneMillionContext(composer.model, modelOptions);
  const usesLargeContext = claudeUsesOneMillionContext(composer.model);
  const valueLabel = [
    selected?.label ?? composer.reasoningEffort,
    supportsLargeContext && usesLargeContext ? "1M" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const totalBars = reasoningTotalBars(composer.provider);
  const filledBars = reasoningFilledBars(composer.reasoningEffort, totalBars);

  useEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const availableBelow = window.innerHeight - rect.bottom - MENU_MARGIN - MENU_GAP;
      const availableAbove = rect.top - MENU_MARGIN - MENU_GAP;
      const openUpward =
        availableBelow < MENU_MIN_HEIGHT && availableAbove > availableBelow;
      const maxHeight = Math.max(
        MENU_MIN_HEIGHT,
        Math.min(openUpward ? availableAbove : availableBelow, MENU_MAX_HEIGHT),
      );
      const width = Math.min(
        Math.max(rect.width, MENU_MIN_WIDTH),
        window.innerWidth - MENU_MARGIN * 2,
      );
      const left = Math.max(
        MENU_MARGIN,
        Math.min(rect.left, window.innerWidth - width - MENU_MARGIN),
      );
      setMenuPosition(
        openUpward
          ? {
              left,
              width,
              maxHeight,
              bottom: window.innerHeight - rect.top + MENU_GAP,
            }
          : {
              left,
              width,
              maxHeight,
              top: rect.bottom + MENU_GAP,
            },
      );
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }

    updateMenuPosition();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function selectReasoning(value: ReasoningEffort) {
    onUpdateComposer({ reasoningEffort: value });
    setOpen(false);
  }

  function selectContext(useOneMillionContext: boolean) {
    const model = resolveClaudeModelForContext(
      composer.model,
      useOneMillionContext,
      modelOptions,
    );
    onUpdateComposer({ model });
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={`tx-picker tx-picker--compact ${open ? "tx-picker--open" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="tx-picker__trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-label="Thinking picker"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="tx-picker__leading-icon" aria-hidden="true">
          <BarsIcon size={12} total={totalBars} filled={filledBars} />
        </span>
        <span className="tx-picker__value">{valueLabel}</span>
        <ChevronRightIcon size={8} className="tx-picker__chevron" />
      </button>
      {open && menuPosition
        ? createPortal(
            <div
              ref={menuRef}
              className="tx-picker__menu tx-dropdown-menu tx-reasoning-context-picker__menu"
              role="listbox"
              aria-label="Thinking options"
              style={{ ...menuPosition, zIndex: 50 }}
            >
              {options.map((option) => (
                <PickerOption
                  key={option.value}
                  selected={option.value === composer.reasoningEffort}
                  onClick={() => selectReasoning(option.value)}
                >
                  {option.label}
                </PickerOption>
              ))}
              {supportsLargeContext ? (
                <div className="tx-reasoning-context-picker__section">
                  <div className="tx-section-label tx-reasoning-context-picker__label">
                    Context
                  </div>
                  <PickerOption
                    selected={!usesLargeContext}
                    onClick={() => selectContext(false)}
                  >
                    Default context
                  </PickerOption>
                  <PickerOption
                    selected={usesLargeContext}
                    onClick={() => selectContext(true)}
                  >
                    1M context
                  </PickerOption>
                </div>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function PickerOption({
  children,
  onClick,
  selected,
}: {
  children: string;
  onClick: () => void;
  selected: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`tx-picker__option tx-dropdown-option ${selected ? "tx-picker__option--selected" : ""}`}
      onClick={onClick}
    >
      <span>{children}</span>
      {selected ? (
        <span className="tx-picker__option-check" aria-hidden="true">
          <CheckIcon size={12} />
        </span>
      ) : null}
    </button>
  );
}
