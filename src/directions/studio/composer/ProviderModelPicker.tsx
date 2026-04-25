import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import type {
  ConversationComposerSettings,
  ModelOption,
  ProviderKind,
} from "../../../lib/types";
import { CheckIcon, ChevronRightIcon } from "../../../shared/Icons";
import { ProviderLogo } from "../../../shared/ProviderLogo";
import { PROVIDER_OPTIONS, composerModelOptions } from "../composerOptions";
import {
  claudeModelPickerLabel,
  resolveClaudeModelForSelection,
} from "../claudeModelContext";
import { labelForModelOption } from "../modelLabels";
import "../ComposerPicker.css";
import "./ProviderModelPicker.css";

type Props = {
  composer: ConversationComposerSettings;
  disabled: boolean;
  modelOptions: ModelOption[];
  providerLocked: boolean;
  onUpdateComposer: (patch: Partial<ConversationComposerSettings>) => void;
};

type MenuPosition = {
  left: number;
  top: number;
  maxHeight: number;
  placement: "above" | "below";
};

const PROVIDER_MENU_WIDTH = 220;
const MODEL_MENU_WIDTH = 300;
const MENU_GAP = 0;
const MENU_VIEWPORT_MARGIN = 12;
const MENU_TRIGGER_GAP = 6;
const MENU_MAX_HEIGHT = 360;
const MENU_MIN_HEIGHT = 120;
const MENU_ROW_HEIGHT = 44;
const MENU_VERTICAL_CHROME = 18;

