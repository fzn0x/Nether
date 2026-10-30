// A note's properties above it, its frontmatter: each key with a type, the
// vault's choice or what its value looks like, and an editor for that
// type. Changes go to the note's document, and from there to its file.
import { type JsonValue, type PropertyEntry, type PropertyType, propertyTypes } from "@nether/core";
import { documentProperties, setDocumentProperties } from "@nether/editor";
import type { Vault } from "@nether/storage";
import { type KeyboardEvent, useEffect, useState } from "react";
import type * as Y from "yjs";
import { t } from "./messages.ts";
import {
  type PropertyTypes,
  convertValue,
  editableTypes,
  isListType,
  newPropertyKey,
  typeOf,
} from "./properties.ts";

/** The vault's chosen types, from `.nether/properties.json`, kept only where they are types. */
function readTypes(data: unknown): PropertyTypes {
  if (typeof data !== "object" || data === null) return {};
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, PropertyType] =>
      (propertyTypes as readonly unknown[]).includes(entry[1]),
    ),
  );
}

/** A list item as text: strings as they are, other values as JSON. */
function itemText(item: JsonValue): string {
  return typeof item === "string" ? item : JSON.stringify(item);
}

function ListEditor(props: {
  readonly label: string;
  readonly values: readonly string[];
  readonly onChange: (values: string[]) => void;
}) {
  const { label, values, onChange } = props;
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (value !== "" && !values.includes(value)) onChange([...values, value]);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <span className="property-list">
      {values.map((value) => (
        <span key={value} className="property-chip">
          {value}
          <button
            type="button"
            aria-label={t("removeValue", { value })}
            onClick={() => {
              onChange(values.filter((item) => item !== value));
            }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        aria-label={label}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={add}
      />
    </span>
  );
}

function ValueEditor(props: {
  readonly name: string;
  readonly type: PropertyType;
  readonly value: JsonValue;
  readonly onChange: (value: JsonValue) => void;
}) {
  const { name, type, value, onChange } = props;
  const label = t("propertyValue", { name });
  if (isListType(type)) {
    const values = (Array.isArray(value) ? value : value === null ? [] : [value]).map(itemText);
    return <ListEditor label={label} values={values} onChange={onChange} />;
  }
  if (type === "checkbox") {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    );
  }
  const text = value === null || typeof value === "object" ? "" : String(value);
  const kind =
    type === "number" ? "number" : type === "date" ? "date" : type === "url" ? "url" : "text";
  return (
    <input
      type={kind}
      aria-label={label}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        if (type === "number") onChange(next === "" ? null : Number(next));
        else if (type === "date") onChange(next === "" ? null : next);
        else onChange(next);
      }}
    />
  );
}

/** A property's name, renamed when the field is left with a name no other property has. */
function KeyField(props: {
  readonly name: string;
  readonly taken: readonly string[];
  readonly autoFocus: boolean;
  readonly onRename: (name: string) => void;
}) {
  const { name, taken, autoFocus, onRename } = props;
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    setDraft(name);
  }, [name]);
  const commit = () => {
    const next = draft.trim();
    if (next === "" || (next !== name && taken.includes(next))) setDraft(name);
    else if (next !== name) onRename(next);
  };
  return (
    <input
      className="property-key"
      aria-label={t("propertyName")}
      value={draft}
      autoFocus={autoFocus}
      spellCheck={false}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

export function PropertiesPanel(props: { readonly document: Y.Doc; readonly vault: Vault }) {
  const { document, vault } = props;
  const [entries, setEntries] = useState<readonly PropertyEntry[]>(() =>
    documentProperties(document),
  );
  const [types, setTypes] = useState<PropertyTypes>({});
  const [added, setAdded] = useState<string | undefined>();

  useEffect(() => {
    const refresh = () => {
      setEntries(documentProperties(document));
    };
    refresh();
    document.on("update", refresh);
    return () => {
      document.off("update", refresh);
    };
  }, [document]);

  useEffect(() => {
    let current = true;
    void vault.readData("properties").then((data) => {
      if (current) setTypes(readTypes(data));
    });
    return () => {
      current = false;
    };
  }, [vault]);

  const save = (next: readonly PropertyEntry[]) => {
    setDocumentProperties(document, next);
  };
  const keys = entries.map((entry) => entry.key);

  const setType = (key: string, type: PropertyType) => {
    const next = { ...types, [key]: type };
    setTypes(next);
    void vault.writeData("properties", next);
    save(
      entries.map((entry) =>
        entry.key === key ? { key, value: convertValue(entry.value, type) } : entry,
      ),
    );
  };

  const add = () => {
    const key = newPropertyKey(keys);
    setAdded(key);
    save([...entries, { key, value: "" }]);
  };

  return (
    <section className="properties" aria-label={t("properties")}>
      {entries.map((entry) => {
        const type = typeOf(entry.key, entry.value, types);
        return (
          <div key={entry.key} className="property" role="group" aria-label={entry.key}>
            <KeyField
              name={entry.key}
              taken={keys}
              autoFocus={added === entry.key}
              onRename={(name) => {
                save(
                  entries.map((item) =>
                    item.key === entry.key ? { key: name, value: item.value } : item,
                  ),
                );
              }}
            />
            <select
              className="property-type"
              aria-label={t("propertyType", { name: entry.key })}
              value={type}
              onChange={(event) => {
                setType(entry.key, event.target.value as PropertyType);
              }}
            >
              {editableTypes.map((option) => (
                <option key={option} value={option}>
                  {t(`type_${option}`)}
                </option>
              ))}
            </select>
            <ValueEditor
              name={entry.key}
              type={type}
              value={entry.value}
              onChange={(value) => {
                save(
                  entries.map((item) => (item.key === entry.key ? { key: item.key, value } : item)),
                );
              }}
            />
            <button
              type="button"
              className="quiet property-remove"
              aria-label={t("removeProperty", { name: entry.key })}
              onClick={() => {
                save(entries.filter((item) => item.key !== entry.key));
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className="quiet property-add" onClick={add}>
        {t("addProperty")}
      </button>
    </section>
  );
}
