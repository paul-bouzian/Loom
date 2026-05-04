import type { ComposerAutocompleteItem } from "./composer-model";

type Props = {
  items: ComposerAutocompleteItem[];
  activeIndex: number;
  onSelect: (item: ComposerAutocompleteItem) => void;
  statusMessage?: string | null;
};

type OptionsProps = Pick<Props, "items" | "activeIndex" | "onSelect">;

export function ComposerAutocompleteMenu({
  items,
  activeIndex,
  onSelect,
  statusMessage = null,
}: Props) {
  if (items.length === 0) {
    if (!statusMessage) {
      return null;
    }

    return (
      <div className="tx-composer-menu" role="status" aria-live="polite">
        <div className="tx-composer-menu__status">{statusMessage}</div>
      </div>
    );
  }

  return (
    <div
      className="tx-composer-menu"
      role="listbox"
      aria-label="Composer suggestions"
    >
      <ComposerAutocompleteOptions
        activeIndex={activeIndex}
        items={items}
        onSelect={onSelect}
      />
    </div>
  );
}

function ComposerAutocompleteOptions({
  items,
  activeIndex,
  onSelect,
}: OptionsProps) {
  if (items.length === 0) {
    return null;
  }

  let lastGroup = "";

  return (
    <>
      {items.map((item, index) => {
        const showGroup = item.group !== lastGroup;
        lastGroup = item.group;

        return (
          <div key={item.id}>
            {showGroup ? (
              <div className="tx-composer-menu__group">{item.group}</div>
            ) : null}
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`tx-composer-menu__item ${index === activeIndex ? "tx-composer-menu__item--active" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(item);
              }}
            >
              <span className="tx-composer-menu__label-row">
                <span className="tx-composer-menu__label">{item.label}</span>
                {item.description ? (
                  <span className="tx-composer-menu__description">
                    {item.description}
                  </span>
                ) : null}
              </span>
              {item.hint ? (
                <span className="tx-composer-menu__hint">{item.hint}</span>
              ) : null}
            </button>
          </div>
        );
      })}
    </>
  );
}