export function ProviderModelPicker({
  composer,
  disabled,
  modelOptions,
  providerLocked,
  onUpdateComposer,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState<ProviderKind>(
    composer.provider,
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const selectedModel = useMemo(
    () =>
      modelOptions.find(
        (candidate) =>
          candidate.id === composer.model &&
          (candidate.provider ?? "codex") === composer.provider,
      ) ?? null,
    [composer.model, composer.provider, modelOptions],
  );
  const selectedLabel =
    composer.provider === "claude"
      ? claudeModelPickerLabel(labelForModelOption(selectedModel, composer.model))
      : labelForModelOption(selectedModel, composer.model);
  const menuProvider = providerLocked ? composer.provider : activeProvider;
  const providerModels = useMemo(
    () =>
      modelOptions.filter(
        (model) => (model.provider ?? "codex") === menuProvider,
      ),
    [menuProvider, modelOptions],
  );
  const activeProviderModelCount = providerModels.length;

  useEffect(() => {
    if (!open) return;
    setActiveProvider(composer.provider);
  }, [composer.provider, open]);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = providerLocked
        ? MODEL_MENU_WIDTH
        : PROVIDER_MENU_WIDTH + MODEL_MENU_WIDTH + MENU_GAP;
      const estimatedRows = providerLocked
        ? Math.max(1, activeProviderModelCount)
        : Math.max(PROVIDER_OPTIONS.length, activeProviderModelCount, 1);
      setMenuPosition(
        computeMenuPosition({
          rect,
          menuWidth,
          contentHeight: estimateMenuHeight(estimatedRows),
        }),
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

    updatePosition();
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeProviderModelCount, open, providerLocked]);

  useLayoutEffect(() => {
    if (!open || !menuPosition) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    const menuRect = menuRef.current?.getBoundingClientRect();
    if (!rect || !menuRect || menuRect.height <= 0) return;
    const menuWidth = providerLocked
      ? MODEL_MENU_WIDTH
      : PROVIDER_MENU_WIDTH + MODEL_MENU_WIDTH + MENU_GAP;
    const next = computeMenuPosition({
      rect,
      menuWidth,
      contentHeight: menuRect.height,
    });
    if (
      Math.abs(next.left - menuPosition.left) > 0.5 ||
      Math.abs(next.top - menuPosition.top) > 0.5 ||
      Math.abs(next.maxHeight - menuPosition.maxHeight) > 0.5 ||
      next.placement !== menuPosition.placement
    ) {
      setMenuPosition(next);
    }
  }, [activeProviderModelCount, menuPosition, open, providerLocked]);

  function selectModel(provider: ProviderKind, model: ModelOption | string) {
    const requestedModelId = typeof model === "string" ? model : model.id;
    const modelId =
      provider === "claude"
        ? resolveClaudeModelForSelection(
            requestedModelId,
            composer.model,
            modelOptions,
          )
        : requestedModelId;
    const modelOption =
      modelOptions.find(
        (candidate) =>
          candidate.id === modelId &&
          (candidate.provider ?? "codex") === provider,
      ) ?? (typeof model === "string" ? undefined : model);
    onUpdateComposer({
      provider,
      model: modelId,
      reasoningEffort:
        modelOption?.defaultReasoningEffort ?? composer.reasoningEffort,
      serviceTier: null,
    });
    setOpen(false);
  }

  const triggerClassName = `tx-picker tx-picker--compact tx-provider-model-picker ${open ? "tx-picker--open" : ""}`;

  return (
    <div ref={rootRef} className={triggerClassName}>
      <button
        ref={triggerRef}
        type="button"
        className="tx-picker__trigger tx-provider-model-picker__trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-label="Model picker"
        onClick={() => setOpen((current) => !current)}
      >
        <ProviderLogo provider={composer.provider} size={16} />
        <span className="tx-picker__value">{selectedLabel}</span>
        <ChevronRightIcon size={8} className="tx-picker__chevron" />
      </button>
      {open && menuPosition
        ? createPortal(
            providerLocked ? (
              <ModelMenu
                ref={menuRef}
                label="Model options"
                maxHeight={menuPosition.maxHeight}
                left={menuPosition.left}
                top={menuPosition.top}
                models={providerModels}
                provider={composer.provider}
                selectedModel={composer.model}
                onSelect={selectModel}
              />
            ) : (
              <ProviderCascadeMenu
                ref={menuRef}
                activeProvider={activeProvider}
                left={menuPosition.left}
                maxHeight={menuPosition.maxHeight}
                modelOptions={modelOptions}
                placement={menuPosition.placement}
                selectedModel={composer.model}
                selectedProvider={composer.provider}
                top={menuPosition.top}
                onActiveProvider={setActiveProvider}
                onSelect={selectModel}
              />
            ),
            document.body,
          )
        : null}
    </div>
  );
}

type ModelMenuProps = {
  label: string;
  left: number;
  top: number;
  maxHeight: number;
  models: ModelOption[];
  provider: ProviderKind;
  selectedModel: string;
  onSelect: (provider: ProviderKind, model: ModelOption | string) => void;
};

const ModelMenu = forwardRef<HTMLDivElement, ModelMenuProps>(function ModelMenu(
  {
    label,
    left,
    top,
    maxHeight,
    models,
    provider,
    selectedModel,
    onSelect,
  }: ModelMenuProps,
  ref,
) {
  return (
    <div
      ref={ref}
      className="tx-picker__menu tx-dropdown-menu tx-provider-model-picker__models"
      role="listbox"
      aria-label={label}
      style={{ left, top, maxHeight, zIndex: 50 }}
    >
      {composerModelOptions(models, selectedModel, provider).map((option) => {
        const model = models.find((candidate) => candidate.id === option.value);
        const isSelected = option.value === selectedModel;
        return (
          <button
            key={option.value}
            type="button"
            role="option"
            aria-selected={isSelected}
            className={`tx-picker__option tx-dropdown-option ${isSelected ? "tx-picker__option--selected" : ""}`}
            onClick={() => onSelect(provider, model ?? option.value)}
          >
            <span>{option.label}</span>
            {isSelected ? <CheckIcon size={12} /> : null}
          </button>
        );
      })}
    </div>
  );
});

function estimateMenuHeight(rowCount: number) {
  return Math.min(
    MENU_MAX_HEIGHT,
    MENU_VERTICAL_CHROME + Math.max(1, rowCount) * MENU_ROW_HEIGHT,
  );
}

function computeMenuPosition({
  rect,
  menuWidth,
  contentHeight,
}: {
  rect: DOMRect;
  menuWidth: number;
  contentHeight: number;
}): MenuPosition {
  const maxLeft = window.innerWidth - menuWidth - MENU_VIEWPORT_MARGIN;
  const left = Math.max(
    MENU_VIEWPORT_MARGIN,
    Math.min(rect.left, maxLeft),
  );
  const spaceBelow =
    window.innerHeight - rect.bottom - MENU_VIEWPORT_MARGIN - MENU_TRIGGER_GAP;
  const spaceAbove = rect.top - MENU_VIEWPORT_MARGIN - MENU_TRIGGER_GAP;
  const openBelow =
    spaceBelow >= Math.min(contentHeight, MENU_MIN_HEIGHT) ||
    spaceBelow >= spaceAbove;
  const availableSpace = Math.max(
    MENU_MIN_HEIGHT,
    openBelow ? spaceBelow : spaceAbove,
  );
  const maxHeight = Math.min(MENU_MAX_HEIGHT, availableSpace);
  const effectiveHeight = Math.min(contentHeight, maxHeight);
  const top = openBelow
    ? Math.min(
        rect.bottom + MENU_TRIGGER_GAP,
        window.innerHeight - effectiveHeight - MENU_VIEWPORT_MARGIN,
      )
    : Math.max(
        MENU_VIEWPORT_MARGIN,
        rect.top - effectiveHeight - MENU_TRIGGER_GAP,
      );
  return { left, top, maxHeight, placement: openBelow ? "below" : "above" };
}

type CascadeProps = {
  activeProvider: ProviderKind;
  left: number;
  top: number;
  maxHeight: number;
  modelOptions: ModelOption[];
  placement: MenuPosition["placement"];
  selectedModel: string;
  selectedProvider: ProviderKind;
  onActiveProvider: (provider: ProviderKind) => void;
  onSelect: (provider: ProviderKind, model: ModelOption | string) => void;
};

const ProviderCascadeMenu = forwardRef<HTMLDivElement, CascadeProps>(function ProviderCascadeMenu(
  {
    activeProvider,
    left,
    top,
    maxHeight,
    modelOptions,
    placement,
    selectedModel,
    selectedProvider,
    onActiveProvider,
    onSelect,
  }: CascadeProps,
  ref,
) {
  const activeModels = modelOptions.filter(
    (model) => (model.provider ?? "codex") === activeProvider,
  );
  return (
    <div
      ref={ref}
      className="tx-provider-model-picker__cascade"
      data-placement={placement}
      style={{ left, top, zIndex: 50 }}
    >
      <div
        className="tx-picker__menu tx-dropdown-menu tx-provider-model-picker__providers"
        role="listbox"
        aria-label="Provider options"
        style={{ maxHeight }}
      >
        {PROVIDER_OPTIONS.map((provider) => {
          const isSelected = provider.value === selectedProvider;
          const isActive = provider.value === activeProvider;
          return (
            <button
              key={provider.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`tx-picker__option tx-dropdown-option ${isActive ? "tx-provider-model-picker__provider--active" : ""}`}
              onMouseEnter={() => onActiveProvider(provider.value)}
              onFocus={() => onActiveProvider(provider.value)}
            >
              <ProviderLogo provider={provider.value} size={16} />
              <span>{provider.label}</span>
              <ChevronRightIcon size={10} />
            </button>
          );
        })}
      </div>
      <ModelMenu
        label={`${PROVIDER_OPTIONS.find((provider) => provider.value === activeProvider)?.label ?? activeProvider} model options`}
        left={0}
        top={0}
        maxHeight={maxHeight}
        models={activeModels}
        provider={activeProvider}
        selectedModel={activeProvider === selectedProvider ? selectedModel : ""}
        onSelect={onSelect}
      />
    </div>
  );
});
