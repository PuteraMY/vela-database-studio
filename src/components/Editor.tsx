import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { sql, SQLite } from "@codemirror/lang-sql";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import {
  bracketMatching,
  syntaxHighlighting,
  HighlightStyle,
  indentOnInput,
} from "@codemirror/language";
import { setDiagnostics } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { useStudio } from "../state/studio";
const colors = HighlightStyle.define([
  { tag: tags.keyword, color: "#2EE6C5" },
  { tag: tags.string, color: "#E1C58C" },
  { tag: tags.number, color: "#FFB547" },
  { tag: tags.comment, color: "#8795AB", fontStyle: "italic" },
  { tag: tags.function(tags.variableName), color: "#89B8FF" },
  { tag: tags.operator, color: "#AAB9CF" },
]);
export function Editor() {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView | null>(null),
    language = useRef(new Compartment());
  const value = useStudio((s) => s.sql),
    schema = useStudio((s) => s.schema),
    error = useStudio((s) => s.error);
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: useStudio.getState().sql,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          indentOnInput(),
          bracketMatching(),
          autocompletion(),
          language.current.of(sql({ dialect: SQLite })),
          syntaxHighlighting(colors),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": "Editor SQL",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              useStudio.getState().setSql(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              fontSize: "13px",
              color: "#E8EDF5",
              backgroundColor: "transparent",
            },
            ".cm-scroller": {
              fontFamily: '"JetBrains Mono", monospace',
              lineHeight: "1.85",
              overflow: "auto",
            },
            ".cm-content": { padding: "20px 0" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              border: "none",
              color: "#606F86",
              paddingRight: "12px",
              minWidth: "42px",
            },
            ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 16px" },
            ".cm-activeLineGutter": {
              backgroundColor: "#161E2D",
              color: "#2EE6C5",
            },
            ".cm-activeLine": { backgroundColor: "#131D2A80" },
            ".cm-cursor": { borderLeftColor: "#2EE6C5" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              backgroundColor: "#21423E",
            },
            ".cm-tooltip": {
              backgroundColor: "#161E2D",
              border: "1px solid #34425B",
              borderRadius: "3px",
            },
            ".cm-tooltip-autocomplete ul li[aria-selected]": {
              backgroundColor: "#23463F",
              color: "#E8EDF5",
            },
            "&.cm-focused": { outline: "none" },
          }),
        ],
      }),
    });
    editor.scrollDOM.tabIndex = 0;
    editor.scrollDOM.setAttribute("aria-label", "Kawasan editor boleh tatal");
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
  }, [value]);
  useEffect(() => {
    view.current?.dispatch({
      effects: language.current.reconfigure(
        sql({
          dialect: SQLite,
          schema: Object.fromEntries(
            schema.map((t) => [t.name, t.columns.map((c) => c.name)]),
          ),
        }),
      ),
    });
  }, [schema]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const from = Math.max(
      0,
      Math.min(error?.offset ?? 0, editor.state.doc.length - 1),
    );
    editor.dispatch(
      setDiagnostics(
        editor.state,
        error
          ? [
              {
                from,
                to: Math.min(from + 1, editor.state.doc.length),
                severity: "error",
                message: error.message,
              },
            ]
          : [],
      ),
    );
  }, [error]);
  return <div className="sql-editor" ref={host} data-testid="sql-editor" />;
}
