import { useState } from "react";

interface Segment {
  type: "text" | "code";
  value: string;
  lang?: string;
}

/** 펜스 없이 붙여넣은 소스 코드인지 간단히 판별 */
function looksLikeCode(text: string): boolean {
  if (!text.includes("\n")) return false;
  return (
    /[{};]/.test(text) ||
    /^\s*(import|export|def |class |function |const |let |var |public |private |#include|#ifndef)\b/m.test(
      text
    ) ||
    text.includes("\t") ||
    /^ {4}\S/m.test(text)
  );
}

/** ``` 펜스 코드 블록 또는 소스 코드를 복사하기 쉬운 형태로 분리 */
function parseSegments(content: string): Segment[] {
  const fence = /```(\w*)\n?([\s\S]*?)```/g;
  const segments: Segment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = fence.exec(content)) !== null) {
    if (match.index > last) {
      const text = content.slice(last, match.index);
      if (text.trim()) segments.push({ type: "text", value: text });
    }
    segments.push({ type: "code", value: match[2].replace(/\n$/, ""), lang: match[1] || undefined });
    last = match.index + match[0].length;
  }

  if (last < content.length) {
    const rest = content.slice(last);
    if (rest.trim()) {
      if (looksLikeCode(rest)) {
        segments.push({ type: "code", value: rest.replace(/\n$/, "") });
      } else {
        segments.push({ type: "text", value: rest });
      }
    }
  }

  if (segments.length === 0) {
    segments.push({ type: "text", value: content });
  }

  return segments;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

interface Props {
  content: string;
  className?: string;
}

export function MessageContent({ content, className = "" }: Props): JSX.Element {
  const segments = parseSegments(content);

  return (
    <div className={`message-content ${className}`.trim()}>
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodeBlock key={i} value={seg.value} lang={seg.lang} />
        ) : (
          <div key={i} className="message-text">
            {seg.value}
          </div>
        )
      )}
    </div>
  );
}

function CodeBlock({ value, lang }: { value: string; lang?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    await copyText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="message-code-wrap">
      <div className="message-code-toolbar">
        {lang ? <span className="message-code-lang">{lang}</span> : <span />}
        <button type="button" className="message-code-copy" onClick={() => void handleCopy()}>
          {copied ? "복사됨" : "복사"}
        </button>
      </div>
      <pre className="message-code-block">
        <code>{value}</code>
      </pre>
    </div>
  );
}
