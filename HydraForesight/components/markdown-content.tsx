"use client"

import { Fragment, type ReactNode } from "react"

interface MarkdownContentProps {
  content: string
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const key = `${match.index}-${match[0]}`

    if (match[2] && match[3]) {
      nodes.push(
        <a key={key} href={match[3]} target="_blank" rel="noreferrer" className="text-blue-600 underline underline-offset-2">
          {match[2]}
        </a>
      )
    } else if (match[4]) {
      nodes.push(
        <code key={key} className="rounded bg-black/10 px-1 py-0.5 text-[0.85em] dark:bg-white/10">
          {match[4]}
        </code>
      )
    } else if (match[5] || match[6]) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {renderInline(match[5] || match[6])}
        </strong>
      )
    } else if (match[7] || match[8]) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline(match[7] || match[8])}
        </em>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const normalized = content.replace(/\r\n/g, "\n").trim()

  if (!normalized) {
    return null
  }

  const lines = normalized.split("\n")
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const currentLine = lines[index]
    const trimmedLine = currentLine.trim()

    if (!trimmedLine) {
      index += 1
      continue
    }

    const codeFenceMatch = trimmedLine.match(/^```([\w-]+)?$/)
    if (codeFenceMatch) {
      const language = codeFenceMatch[1]
      const codeLines: string[] = []
      index += 1

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index])
        index += 1
      }

      if (index < lines.length) {
        index += 1
      }

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded-lg bg-slate-950/90 p-3 text-xs text-slate-100"
        >
          {language ? <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">{language}</div> : null}
          <code>{codeLines.join("\n")}</code>
        </pre>
      )
      continue
    }

    if (/^(\*\*\*|---|___)\s*$/.test(trimmedLine)) {
      blocks.push(<div key={`divider-${blocks.length}`} className="my-2 border-t border-border/70" />)
      index += 1
      continue
    }

    const headingMatch = currentLine.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 3)
      const sizeClass = level === 1 ? "text-base" : "text-sm"
      blocks.push(
        <div key={`heading-${blocks.length}`} className={`${sizeClass} font-semibold leading-6`}>
          {renderInline(headingMatch[2])}
        </div>
      )
      index += 1
      continue
    }

    if (/^\s*>\s?/.test(currentLine)) {
      const quoteLines: string[] = []

      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""))
        index += 1
      }

      blocks.push(
        <blockquote
          key={`quote-${blocks.length}`}
          className="border-l-2 border-blue-400/70 pl-3 text-sm text-muted-foreground"
        >
          {quoteLines.map((line, lineIndex) => (
            <Fragment key={`quote-line-${lineIndex}`}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(line)}
            </Fragment>
          ))}
        </blockquote>
      )
      continue
    }

    if (/^\s*[-*+]\s+/.test(currentLine)) {
      const items: string[] = []

      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*+]\s+/, ""))
        index += 1
      }

      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item, itemIndex) => (
            <li key={`ul-item-${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    if (/^\s*\d+\.\s+/.test(currentLine)) {
      const items: string[] = []

      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""))
        index += 1
      }

      blocks.push(
        <ol key={`ol-${blocks.length}`} className="list-decimal space-y-1 pl-5 text-sm">
          {items.map((item, itemIndex) => (
            <li key={`ol-item-${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    const paragraphLines: string[] = []

    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^```/.test(lines[index].trim()) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^(\*\*\*|---|___)\s*$/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index])
      index += 1
    }

    blocks.push(
      <p key={`paragraph-${blocks.length}`} className="text-sm leading-6">
        {paragraphLines.map((line, lineIndex) => (
          <Fragment key={`paragraph-line-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderInline(line)}
          </Fragment>
        ))}
      </p>
    )
  }

  return <div className="space-y-3">{blocks}</div>
}
