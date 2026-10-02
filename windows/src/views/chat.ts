// Chat view — DOM port of PromptView / ChatBubble / TypingDotsView from
// IslandViewContent.swift.

import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { Bridge, type ChatContext } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type ChatMessage } from "../core/state";
import type { ViewHost } from "./views";

let nextId = 1;

/** Ideas for an empty chat — one click puts them in the field, Enter sends. */
const SUGGESTIONS = [
  "Summarize my uncommitted changes",
  "Write a commit message for this diff",
  "Explain the last error",
  "Plan my next three tasks",
];

function bubble(message: ChatMessage, fresh: boolean): HTMLElement {
  const row = message.role === "user"
    ? h("div", { class: "chat-row user" }, h("div", { class: "bubble", dir: "auto", text: message.content }))
    : h("div", { class: "chat-row" }, h("div", { class: "reply", dir: "auto", text: message.content }));
  if (fresh) row.classList.add("fresh");
  return row;
}

function typingDots(): HTMLElement {
  return h(
    "div",
    { class: "chat-row" },
    h("div", { class: "typing" }, h("i"), h("i"), h("i")),
  );
}

/** The coloured chip showing what the question is about (a dropped file). */
function contextChip(label: string): HTMLElement {
  const chip = h("div", { class: "chip" }, h("i", { class: "chip-dot" }), h("span", { text: label }));
  requestAnimationFrame(() => chip.classList.add("settled"));
  return chip;
}

export function buildPrompt(onHeightChange: () => void): ViewHost {
  const chipRow = h("div", { class: "chip-row" });
  const log = h("div", { class: "chat-log" });
  const input = h("input", {
    type: "text",
    class: "chat-input",
    placeholder: "Ask me anything…",
    spellcheck: "false",
  }) as HTMLInputElement;
  const send = h("button", { class: "send-btn", title: "Send" }, svg(ICONS.arrowUp, 11));
  const bar = h("div", { class: "chat-bar" }, input, send);
  const ideas = h("div", { class: "chat-ideas" },
    h("div", { class: "chat-ideas-title", text: "Try asking…" }),
    ...SUGGESTIONS.map((text) => h("button", {
      class: "idea",
      text,
      onclick: () => {
        input.value = text;
        input.focus();
        Sound.play("blip");
      },
    })),
  );

  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card wash chat-card" }, h("div", { class: "chat-body" }, chipRow, ideas, log, bar)),
  );
  (el.querySelector(".card") as HTMLElement).style.setProperty("--wash", "rgba(99,102,241,0.5)");

  let sending = false;
  let renderedCount = -1;

  async function submit() {
    const query = input.value.trim();
    if (!query || sending) return;
    input.value = "";
    sending = true;
    Sound.play("send");

    State.chatHistory.push({ id: nextId++, role: "user", content: query });
    State.stateOverride = "thinking";
    State.notify();
    onHeightChange();

    const file = State.droppedFile;
    const context: ChatContext | null =
      State.chatHistory.length === 1 && file ? { kind: "file", name: file.name, path: file.path } : null;

    try {
      const reply = await Bridge.chatSend(query, context, State.activeProjectCwd);
      State.chatHistory.push({ id: nextId++, role: "assistant", content: reply.text });
      State.stateOverride = null;
      Sound.play("finish");
    } catch (err) {
      State.stateOverride = null;
      State.noteMessage = String(err).replace(/^Error:\s*/, "");
      State.view = "note";
      Sound.play("error");
    } finally {
      sending = false;
      State.notify();
      onHeightChange();
      input.focus();
    }
  }

  send.addEventListener("click", () => void submit());
  input.addEventListener("input", () => send.classList.toggle("ready", input.value.trim().length > 0));
  input.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      void submit();
    }
    e.stopPropagation(); // Escape closes the island, not the chat
  });

  return {
    el,
    sync() {
      if (State.view === "prompt" && State.suggestedPrompt) {
        input.value = State.suggestedPrompt;
        State.suggestedPrompt = null;
        input.focus();
      }
      const file = State.droppedFile;
      const wantChip = file?.name ?? "";
      if (chipRow.dataset.label !== wantChip) {
        chipRow.dataset.label = wantChip;
        clear(chipRow);
        if (wantChip) chipRow.append(contextChip(wantChip));
      }

      const thinking = State.stateOverride === "thinking";
      const count = State.chatHistory.length + (thinking ? 0.5 : 0);
      if (count !== renderedCount) {
        // Only messages that weren't on screen before get the entrance animation.
        const seen = Math.floor(Math.max(0, renderedCount));
        renderedCount = count;
        clear(log);
        State.chatHistory.forEach((m, i) => log.append(bubble(m, i >= seen)));
        if (thinking) log.append(typingDots());
        log.scrollTop = log.scrollHeight;
      }
      ideas.style.display = State.chatHistory.length === 0 && !thinking && !State.droppedFile ? "" : "none";
      send.classList.toggle("ready", input.value.trim().length > 0);

      input.placeholder = State.chatHistory.length === 0 ? "Ask me anything…" : "Continue…";
      input.disabled = sending;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
